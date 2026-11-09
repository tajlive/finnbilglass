# Produksjonsinstruks v2 — presisert etter Toms merknader

**Dato:** 2026-11-04 · **Branch:** `feat/katalogvarianter-20261104` · **PR:** #28
**Kodecommit:** `56f4adb` (inkluderer miljø-etikettfiksen) · **Dokumentasjonscommit:** `5ed25f1` + denne filen
**Staging verifisert:** `7fdc9345-79eb-4450-bf79-1dd31a1aea5e` (etter etikettfiksen)
**Status:** venter på Toms godkjenning · produksjon er ikke rørt

---

## 1. Konflikttallet: nøyaktig 15 — ikke «stopp ved > 30»

Den gamle grensen var for slapp, og jeg oppdaget hvorfor den må være eksakt:

**Staging viser 65 konflikter i `glass_variant_konflikt`.** Det er ikke et avvik i migrasjonen, men
et artefakt av at `0048c` er kjørt flere ganger på en staging-base som allerede var importert —
registeret er append-only og husker historiske suffikser. **Derfor er registeret ikke en gyldig
kontroll.** Kontrollen må gjøres live, mot kanonisk nøkkel.

**Live kontroll (gjelder produksjon, kjørt på ren prod-kopi av HEAD-artefaktene):**

```sql
SELECT count(*) FROM glass_prisliste
 WHERE variant_id <> (CASE
   WHEN eurokode IS NOT NULL AND TRIM(eurokode) <> '' THEN
     UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                THEN SUBSTR(TRIM(varenr),1,LENGTH(TRIM(varenr))-2) ELSE TRIM(varenr) END) || ':' ||
     UPPER(CASE WHEN eurokode LIKE '%.0' AND eurokode NOT LIKE '%.%.0'
                THEN SUBSTR(TRIM(eurokode),1,LENGTH(TRIM(eurokode))-2) ELSE TRIM(eurokode) END)
   ELSE
     UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                THEN SUBSTR(TRIM(varenr),1,LENGTH(TRIM(varenr))-2) ELSE TRIM(varenr) END)
     || ':~' || UPPER(TRIM(COALESCE(varenavn,''))) END);
```

**Forventet: 15 — etter 0048c og fortsatt 15 etter import.**

**Serialisering for hashing (må følges eksakt):** de 15 `variant_id`-verdiene sorteres **stigende
byte-vis (ASCII)**, settes sammen med **LF (`\n`) som skilletegn og ingen avsluttende LF**, kodes som
**UTF-8** (381 bytes) og hashes med **SHA-256**. (Listen under er allerede i denne rekkefølgen.)

**Full SHA-256 (64 tegn):** `bbea7f5f067b5ba3b8488496958f35fa53187a266c627a1e1669c69e719e7150`
**Avkortet (32 tegn, som i forrige utkast):** `bbea7f5f067b5ba3b8488496958f35fa` — dette er
**ikke** en full SHA-256, kun første halvdel; bruk den fulle verdien over som kontroll.

```
2426GYEL:5346AGSGYAHJMV#2        2873PYKIT:3574ASGRL+3574AS#2   2999GNMU:8385AGAMUV1B#2
3067CSCM:8608ACDCMUVWZ1#2        3067GNCM:8608AGACMUVWZ1#2      3193GNCM:7619AGSCMVZ55#2
3205GNCE:7816AGACHMVWZ1#2        3205GNCM:7816AGACMVWZ1B#2      3223GYAC:6734AGSGYACMVW#2
3345GNCM:5382AGSACMZ1F#2         8104BGSG:8104BGSGYSABKTZ#2     8596GZPR5:5689AGNMV1B#2
8596GZPR5:5689AGNMV1B#3          9341AGNG:9341AGNGN1B#2         AF64AGAC:AF64GACHMVZ1E#2
```

**Stoppkriterium:** er tallet ikke **15**, eller avviker listen/hashen fra over, stoppes hele
kjøringen før import. Årsaken undersøkes før noe annet gjøres. (Samme regel etter import: fortsatt 15.)

## 2. Innsendinger under migrasjonen — kontrollert pause, ikke en oppfordring

**Kompatibilitetsanalysen (dokumentert, ikke antatt):**

| Forhold | Funn |
|---|---|
| Skjemaendring | Rent additiv for lesere: alle gamle kolonner beholdes, `variant_id` er ny og nullbar, indeksene erstattes av ekvivalenter |
| Gammel Worker mot nytt skjema | Fungerer — den leser/skriver bare kolonner som finnes. Verifisert i rehearsal (alle 117 biler, 0 tekniske feil) |
| Ny Worker mot gammelt skjema | **Brytes** (mangler `variant_id` → 400 «Ukjent variant»). Derfor: data **før** kode |
| Kundehenvendelser | Skrives til `beta_inquiries` (egen tabell, egen D1-binding i staging) — ikke til `glass_prisliste` |
| Migrasjonens skriving | Kun `glass_prisliste` (rebuild + import). Ingen kundetrafikk skriver dit |
| Rebuild-vinduet | `DROP`+`RENAME` skjer i én D1-forespørsel; lesere kan blokkeres i sekunder. Det er dette vinduet pausen dekker |

**Men kompatibilitet er ikke nok når ekte kunder kan sende inn midt i det.** Derfor en **kort,
kontrollert pause** med eksisterende kill switch:

1. **Pause:** `UPDATE feature_flags SET enabled = 0 WHERE flag = 'inquiries_enabled';` (prod-D1)
2. **Bekreft:** poll `GET /api/pilot-status` til `pilot: "stengt"` — flagget caches **10 s per isolate**, så vent til svaret er stabilt i minst to polls (>15 s).
3. Kjør steg 1–4 (migrasjon, normalisering, import, avstemming).
4. **Åpne:** `UPDATE feature_flags SET enabled = 1 WHERE flag = 'inquiries_enabled';`
5. **Bekreft:** `GET /api/pilot-status` → `pilot: "apen"` (igjen ≥15 s for cache).

**Hva kunden ser mens den er stengt:** søk og kandidater virker som normalt; kun innsending svarer
`503` med den eksisterende, tydelige teksten: *«Vi tar ikke imot nye forespørsler akkurat nå. Prøv
igjen senere.»* Ingen kunde mister data, og ingen forespørsel havner i en halvferdig katalog.

**Varighet:** pausen er bare steg 1–4 — sekunder til få minutter, ikke hele deployen. Kode-deploy skjer **mens det fortsatt er stengt**, og innsending åpnes først etter at søk, varianter og priser er kontrollert (steg 7).

## 3. «Miljø: Produksjon» på staging — var en etikettfeil, nå rettet

**Undersøkt:** `public/ops-admin.js:148` skrev `'Produksjon'` så snart `/api/pilot-status` svarte
`pilot: "apen"` — den leste aldri miljøet. Etiketten var altså feil, ikke konfigurasjonen:

| Kontroll | Resultat |
|---|---|
| `GET /api/ops/summary` (innlogget) | `environment: "staging"` |
| `wrangler.toml` `[env.staging.vars]` | `ENVIRONMENT = "staging"` |
| Staging D1 | `finnbilglass-staging-catalog` + `finnbilglass-staging-auth` (egne ID-er) |
| Staging R2 | `finnbilglass-opplaering-staging` (egen bucket, ikke delt med prod) |
| Kundedata i staging | `beta_inquiries` i staging-auth-D1 |

**Rettet:** `/api/pilot-status` returnerer nå `environment`, og Driftsstatus viser
**«Miljø: Staging»** — verifisert visuelt i `/ops` etter deploy `7fdc9345`.

## 4. Oppdatert kjøreplan

| Steg | Handling | Kontrollpunkt | Stopp |
|---|---|---|---|
| P0 | **Registrer opprinnelig flaggstatus** (`SELECT enabled FROM feature_flags WHERE flag='inquiries_enabled'`) | verdi notert (forventet 1) | kan ikke leses → stopp |
| P1 | **Pause** innsending (`enabled=0`) | `GET /api/pilot-status` = `stengt` | ikke stengt → stopp |
| P2 | **Vent ut cachetiden med margin:** dokumentert maks 10 s per isolate → vent **≥30 s**, deretter ny statuskontroll | `stengt` i to kontroller ≥30 s fra hverandre | fortsatt `apen` → stopp |
| 0 | Backup `glass_prisliste_backup_0048` | 29 627 rader | avvik → stopp + gjenopprett flagg |
| 1 | `0048` (`a9b780da203eb187`) | 29 627 rader · 29 627 unike `variant_id` | avvik → tilbakeføring |
| 2 | `0048c` (`4fcd2a09892dcc5f`) | **live konflikter = nøyaktig 15** + full SHA-256 `bbea7f5f…e7150` | annet tall/annet hash → stopp, undersøk |
| 3 | `variant_upsert_00..02` | **30 937** rader · RAV4 **8/8** · konflikter fortsatt 15 | avvik → stopp |
| 4 | `katalog-avstemming.py` | `bare_kilde = 0`, `bare_prod = 3` · `ground_truth` **32 307** | avvik → stopp |
| 5 | **Deploy Worker `56f4adb`** (fortsatt stengt) | versjons-ID notert | feil → rull kode, data står |
| 6 | **Kontroller søk, varianter, priser** | RAV4 2024 → 3 varianter: 6 070,31 / 4 643,75 / 3 357,81 · `/api/pilot-status` = `stengt` | avvik → rull kode |
| 7 | **Gjenåpne til OPPRINNELIG verdi** (ikke automatisk `1`) | `pilot` = opprinnelig status | avvik → undersøk |
| 8 | Én merket testsak + `/ops` | variant, eurokode, estimat, leveringssted synlig | feil → rull kode |

**Kunden er altså stengt fra P1 til og med steg 6** — gammel pris-/variantlogikk møter aldri den
oppdaterte katalogen.

**Hvis kjøringen stopper (etter steg 1 eller senere):**
1. **Kode:** rull til forrige produksjonsversjon hvis ny kode er deployet (steg 5+).
2. **Data:** kjør tilbakeføringen (under) hvis steg 1–4 er påbegynt.
3. **Pause:** bli **stengt** til kode og data er tilbakeført og verifisert.
4. **Flagg:** sett `inquiries_enabled` tilbake til **verdien fra P0**. Var tjenesten stengt før
   arbeidet startet, skal den **forbli stengt** — aldri automatisk `enabled=1`.

**Tilbakeføring (prøvd på ren prod-kopi):** kode tilbake først, deretter data — ny kode mot gammelt
skjema gir 400 for nye varianter. Data: legg bort ny tabell, gi `glass_prisliste_backup_0048`
navnet tilbake, gjenopprett indeksene fra 0002/0007/0032 → **29 627 rader** verifisert. Saker med
nye varianter forblir lesbare. Under tilbakeføring gjelder samme pause-regel som over.

## 5. Sluttall som skal rapporteres

| Måling | Forventet |
|---|---|
| `glass_prisliste` | **30 937** |
| Unike `variant_id` | 30 937 |
| Live variantkonflikter | **15** (uendret etter import) |
| `ground_truth` | **32 307** (uendret) |
| RAV4 `8432AGAC` | **8 varianter** |
| RAV4-priser (API/UI/sak) | 6 070,31 · 4 643,75 · 3 357,81 |
| QA / typecheck | 549/549 · grønn |
