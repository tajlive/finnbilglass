# FinnBilGlass — Fase 2: QA og utviklingsrapport

**Dato:** 2026-11-03
**Branch:** `fix/v6-6-0-fase2-all-glass` (fra `feat/v6-6-0-all-glass` @ `4e72391`)
**Commit under vurdering:** `c0f3c86` (+ denne rapporten i neste commit)
**Staging Worker:** `b72323c8-db0c-4097-a97f-2d306dc857ff`
**Staging-URL:** `https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev`
**Produksjon:** `ed4b58f3-f022-4181-887e-2a01d62529d6` — **uendret** (bekreftet med `wrangler deployments status` 2026-11-03)
**Rollback-versjon:** `ae5bb623-cfc9-4a5b-bce0-df8eec6db017` (uendret, ikke berørt)

**Produksjonsdeploy: IKKE utført. Migrering: IKKE kjørt. Merge til `main`: IKKE utført.**

---

## 1. Baseline og undersøkt commit

| Kontroll | Resultat |
|---|---|
| `git rev-parse HEAD` ved start | `4e7239185e8f5b3343d1b8ba0d182b34cbf00f80` |
| Branch ved start | `feat/v6-6-0-all-glass` |
| Prod Worker-versjon | `ed4b58f3-…` = oppgitt baseline ✅ |
| Prod-commit | `03bb58cb…` (per oppdragsbaseline) |
| Arbeidsbranch opprettet | `fix/v6-6-0-fase2-all-glass` fra `4e72391` |
| Ucommittet arbeid før start | kun `scripts/out/*` (testartefakter) + 2 dok-filer — ikke berørt |

### Forrige kontroll (D.2) er ikke gjentatt blindt
`docs/v660-d2-qa-2026-11-03.md` konkluderte **NO-GO** med fire blokkerende funn (F1–F4) på
nøyaktig denne commiten. Alle fire er **reprodusert på nytt** i denne runden (se §3), rettet (§4)
og verifisert på nytt (§5–§6).

### Produksjonsbaseline verifisert (kun lesing)
| Test | Forventet | Målt |
|---|---|---|
| Forside (apex + www) | 200 | 200 / 200 ✅ |
| `/health` | 200 | 200 ✅ |
| `/api/pilot-status` | 200 | 200 ✅ |
| `/min-side` uten sesjon | 302 | 302 ✅ |
| `/ops` uten Access | 302 til `*.cloudflareaccess.com` | 302 ✅ |
| `/api/ops/saker`, `/api/ops/whoami` uten Access | 302 | 302 ✅ (fail-closed) |
| Staging `workers.dev` `/api/ops/*` | 403 (hostname isolation) | 403 ✅ |
| `/api/frontrute` VW Transporter 2005 | VERIFY, 5 kandidater | VERIFY, 5 kandidater ✅ |
| Prislekkasje frontrute | ingen | `listepris/innkjøpspris/ubeKreftetPris/matchReason/source/EXACT` = **ingen treff** ✅ |

---

## 2. Endrede filer og begrunnelse

| Fil | Endring | Hvorfor |
|---|---|---|
| `src/fitment-v1/catalogue-candidates.ts` | **skrevet om** (522 linjer diff) | F1 (posisjon), F2 (familie-regex), F3 (år/generasjon), intern metadata |
| `src/glass-posisjon.ts` | `erListeRad()` eksportert, brukt internt | Én sannhet for «list/klips er ikke glass» i stedet for to kopier |
| `src/index.ts` | `/api/glass/kandidater`: klasse fra `selection`, hviteliste, `bilKilde`, merke/modell/aar, `unknown`≠400, jokertegn-sanitering | F4, F5, død frontend-kontrakt |
| `public/app.js` | sender hele `selection`; viser `posisjon`-tekst; fjerner intern klassifisering; ventilstøtte | Svar kunden ga gikk tapt; intern kode var synlig for kunde |
| `public/index.html` | «Ventilrute» som eget glassvalg | F7: klassen hadde ingen UI-inngang |
| `tests/all-glass-kandidater.test.mjs` | **ny** — 13 tester | Regresjonsvern for F1–F5 + API-kontrakt |
| `scripts/e2e-fase2-chrome.mjs` | **ny** — Chrome E2E for alle glasstyper | Fase E-krav: ekte Chrome, mobil + desktop, skjermbilder |
| `package.json` | `test:all-glass` lagt inn i `qa` | Testen må kjøre i den vanlige porten |
| `docs/v660-d2-qa-2026-11-03.md` | committet som bevis | Funnene denne runden lukker |

Ingen endring i `wrangler.toml`, `wrangler.staging.toml`, `migrations/`, priser, autentisering eller `/ops`-tilgangskontroll.

---

## 3. Feil oppdaget

| # | Funn | Alvor | Bevis |
|---|---|---|---|
| **F1** | Posisjonsfilter brukte nøkkelord i `varenavn` → **0 kandidater for alle klasser** | Blokker | 36 API-kall: alle 0. Samme kall uten `glassklasse` ga 25/6. |
| **F2** | `FAMILIER`-regex `/CLA/` matchet «E-CLASS», «C-CLASSE», «S-CLASSE», «A-CLASS» → feil bilmerke-modell i svaret | Blokker | CLA 2016 → 25 kandidater med E/M/S/C/A-CLASS; ekte CLA-frontrute `5524AGAC` manglet |
| **F3** | Åpne katalogintervaller tolket som uendelige + ingen generasjonssjekk → 1991- og 1980-rader for 2005-bil | Blokker | `VW TRANSPORTER 91-`, `VW TRANSPORTER,80-` som kandidater for 2005 |
| **F4** | Interne kandidatfelt i offentlig svar: `klassifisering`, `matchReason`, `source` — og frontend viste `CLASS_D_CATALOGUE_CANDIDATE` til kunden | Blokker | Faktisk svar + skjermbilde |
| **F5** | `merke`/`modell`/`aar` godtas i validering men brukes aldri | P1 | `{"merke":"VW","modell":"TRANSPORTER","aar":2005}` → `bil:null`, 0 kandidater |
| **F8** (ny) | Frontend sendte bare `{regnr, vin, glassklasse, posisjon}` — **`selection`-objektet (side, dør, seksjon, ventil) ble aldri sendt** | P1 | `public/app.js` `sokGlasskategori()`; kundens svar var tapt informasjon |
| **F9** (ny) | `kind=unknown` («Vet ikke») ga **HTTP 400** `Ugyldig glassklasse` — teknisk feil som normal respons | P1 | API-kall med `glassklasse: "unknown"` |
| **F10** (ny) | Matcheren fikk `normalizedKlasse` + flate `dorLedd`, ikke `selGlassklasse`/`selDorLedd` fra `selection` | P1 | `src/index.ts` før endring |
| **F6** | pen.dev `fileToken` i public repo (`design/ops-admin-2026.pen:368`) | Sikkerhet | gitleaks, se §7 |
| **F7** | Ventilrute hadde ingen UI-inngang → ikke E2E-testbar | Dekning | `public/index.html` |

**Merk:** F2 og F1 måtte rettes i **samme** endring. F1 alene ville sluppet E-CLASS-frontruter
gjennom som «frontrute til din CLA» — nøyaktig den feilen `MANUAL_REVIEW`-sperren skal hindre.

---

## 4. Feil rettet

### F1 — posisjon fra `klassifiserGlass()`, ikke fra navnenøkkelord
`buildClassDCandidates()` klassifiserer hver rad med `klassifiserGlass(varenavn, varenr, eurokode)`
— samme funksjon som er validert mot 29 627 produksjonsrader. Kandidaten bærer
`posisjon: {type, side, dorLedd, ventilLedd, konflikt}` internt, og kunden ser en ferdig
formulert tekst (`posisjonsTekst()`), f.eks. «Dørrute venstre».

`sidefamilie` (sideglass der katalogen ikke oppgir dør/ventil/kvartal) er gyldig svar på **både**
«Dørrute» og «Siderute», merket «Sideglass (type må avklares)». Alternativet var en tom liste =
blindvei. Rader med dokumentert type (`dor`, `ventil`, `side`) blandes ikke.

### F2 — ordavgrensede familie-regexer
Alle familie-tokens er bygget med `ordbundet()`:
`(?<![A-ZÆØÅ0-9])(?:…)(?![A-ZÆØÅ0-9])`. «CLA-CLASSE» matcher CLA; «E-CLASS» gjør det ikke.
BMW-numre fikk valgfri bokstav-suffiks (`3(?:16|18|20|25|28|30|35|40)[A-Z]?`) fordi SVV oppgir
modell som `320D` — uten det ga 320D **null** kandidater.

### F3 — generasjonsbevisst årsmatching
1. Hver rad får et generasjonsvindu: token fra navnet (`T5`, `IV`, `B8`, `C117`) eller vinduet som
   starter nærmest radens startår.
2. Radens intervall **klemles** til vinduet: «91-» → T4 (1990–2003) → gyldig 1991–2003, ikke evig.
3. Uten kjent vindu: åpent intervall dekker maks **12 år** (`APENT_INTERVALL_SPENN`) = det lengste
   dokumenterte generasjonsforløpet i `generation-registry` (T5 2003–2015). Taket kan bare gi
   *manglende* kandidat (→ manuell kontroll), aldri feil kandidat.
4. Kryss-generasjon ekskluderes: en T4-rute er ikke svar på en T5-bil selv om intervallene møtes i 2003.
5. `GENERASJONER`-tabellen er låst mot `generation-registry` med egen test — de kan ikke gli fra hverandre.

### F4 — hviteliste i offentlig svar
```json
{ "varenr": "...", "varenavn": "...", "eurokode": "...", "posisjon": "Dørrute venstre", "attributter": [...] }
```
`klassifisering`, `matchReason`, `source`, `pris`, `listepris`, `innkjøpspris`, `ubeKreftetPris`, VIN
kan ikke lenger oppstå — feltet legges ikke til, i stedet for å slettes etterpå. Frontend viser
«Krever kontroll før bestilling» i stedet for den interne konstanten.

### F5 — merke/modell/aar brukes
Når regnr mangler bygges kjøretøygrunnlaget fra klienten og svarer `bilKilde: "klientopplysning"`
(`bil: null` — bilen er ikke registerverifisert). Ufullstendig input avvises eksplisitt:
merke uten modell → 400, år utenfor 1940–neste år → 400.

### F8, F9, F10 — kundereisen
- `selection` (side, dør, seksjon, montering, ventil) sendes fra frontend og brukes i matcheren.
- `unknown`/`ukjent`/`vet_ikke` = «ingen posisjon oppgitt» → 200 uten klassefilter. `hood` → 400.
- Ventilrute er eget kundevalg med side + foran/bak.

---

## 5. Testresultater

### 5.1 Full testpakke (`npm run qa` = `tsc --noEmit` + 42 testblokker)
```
QA_EXIT=0
486 tester · 479 PASS · 0 FAIL · 7 skipped
```
De 7 skippede er de samme GT-fixture-avhengige testene som før (`ground-truth.jsonl` finnes ikke i
arbeidskopien): GT-roundtrip, MAZDA 3 2009, VOLVO TRUCKS F16 1984, VW PASSAT 2008 multi-GT,
GT-konsistens test-500, L1-kandidater VOLVO TRUCKS F16, fixtures. **GT-integrasjonen er ikke målt i
denne kjøringen** — det er et dekningsgap, ikke en grønn sjekk.

### 5.2 TypeScript
```
npx tsc --noEmit → 0 feil
```

### 5.3 Nye tester (`tests/all-glass-kandidater.test.mjs`) — 13/13 PASS
| Test | Verifiserer |
|---|---|
| F1 plassering via klassifiserGlass | CLA-frontrute uten «front» i navnet er kandidat; frontrute er ikke dørrute |
| F2 ordavgrenset familie | ingen E/C/S/A-CLASS i CLA-svar; A-CLASS svarer fortsatt på A-CLASS |
| F3 åpent intervall | «91-» og «80-» matcher ikke 2005; «03-» gjør det |
| F3 generasjonsvindu begge veier | 1995 → T4-rad; 2004 → ikke T4-rad; T5-rad ja |
| Rad uten intervall | ikke kandidat for årspesifikk bil, men kandidat uten år |
| Tilbehør | pyntelist/klips-kit filtreres |
| Årsintervall-parser | tosifret, firesifret, og avviser «4D» |
| Generasjonstabell vs register | 20+ vinduer kontrollert, start- og sluttår identiske |
| F4 hviteliste | ikke-tom liste uten `klassifisering/matchReason/source/pris/…`; `posisjon` er tekst; ingen EXACT |
| F5 input | merke uten modell → 400, år 1800 → 400, fullt sett → kandidater |
| «Vet ikke» | 200 for unknown/ukjent/vet_ikke, 400 for «hood» |
| selection | `selection.kind=door` gir `glassklasse=dor` og dørglass |

### 5.4 API-matrise mot staging (`b72323c8`) — 4 biler × 7 klassenavn
| Bil (SVV) | frontrute | dør | side | ventil | bak | tak | vet ikke |
|---|---|---|---|---|---|---|---|
| SU18018 VW Transporter 2005 | 5 | **20** | **18** | 0 | **11** | 0 | **25** |
| AJ95429 Mercedes CLA 200 D 4MATIC 2016 | 5 | **11** | **11** | 0 | **2** | 0 | **18** |
| XD84921 BMW 320D XDRIVE 2014 | 0 | **25** | **25** | 0 | **6** | 0 | **25** |
| JD79487 VW Caddy 2017 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Før fiksen: **0 på alle 36 kallene**. Etter: kandidater i alle klasser der katalogen har data.
Ventil/tak = 0 for disse bilene er **datadekning**, ikke filterfeil (se §8).

Feil/edge (staging): ugyldig klasse → 400 · tom body → 400 · merke uten modell → 400 ·
år 1800 → 400 · merke+modell+år → 200 (`bilKilde=klientopplysning`) · `selection.kind=door` → 200.

### 5.5 Katalogomfang og LIMIT
`LIMIT 5000` per merke er ikke en skjult avkortning: største merke i produksjonskatalogen er
**FORD med 2 047 rader** (MERCEDES 1 727, TOYOTA 1 667, VW 1 631, BMW 1 487). Målt mot prod-D1.

---

## 6. Chrome E2E-bevis

**Verktøy:** ekte Google Chrome (`channel: 'chrome'`), `scripts/e2e-fase2-chrome.mjs`.
**Miljø:** staging `b72323c8`. **Regnr:** SU18018 (SVV: VW Transporter 2005).
**Omfang:** 7 glasstyper × 2 viewports (393×852 mobil, 1280×900 desktop) + frontrute-regresjon.

```
OPPSUMMERING: 14 brukerreiser · 0 FEIL · 0 advarsler
FRONTRUTE-REGRESJON: bil="Transporter · 2005"
  h2="Vi har funnet flere mulige frontruter til bilen din"
  kortlengde=260 · pris/kort-elementer=2 · sporsmaal=3
```

| Viewport | Glasstype | Skjermbilde | Kandidatkort | API | Utfall |
|---|---|---|---|---|---|
| mobil | Frontrute | `mobil-front.png` | via `/api/frontrute` | 200 | VERIFY + 3 kontrollspørsmål |
| mobil | Dørrute | `mobil-door.png` | 3 | 200 | «Mulige glass til bilen» |
| mobil | Siderute | `mobil-side.png` | 3 | 200 | «Mulige glass til bilen» |
| mobil | Ventilrute | `mobil-ventil.png` | 0 | 200 | MANUAL_REVIEW (ingen katalograd) |
| mobil | Bakrute | `mobil-rear.png` | 3 | 200 | «Mulige glass til bilen» |
| mobil | Takglass | `mobil-roof.png` | 0 | 200 | MANUAL_REVIEW (ingen katalograd) |
| mobil | Vet ikke | `mobil-unknown.png` | 3 | 200 | «Mulige glass til bilen» |
| desktop | alle 7 | `desktop-*.png` | som over | 200 | som over |

Maskinelt verifisert per reise:
- **API-et ble faktisk kalt** (`waitForResponse` på `/api/glass/kandidater` / `/api/frontrute`) og svarte 200.
- **Ingen intern kode i kundeflaten**: `CLASS_D_CATALOGUE_CANDIDATE`, `GT_AUTO_PRISLISTE`, `matchReason`, `undefined`, `NaN` = 0 treff.
- **Ingen JavaScript-feil** (pageerror/console.error), utenom forventet 401 på `/api/auth/session` (ikke innlogget).
- **Mobil uten horisontal overflyt** (scrollWidth − clientWidth ≤ 2 px).
- **Tilbudsskjema** åpnet for alle; tomt skjema ble **avvist** av valideringen — ingen forespørsel ble sendt.
- **«Be om pristilbud» aktiv** i alle tilfeller (P0-krav, også ved MANUAL_REVIEW).

Skjermbilder og rå JSON: `/Users/taj/.hermes/cache/scratch/fbg-fase2/e2e/` (15 PNG + `e2e-rapport.json`).
Visuell kontroll av `mobil-door.png`: tre kort «VW TRANSPORTER 03- DØRRUTE», «… T5 03- DØRRUTE»,
«… T5 03- SKYVEDØR» med «Plassering: Dørrute venstre / Sideglass (type må avklares)»,
«Krever kontroll før bestilling», «Velg dette glasset», og «Be om uforpliktende tilbud».

---

## 7. Sikkerhetskontroller

| Kontroll | Resultat |
|---|---|
| `gitleaks detect --log-opts="origin/main..HEAD"` | 5 funn — **alle eldre**, 0 fra denne endringen |
| `ACCESS_AUD` ×4 (`wrangler.toml:41`, `:66`) | **Falsk positiv**: JWT-audience-claim, sendes i klartekst i hver Access-forespørsel |
| `design/ops-admin-2026.pen:368` `fileToken` | **Reell, åpen (F6)** — pen.dev-delingstoken i public repo, ikke rotert (krever eiers tilgang til pen.dev) |
| Nye hemmeligheter i Git | **ingen** |
| Prislekkasje i offentlig svar | ingen (`pris/listepris/innkjøpspris/ubeKreftetPris` finnes ikke i CLASS_D-svaret; frontrute gir kun kundepris) |
| EXACT i noe svar | **ingen** — `fitmentAuthority: "ingen — menneskelig bekreftelse kreves"` |
| `/ops` og `/api/ops/*` i prod | 302 → Cloudflare Access (fail-closed) |
| `/api/ops/*` på staging-vert | 403 (hostname isolation) |
| SQL-parametre | merke bindes som parameter; jokertegn (`%`/`_`) saniteres bort fra klientinput |
| XSS i kandidatvisning | kandidatfelt escapes før de settes i HTML |
| Testdata | syntetiske katalograder i tester, staging-D1 i E2E — **ingen reell kundehenvendelse opprettet** |

---

## 8. Status for alle glasstyper

| Glasstype | API-støtte | Kundevalg i UI | Kandidater (målt, staging) | Merknad |
|---|---|---|---|---|
| Frontrute | ✅ `/api/frontrute` (GT-resolver) | ✅ | 5 / VERIFY + 3 spørsmål | Uendret flyt, regresjon grønn |
| Dørrute | ✅ `dor` | ✅ | 20 (T5 2005), 11 (CLA), 25 (320d) | `sidefamilie` vises merket «type må avklares» |
| Siderute | ✅ `side` | ✅ | 18 / 11 / 25 | — |
| Ventilrute | ✅ `ventil` | ✅ **nytt valg** | 0 for testbilene | 418 katalograder inneholder «VENTIL» i prod, men ingen for disse bilene |
| Bakrute | ✅ `bakrute` | ✅ | 11 / 2 / 6 | — |
| Takglass | ✅ `tak` | ✅ | 0 for testbilene | Kun 39 rader (TAKGLASS/TAKRUTE/SOLTAK) i prod — reell mangel |
| «Vet ikke» | ✅ (ingen klasse) | ✅ | 25 / 18 / 25 | Ga 400 før |

---

## 9. Uavklarte problemer

1. **Eurokode vises til kunden** i kandidatkortet. `src/public-contract.ts` lister `eurokode` som
   internt felt for `/api/glass`. Å fjerne det er en **kundesynlig endring** som ikke er gjort uten
   Toms godkjenning. Beslutning trengs.
2. **F6 pen.dev `fileToken`** er ikke rotert (krever Toms pen.dev-tilgang).
3. **Modellfamilie-dekning:** `FAMILIER` dekker 24 familier. VW Caddy (testbil JD79487) mangler
   familie → 0 kandidater → MANUAL_REVIEW (ærlig, men et dekningshull). Nye familier krever egne
   generasjonsvinduer med kilde — ikke lagt inn uverifisert.
4. **Side (venstre/høyre) filtrerer ikke.** `selection.side` mappes til `sideKilde` kun når
   `styring` (LHD/RHD) er eksplisitt oppgitt, og frontend/SVV leverer den ikke. Posisjonen vises,
   men filtrerer ikke — dokumentert, ikke gjettet.
5. **CSP i Report-Only blokkerer ikke, men ville brutt «Velg dette glasset»:** knappene bruker inline
   `onclick`, og Chrome logger CSP-brudd. Ved håndhevet CSP må handlerne flyttes til `addEventListener`.
6. **GT-integrasjonen er ikke målt** i denne kjøringen (7 skippede tester, manglende fixture).
7. **`/ops`-katalogen kan ikke verifiseres ende-til-ende** uten Access-innlogging (krever Toms
   nettleser med MFA). Det som *er* målt: 302/403 fail-closed (§1).

---

## 10. Migrasjonsbehov

| Migrasjon | Nødvendig for denne endringen? | Status |
|---|---|---|
| `0047_glass_typekode` | **Nei** for kundeflyten (`/api/glass/kandidater` leser kun `glass_prisliste`). **Ja** for `/ops`-katalogen (`src/routes/admin-katalog.ts` JOINer tabellen uguardet) | **Ikke kjørt.** Krever egen godkjenning. |
| `0042`–`0046` | Nei | Allerede applisert i prod utenfor ledgeren (verifisert D.2) |
| Nye migrasjoner i denne endringen | — | **Ingen** |

`wrangler d1 migrations apply` må ikke kjøres mot prod: `0042/0043/0044` er ikke-idempotente
`ALTER TABLE … ADD COLUMN` og stopper serien med «duplicate column name» før `0047`.
Skal `0047` inn, kjøres den alene med `--file` (additiv, `IF NOT EXISTS`), og rollback er
`DROP VIEW v_glass_med_typekode; DROP TABLE glass_typekode`.

---

## 11. Git

| Felt | Verdi |
|---|---|
| Branch | `fix/v6-6-0-fase2-all-glass` |
| Base | `feat/v6-6-0-all-glass` @ `4e7239185e8f5b3343d1b8ba0d182b34cbf00f80` |
| Kode-commit | `c0f3c86abf43e32f4d73dfa6fdece9e458cedfa1` |
| Rapporten | committet i neste commit på samme branch |
| Endringer | 9 filer, +1 302 / −139 (hvorav ny test 250 linjer og ny E2E 202 linjer) |
| PR | opprettet mot `feat/v6-6-0-all-glass` — **ingen merge** |

`feat/v6-6-0-all-glass` er 59 commits foran `origin/main` (190 filer, hele V6.4.x–V6.6.0-linjen).
En PR fra denne branchen til `main` ville publisert alt dette. Derfor er PR-en rettet mot
feature-branchen; en eventuell `main`-release må lages som egen release-branch fra `origin/main`
(jf. «én release = én branch fra deploy-målet»).

---

## 12. GO/NO-GO

### Kodeendringen (denne branchen) — **GO for produksjonsforslag**
- F1–F5 er reprodusert, rettet og verifisert med tester og Chrome E2E.
- 486 tester / 479 PASS / 0 FAIL; tsc grønn; 14/14 brukerreiser uten feil.
- Frontrute-flyten er uendret og regresjonstestet; tilbudsskjema og `/api/inquiry` uberørt.
- Ingen prislekkasje, ingen EXACT, ingen nye hemmeligheter.

### Produksjon — **NO-GO nå, venter på Toms eksplisitte godkjenning**
- Produksjonsdeploy, migrering og merge er ikke utført og skal ikke utføres uten Toms direkte «ok».
- Før deploy bør punktene i §9 avgjøres: eurokode-visning (1), side-filter (4) hvis ønsket.

### `/ops`-katalogen — **NO-GO** til `0047` er besluttet (separat sak, ikke en del av denne endringen).

### Åpne blokkeringer før en `main`-release
1. Release-omfang: 59+ commits / 190+ filer ligger mellom `origin/main` og denne branchen.
2. F6: pen.dev-token må roteres.
3. GT-integrasjonen er ikke målt (7 skippede tester).

---

## Vedlegg — hvordan dette reproduseres

```bash
# Tester
npm run qa

# Chrome E2E mot staging (alle glasstyper, mobil + desktop)
FBG_BASE=https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev \
  node scripts/e2e-fase2-chrome.mjs

# API-matrise (regnr × klasse) — leser kun
python3 ~/.hermes/cache/scratch/fbg-fase2/staging-matrix.py

# Sikkerhet
gitleaks detect --log-opts="origin/main..HEAD"
```
