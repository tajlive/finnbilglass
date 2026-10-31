# PRODUCTION GO / NO-GO — FinnBilGlass

**Dato:** 31. oktober 2026
**Baseline main:** `ddd78d1`
**Release-kandidat:** `c0b96b4` (PR #6)

---

## 1. Eksakt release-SHA

| | |
|---|---|
| Kandidat | **`c0b96b4`** — `fix(discovery): bruk normalisert merke ogsaa i seed-soket` |
| Base | `ddd78d1` |
| CI på eksakt commit | **success** |
| Staging-deploy fra eksakt commit | **`1b0858d6-fac3-4831-8e9f-8b537b631e78`** (ren `git worktree` på `c0b96b4`, ingen lokale endringer) |
| Diff | 32 filer, +9 307 / −228 |

Staging-versjonen er deployet fra en ren checkout av `c0b96b4`, ikke fra en arbeidskopi. Commit og deployert versjon er dermed sporbar.

---

## 2. PR-status

| PR | Head | Status | Vurdering |
|---|---|---|---|
| **#6** | `c0b96b4` | Draft, CI grønn, MERGEABLE | **Release-kandidat** — klar for sign-off |
| #7 | `76213be` | Merget | — |
| #8 | `5e007a9` | Merget → `e2d1564` | — |
| #9 | `723c2eb` | Merget → `94b3ca5` | — |
| #10 | `c98d043` | Merget → `ddd78d1` | — |
| **#12** | idempotens | Draft, CI grønn | P0 før pilot — **testet mot ekte D1**, se punkt 6 |
| **#13** | offentlig kontrakt | Draft, CI grønn — stablet på #6 | P0 før pilot — se punkt 6b |
| #11 | docs | Draft | Dette dokumentet |
| #2, #3, #4, #5 | — | Åpne | **Erstattet** — se punkt 12 |

---

## 3. Testresultater og stagingbevis

### `npm run qa` på eksakt `c0b96b4` (ren worktree)
```
tests 344 · pass 337 · fail 0 · exit 0
```
7 skippet er bevisst (krever Cloudflare-tilgang eller eksterne nøkler).

### Staging-E2E (`https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev`)
```
1. regnr-oppslag      ✔ VW TRANSPORTER 2005 · VIN WV1ZZZ7H…
2. bil → glass        ✔ PINPOINT (vin_glass_overrides: 1 kandidat) → 2525GYA
3. glass → pris       ✔ kundePris 5490 kr · listepris 9980 kr
4. kundehenvendelse   ✔ inquiryId 69 (HTTP 201)
Resultat: 4/4 steg OK
```

### `/api/glass` — merkealiaser
| Input | Kandidater |
|---|---|
| `VW`, `Volkswagen`, `vw` | 20 / 20 / 20 |
| `Mercedes`, `Mercedes-Benz` | 20 / 20 |
| `Toyota`, `TOYOTA` | 20 / 20 |

### `/api/glass` — determinisme
Tre identiske kall ga identisk `sha256 = f749bdc9d9249479`. Ingen syntetiske `firstSeenAt`/`lastSeenAt` i responsen. Kandidatfelt: `canonicalUrl`, `eurokode`, `skuFingerprint`, `varenavn`, `varenr`.

### NOK-prising og MVA
`GET /api/admin/pris-estimat?listepris=9980`:
```
sikkerhet     : BEKREFTET
grunnlag      : PRISTLISTE_NOK
kundePris     : 5490     (9980 × 0,60 = 5988 → nærmeste trinn 5490)
mva           : 1098     (25 % av 5490)
prisEksMva    : 4392
```

### Rate limit på kundehenvendelser
Fire POST ga `201`, femte ga `429` — grensen er 5 per IP per 10 minutter.

### Apify
| | |
|---|---|
| Actor | `finnbilglass-catalog` build **0.2.11** |
| Katalogadapter-tester | 8/8 pass |
| Produkter i staging-D1 | 50 (50 unike eurokoder) |

---

## 4. Katalogstatus

- **50** verifiserte produkter i staging (`apify_catalog_products`), idempotent import (re-import: 0 nye, 50 oppdatert).
- Full katalog = **4 621** URL-er fra `sitemap-guardian-en-products.xml` — men det er **frontrute**-undersetten, ikke hele katalogen.

### Verifisert sitemap-innhold (31.10.2026, HTTP 200, 2 950 806 bytes)

| Kategori | URL-er | Unike eurokoder |
|---|---|---|
| `en/windscreen` (frontrute) | 4 621 | **4 620** |
| `en/backlight` (bakrute) | 710 | — |
| `en/side-glass` (sideglass) | 676 | — |
| **Alle glass** | **6 007** | **6 005** |
| `en/accessories` | 721 | — |
| `en/turbo-club-products` | 52 | — |
| **Totalt i sitemap** | **6 785** | — |

**Presisering av målet:** «4 621 URL-er» er frontruter. Hele glasskatalogen er **6 007 URL-er / 6 005 unike eurokoder**. Verktøy og tilbehør kommer i tillegg.

**Dedupe:** 4 621 frontrute-URL-er gir 4 620 unike eurokoder — kun én kode har to varianter (`8552AGN1C`). Antakelsen «4 621 URL-er ≠ 4 621 SKU-er» er dermed nesten feil: forholdet er 1:1 minus én.

**Format:** 4 521 av 4 620 eurokoder starter med fire siffer. 99 avviker og må undersøkes før de behandles som gyldige frontruter.

**Sitemap-endring:** Den dokumenterte figuren var 4 621. Sitemapet inneholder nå 6 785 URL-er totalt fordi bakruter, sideglass og tilbehør er med. Frontrute-undersetten er fortsatt 4 621 — tallet var riktig, men ble lest som «hele katalogen».
- Skaleringsgater: 250 → 1 000 → 4 621. Hver gate krever godkjenning.
- EUR holdes i egne felt (`pris_eur`, `pris_valuta`); `pris` (NOK) er `NULL` for katalogprodukter uten bekreftet NOK-grunnlag.

---

## 5. Matchingsikkerhet

- `PINPOINT` brukes kun ved entydig treff (én kandidat) eller dokumentert override.
- Ukjente attributter forblir `UNKNOWN` — systemet gjetter aldri.
- HUD settes aldri fra katalogdata, eurokode eller kundebilde (kun kundesvar).
- Kameramodul, regnsensor og varmetråder krever kundebekreftelse eller OE-evidens.

---

## 6. Pris- og ordrestatus

| | |
|---|---|
| NOK-grunnlag | `prisliste` (BEKREFTET) og `faktura + påslag` (BEKREFTET) |
| Glavista EUR | **brukes ikke** i prismodellen |
| Fabrikkerte NOK-priser | ingen — `pris` er `NULL` der grunnlag mangler |
| Ordre | ingen automatisk ordreopprettelse; kundehenvendelse er slutten på flyten |

### Produksjonskrav: idempotente kundehenvendelser

Målt i staging: fire identiske POST til `/api/inquiry` ga fire rader i `beta_inquiries`. Rate limiting (5/IP/10 min) er abuse-vern, ikke dedupe — en dobbeltklikk eller nettverksretry lager to saker i `/ops`.

**Krav før pilot:** `Idempotency-Key` per innsending, håndhevet atomisk i D1.

| Situasjon | Forventet resultat |
|---|---|
| Første innsending, ny nøkkel | 201, én henvendelse |
| Retry, samme nøkkel + likt innhold | samme `inquiryId` |
| Samme nøkkel, endret innhold | 409 Conflict |
| To samtidige identiske forsøk | maksimalt én henvendelse |
| Ny nøkkel ved bevisst innsending | ny henvendelse |

**Status: implementert i PR #12.** Nøkkelen reserveres med `INSERT … ON CONFLICT DO NOTHING` mot PRIMARY KEY før henvendelsen opprettes, så parallelle kall kolliderer atomisk uten transaksjon. Tabellen lagrer kun nøkkel og sha256 av kanonisk body — ingen navn, telefon eller e-post. Rate limiting er beholdt og gjelder kun nye innsendinger. Mangler migrasjon 0038, degraderer handleren til dagens oppførsel: kunden blokkeres aldri.

### Verifisert mot ekte staging-D1 (31.10.2026)

`0038` kjørt mot `finnbilglass-db-staging`, PR #12 deployet (`d1b6c705`), deretter målt:

| Test | HTTP | Database |
|---|---|---|
| 1. Ny nøkkel | 201, id 75 | 1 henvendelse, 1 `created`-event |
| 2. Retry, likt innhold | 201, **id 75**, `idempotent:true` | uendret |
| 3. Samme nøkkel, endret innhold | **409** | uendret |
| 4. **20 parallelle**, identisk nøkkel | **1 × 201, 19 × 409** | **én** henvendelse (id 76) |
| 5. Ny nøkkel | 201, id 77 | ny henvendelse |
| 6. Uten header | 201, id 78 | ingen idempotens-rad |

**Ingen duplikater under 20 samtidige kall.** Hver henvendelse fikk nøyaktig ett `created`-event — innsetting og hendelse skjer i én `db.batch()` (implisitt transaksjon), så de kan ikke havne i utakt.

**Personvern verifisert:** tabellen har kun kolonnene `idem_key`, `request_hash`, `inquiry_id`, `state`, `created_at`. Ingen navn, telefon eller e-post.

### Krasj mellom reservering og opprettelse

En feil i det vinduet etterlot tidligere en `PENDING`-rad som låste nøkkelen **for alltid**. Rettet: en `PENDING` eldre enn 60 s kan overtas med en betinget `UPDATE` på `created_at`, så to samtidige overtakelser ikke begge lykkes. `ryddStale()` fjerner resten.

### Pilotblokkering (håndhevet, ikke bare dokumentert)

```bash
npm run pilot:preflight -- --database finnbilglass-db-staging --config wrangler.staging.toml
```

Sju krav med eksplisitt grunn per feil, `exit 1` ved manglende `0038`. Verifisert mot staging: alle sju grønne.

---

## 6b. Offentlig API-kontrakt

**Beslutning:** offentlig søk skal vise produkter og bekreftet NOK-pris, men ikke interne data.

| Kundevendt | Aldri offentlig |
|---|---|
| `varenr`, `varenavn`, `canonicalUrl` | `eurokode`, `skuFingerprint` |
| `pris`: `kundePris`, `mva`, `prisEksMva` | `typeCode`, `side`, `alias_av`, `rad_type` |
| `status`: `OK` / `MANUAL_REVIEW` | leverandør, innkjøpspris, kilde-metadata, diagnostikk |

Ved usikker matching eller manglende prisgrunnlag: `MANUAL_REVIEW` og tilbudsforespørsel — aldri automatisk bekreftet kompatibilitet eller pris.

**Status: implementert i PR #13** (stablet på PR #6 siden `/api/glass` bare finnes der). Hviteliste-mapping, ikke svarteliste. Ni kontrakttester sikrer at ingen interne felt lekker, også nøstet.

**Dette erstatter PR #3s gamle kontrakt**, som krevde `MANUAL_REVIEW` med tomme kandidatlister i alle offentlige søk.

---

---

## 6c. Kill switch — obligatorisk pilotkrav

**Rotårsak funnet 31.10.2026:** `/api/frontrute` kalte `resolverModus()`, men `/api/regnr` og `/api/vin` returnerte resolveren rå. Et automatisk godkjent `PINPOINT` slapp dermed ut selv med `resolver_all = 0`. Stoppsignalet virket ikke der det betydde mest.

### Beskyttede ruter

| Rute | Policy |
|---|---|
| `/api/frontrute` | felles `anvendResolverPolicy()` |
| `/api/regnr` | felles `anvendResolverPolicy()` |
| `/api/vin` | felles `anvendResolverPolicy()` |
| `/api/les-skilt` | bruker ikke resolveren — arver vern via `/api/regnr` |

### Degradering

| Flagg | Effekt |
|---|---|
| `resolver_all = 0` | **FALLBACK** på alle ruter — ingen automatisk godkjent match |
| `resolver_pinpoint = 0` | `PINPOINT` → **VERIFY** (kandidatene beholdes) |
| begge = 1 | normal atferd |
| manglende rad / uleselig D1 | **FALLBACK** — feiler lukket, aldri utilsiktet PINPOINT |

Kandidatlisten er identisk etter degradering. Matchmotoren er ikke endret — bare sikkerhetsstatusen, og `grunn` navngir hvilket flagg som slo inn.

### Staging-bevis (ekte data, 31.10.2026)

| Tilstand | `/api/regnr` | `/api/vin` |
|---|---|---|
| `resolver_all = 0` | **FALLBACK** | **FALLBACK** |
| `resolver_pinpoint = 0` | **VERIFY** | **VERIFY** |
| begge = 1 | **PINPOINT** | **PINPOINT** |

`grunn` fra `/api/regnr`: `kill switch: PINPOINT→FALLBACK (vin_glass_overrides: entydig treff …)`.

### Cache

TTL **10 s** per Worker-isolat. Worst case fra flagget endres i D1 til alle isolater har sett det er 10 s. Lesefeil caches ikke, så en forbigående D1-feil låses ikke fast.

### Nødstopp og tilbakestilling

```sql
-- Stopp alt automatisk
UPDATE feature_flags SET enabled = 0 WHERE flag = 'resolver_all';
-- Gjenopprett
UPDATE feature_flags SET enabled = 1 WHERE flag IN ('resolver_all','resolver_pinpoint');
```

Verifiser med `npm run pilot:preflight` og ett `/api/regnr`-kall: `resolver.utfall` skal vise degradert verdi innen 10 s.

### Resterende risiko

1. **Propagering:** inntil 10 s per isolat. En kunde som treffer et isolat med gammel cache kan i det vinduet få PINPOINT.
2. **Manuell operasjon:** nødstopp krever D1-skriving. Det finnes ingen egen admin-knapp i `/ops`.
3. **Ingen overvåking:** ingen alarm hvis flagget står feil.
4. **`/api/frontrute` viste `pinpoint=false` i alle testede tilstander** for testkjøretøyet fordi det traff tekstmatcheren, ikke resolverens PINPOINT-vei. Degraderingen er derfor bevist på `/api/regnr` og `/api/vin`, som faktisk returnerte PINPOINT.

---

## 7. D1-rekonsilieringsplan

Produksjon `finnbilglass-db`: **61 tabeller · 77 indekser · 18 ledger-rader**.

| Operasjon | Verktøy | Status |
|---|---|---|
| Ledger-backfill, 15 rader → 33 | `scripts/maintenance/ledger-backfill.mjs` | Testet på isolert D1. **Ikke kjørt i prod.** |
| 0019-indeksene (3 stk) | `scripts/maintenance/handling-c.mjs` | Testet: 60→62 tabeller, 77→83 indekser, rollback OK |
| 0034 `glass_catalog_multi` | samme | Testet. Ligger i `migrations/pending/` |
| 0020 `oem_probe_queue_fix` | — | **Blokkert som destruktiv** |
| 0037 | — | **Skal ikke kjøres** — kolonnene finnes allerede |

Verifisert: `integrity_check ok`, `foreign_key_check` 0 avvik på eksport.

### Rekkefølge (hver operasjon krever egen godkjenning)

1. **Skrivebeskyttet status** — tabell- og indekstelling, ledger-antall, schema-fingerprint
2. **Eksport + Time Travel-bokmerke** — før noe skrives
3. **Ledger-backfill (15 → 33 rader)** — `ledger-backfill.mjs preflight` må være grønn
4. **0019-indeksene** — `handling-c.mjs apply` (kun indeksene)
5. **0034-tabellene** — samme verktøy, separat kjøring
6. **Verify** — `foreign_key_check`, tabelltelling, tomhetssjekk av nye tabeller
7. **Integritet på eksport** — `integrity_check` lokalt med `sqlite3`

Etter hvert steg: ny eksport, ny kontroll. Rollback tilgjengelig hele veien.

### 0033 i staging — undersøkt
0033 oppretter **ingen** `inquiry_reply_history`-tabell. Den bygger `beta_inquiry_events` på nytt slik at `event_type` også tillater `'reply'`.

Staging har allerede effekten:
```
CHECK (event_type IN ('created','status','note','assignment','reply'))   ✓
idx_beta_inquiry_events_inquiry                                          ✓
```
**Ingen staging-reparasjon nødvendig.** Kun ledger-raden mangler (out-of-band-mønsteret).

---

## 8. Produksjonsdeployplan

1. Merge PR #6 til main med vanlig merge-commit
2. Verifiser at `[deploy]`-markør **ikke** finnes i commit → ingen automatisk deploy
3. Governed deploy via GitHub Actions `production`-environment med required reviewer
4. Post-deploy: `/health` 200, kundereise i prod, `deploy`-jobb ikke skipped
5. Rollback: `wrangler rollback` til forrige versjon

---

## 9. Pilotplan og stoppekriterier

**Omfang:** 10–20 inviterte kunder. Ikke åpen trafikk.

**Forutsetninger:**
- PR #12 (idempotens) merget og `0038` kjørt i prod
- PR #13 (offentlig kontrakt) merget — ingen eurokoder eller innkjøpspriser ut
- PR #14 (kill switch) merget — `resolver_all` stopper automatisk godkjenning på alle ruter
- Sikre glassmatcher (`PINPOINT` eller manuell verifisering)
- Korrekt NOK-pris fra bekreftet grunnlag
- Fungerende kundehenvendelse → `/ops`
- Manuell verifisering ved `VERIFY`/`UNKNOWN`

**Stoppekriterier:**
| Signal | Handling |
|---|---|
| Feilbestilling oppdaget | Stopp pilot, varsle Tom |
| `WRONG_GLASS`-flagg i ledger | Stopp, gjennomgå |
| >5 % henvendelser uten gyldig pris | Stopp, gjennomgå prismodell |
| API-feil >1 % over 15 min | Rull tilbake |
| Kill switch aktivert | Pilot av |

---

## 10. Kostnad og overvåking

| Tjeneste | Kostnad |
|---|---|
| Cloudflare Workers/D1/R2 | inneværende plan |
| Apify Actor | per compute-unit — 50-kjøring er innenfor gratisnivå; 4 621 må kostnadsberegnes **før** godkjenning |
| LLM (vision/resolver) | gratisnivå (Gemini-lite, NVIDIA NIM) |

Overvåking: `/health`, Cloudflare Analytics, `beta_inquiry_events`, QA-feil per batch.

---

## 11. Rollback

| Nivå | Metode |
|---|---|
| Kode | `wrangler rollback` (Cloudflare beholder N versjoner) |
| Git | `git revert <merge-commit>` — branch protection blokkerer force-push |
| D1 skjema | `handling-c-rollback.sql` — verifisert 60 tabeller / 80 indekser |
| D1 data | D1 Time Travel + eksport tatt før hver operasjon |

---

## 12. Eksplisitte godkjenningspunkter

| # | Handling | Status |
|---|---|---|
| 1 | Merge PR #6 til main (`c0b96b40be8a`) | ⏸ **Avventer Tom sign-off på eksakt SHA** |
| 1b | Merge PR #12 (idempotens) | ⏸ Etter #6 |
| 1c | Merge PR #13 (offentlig kontrakt) | ⏸ Etter #6 |
| 1e | Merge PR #14 (kill switch, P0) | ⏸ Uavhengig av #6 |
| 1d | Kjøre `0038` i staging og verifisere idempotens ende-til-ende | ⏸ Etter #12 |
| 2 | Backfill produksjons-D1 (15 → 33 ledger-rader) | ⏸ Avventer |
| 3 | Opprette 0019-indeksene i prod | ⏸ Avventer |
| 4 | Kjøre 0034 i prod | ⏸ Avventer |
| 5 | Produksjonsdeploy | ⏸ Avventer |
| 6 | Full Apify-crawl (4 621) | ⏸ Avventer |
| 7 | Starte begrenset kundepilot (10–20) | ⏸ Avventer |
| 8 | Pilot100 / Pilot1000 | ⏸ Egne senere godkjenninger |

### PR #2–#5 — anbefaling

Alle fire har merge-base `b773695` (20. august) og representerer en parallell arkitekturlinje main aldri adopterte. Main har **0 referanser** til `glass-selection`, `inquiry-commercial`, `customer-price-gate`, `voice-lab`, `glass-search`, `supplier-sku-evidence`, `email-ingest`.

| PR | Unikt innhold | Anbefaling |
|---|---|---|
| #2 | ~60 filer parallell arkitektur + 39 MB generert data | Lukk |
| #3 | `0003_catalogue_variant_identity.sql`, `release-a-public-contract` | Se under |
| #4 | Samme linje + P1-filer som er i #6 | Lukk |
| #5 | 4 filer, alle i #6 | Lukk |

**To elementer fra #3 krever din avgjørelse før lukking:**

1. **`0003_catalogue_variant_identity.sql`** — legger `UNIQUE(varenr, varenavn, eurokode, rad_type)` på `glass_prisliste` via DROP + RENAME. Direkte relevant for «ingen dupliserte SKU-identiteter», men destruktiv og vil feile hvis duplikater finnes i dag.

2. **`release-a-public-contract-2026-10-30.md`** — beskriver en **bevisst annen produktbeslutning**: offentlig søk skal returnere `MANUAL_REVIEW` med tomme kandidater, ingen eurokoder og ingen priser. Dette **strider mot** dagens `/api/glass`, som returnerer kandidater, eurokoder og NOK-pris til offentlig klient.

Punkt 2 er ikke en kodeendring — det er et produktvalg om hva som skal være synlig offentlig. Det må avklares før PR #3 kan lukkes som «erstattet».
