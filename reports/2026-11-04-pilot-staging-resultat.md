# Pilot-kjøring mot staging — resultater (2026-11-04)

Første gjennomførte kjøring etter testplan v2. Kjører **kun** `POST /api/regnr` med `lookupOnly: true`.

| Felt | Verdi |
|---|---|
| Kodeversjon | `6c6fd16` (+ lokale testendringer, se `docs/testplan-v2-rammeverk.md`) |
| Adresse | `https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev` |
| Datasett | `testgrunnlag v1`, seed `20261104` (117 biler) |
| Kjøringer | `pilot-20261104-a` (5) · `pilot-regresjon-20261104` (51) · `pilot-tilfeldig-20261104` (50) |
| Skrivinger | **ingen** — `lookupOnly: true` slår av `regnr_logg`/`sok_logg` (`src/sok-logg-policy.ts`) |
| Henvendelser/e-post | ingen |

Kommando: `node scripts/pilot-kjoring.mjs --limit N --sett regresjon|tilfeldig`

## 1. Teknisk utfall

| Måling | Resultat |
|---|---|
| Kall totalt | **101** |
| Teknisk OK | **101 (100 %)** |
| Timeout / 429 / 4xx / 5xx | **0** |
| Latens p50 / p95 / maks | **300 ms / 1 173 ms / 1 227 ms** |

Ingen avbrudd, ingen stoppregel utløst.

## 2. Katalog- og kundeutfall

| Sett | Kall | Kandidater | Ingen dekning |
|---|---|---|---|
| Regresjon (fast sett) | 51 | 33 (65 %) | 18 (35 %) |
| Tilfeldig utvalg (seed) | 50 | 44 (88 %) | 6 (12 %) |
| **Totalt** | **101** | **77 (76 %)** | **24 (24 %)** |

Utfall fra resolveren: **PINPOINT 14 · VERIFY 63 · FALLBACK 24** (13,9 % / 62,4 % / 23,8 %).
Alle PINPOINT har nøyaktig 1 kandidat. Ingen kandidatliste var tom der utfall var PINPOINT/VERIFY.

## 3. Fasitvurdering

Begge dokumenterte fasitene: **SAMSVAR**.

| Bil | Forventet (testplan v2) | Målt | Dom |
|---|---|---|---|
| SU18018 VW Transporter T5 2005 | kandidater inneholder `2525GYA`, kundestatus `KREVER_KONTROLL` | `VERIFY`, 5 kandidater, 2525GYA blant dem | **SAMSVAR** |
| AJ95429 Mercedes CLA 200 D 4MATIC 2016 | ingen kandidat, kundestatus `INGEN_DEKNING` | `FALLBACK`, 0 kandidater | **SAMSVAR** |

## 4. Regresjonssjekk mot dokumentert forventning fra 2026-08-19

`data/fixtures/self-test-50-cars.json` har `forventet: treff | ingen-kandidat` per bil, satt før dagens kode. Sammenlignet med målt utfall i dag:

**50 av 50 samsvar — 0 avvik.**

Det betyr at den faste kohorten oppfører seg nøyaktig som dokumentert i august. Ingen stille regresjon i katalogmatchingen.

## 5. Funn

### 5.1 P1 — RAV4-familien gir null kandidater (6 av 6 biler)

Målt: `RAV4 2005`, `RAV4 Plug-in Hybrid 2024` (×5) → **FALLBACK, 0 kandidater**.

Rotårsak, målt lokalt mot GT-fixturen (32 307 rader):

| Modellstreng fra SVV | GT-treff med dagens kode | GT-treff med fiksen i PR #26 (`ec61ca16`) |
|---|---|---|
| `RAV4` 2024 | **13** — alle feil år (RAV4 2000–2003) | **54** — inkluderer 2024 |
| `RAV4 Plug-in Hybrid` 2024 | **13** — alle feil år | **13** — uendret |
| `RAV 4` 2024 | 59 | 72 |

GT-radene finnes (`TOYOTA RAV-4` / `RAV 4`, 1995–2026), så dette er matching, ikke manglende data.

**To separate forhold:**

1. **PR #26 (`ec61ca16`, branch `fix/rav4-modellnormalisering`) fikser `RAV4` men er ikke i denne branchen og dermed ikke i det som kjører.** Den ble verifisert på staging `0021f7d0` 2026-11-03, men dagens staging-build svarer fortsatt FALLBACK — fiksen er ikke med i gjeldende deploy. Dette er ren tegnsetting: `RAV4` gir ett token, GT-raden heter `RAV-4` (to tokens).
2. **`RAV4 Plug-in Hybrid` er en annen sak, ikke samme feilklasse.** Kjøretøyets modellstreng har variantord (`Plug-in Hybrid`) som GT ikke har (`RAV 4` / `RAV-4`). Det kan ikke løses ved å lempe på tegnsetting — det ville kreve at variantord ignoreres, og det er nøyaktig regelen som hindrer at `GOLF SPORTSVAN` matcher `GOLF`. **Om en RAV4 plug-in har samme frontrute som en vanlig RAV4 er et fitment-spørsmål, ikke et kodematching-spørsmål.** Systemet oppfører seg konservativt og riktig inntil Tom svarer på det: kunden får hjelpeflyt i stedet for en gjettet kandidat.

Merk at PR #26 heller ikke hjelper `RAV4 Plug-in Hybrid` (målt: 13 treff, alle feil år, både før og etter). Det er forventet gitt punkt 2.

### 5.2 P2 — Polestar 2 gir null kandidater

`POLESTAR 2 2022` og `POLESTAR POLESTAR 2 2022` → FALLBACK, 0 kandidater, både med og uten PR #26.

GT har `POLESTAR | 2 HBK | 2020–2024`. Kjøretøyets modell er `2` eller `POLESTAR 2`. Modelloken `2` er ett tegn, og GT-raden har karosserisuffikset `HBK`, så de møtes aldri. Samme mønster som RAV4, men **ikke** løst av PR #26 (målt: 0 treff i begge brancher). Også her er spørsmålet om `2` og `2 HBK` er samme bil i fitment-forstand — Polestar 2 finnes bare som én karosseritype, men det er en faglig vurdering, ikke noe koden skal avgjøre selv.

### 5.3 Moderne elbiler har systematisk hull

Uten dekning i utvalget: Polestar 2 (2), Nissan Ariya, Toyota bZ4X, Cupra Born, Lotus Eletre, BMW i3, BMW i7. Det er 7 av 24 FALLBACK-treff. Eldre og vanlige fossilbiler dekkes godt (Golf, Passat, Transporter, Touran, Tiguan, Corolla gir alle kandidater).

### 5.4 Datakvalitet i kildematerialet

To biler har merkenavnet duplisert i modellstrengen fra finn.no: `MITSUBISHI MITSUBISHI OUTLANDER` og `POLESTAR POLESTAR 2`. Outlander matchet likevel PINPOINT; Polestar gjorde ikke. Modellnormaliseringen bør fjerne et ledende merkenavn i modellfeltet, ellers blir treffene tilfeldige.

## 6. Hva dette betyr for lansering

- **Teknisk stabilitet er god:** 101/101 kall OK, p95 1,2 s.
- **Ingen falske PINPOINT observert:** de 14 PINPOINT-treffene har 1 kandidat hver, og begge fasitene samsvarer.
- **Dekningen er 76 %** i dette utvalget, men fordelingen er skjev: nye elbiler og RAV4-variantene faller til manuell. Det er akseptabelt etter doktrinen *bare* hvis hjelpeflyten er tydelig — og det må verifiseres i nettleser før lansering.
- **RAV4 er en av de vanligste bilene i Norge** og en prioritert modell. Å lansere med 0 kandidater på RAV4 PHEV er ikke forsvarlig når GT-radene finnes og feilen er en navnematching.

## 7. Neste steg (anbefalt rekkefølge)

1. **Beslutning: merge PR #26** inn i release-branchen. Den er liten (3 filer: `src/vin-resolver.ts`, `tests/rav4-modellnormalisering.test.mjs`, `package.json`), dokumentert og verifisert, og fikser `RAV4` (13 → 54 GT-treff). **Sammenføyningen er prøvekjørt lokalt:** eneste konflikt er `qa`-linjen i `package.json` (begge parter la til en test), den er løst ved å beholde begge, og `test:rav4` 5/5 + full suite kjørt i worktreen (se §8). Uten denne er RAV4 fortsatt ødelagt i det som kjører.
2. **To fitment-spørsmål til Tom** (kan ikke avgjøres av kode):
   - Har RAV4 plug-in hybrid samme frontrute som vanlig RAV4 for samme årgang?
   - Er `POLESTAR 2` og GT-raden `2 HBK` samme bil?
   Svar «ja» gir grunnlag for å utvide variantmatchingen; «nei»/«vet ikke» betyr at dagens konservative FALLBACK er korrekt og skal bestå.
3. **Fjern duplisert merkenavn** i modellfeltet ved import/matching (`POLESTAR POLESTAR 2`, `MITSUBISHI MITSUBISHI OUTLANDER`).
4. **Kjør piloten på nytt** etter (1) og (3) med samme seed og runId-konvensjon, og sammenlign mot denne kjøringen som referanse.
5. **Nettlesertest** av hjelpeflyten for de 24 bilene uten dekning — kunden skal aldri møte en blindvei.

## 8. Prøvesammenføyning av PR #26 (lokal, ikke committet i release-branchen)

| Steg | Resultat |
|---|---|
| `git merge ec61ca16 --no-ff` i worktree på `6c6fd16` | Konflikt **kun** i `package.json` (`qa`-linjen: PR #26 la til `test:rav4`, denne branchen la til `test:launch-gate`) |
| Konfliktløsning | Begge beholdt: `… && npm run test:all-glass && npm run test:rav4` |
| `npm run test:rav4` | **5/5 PASS** |
| Full suite i worktreen (committed HEAD + PR #26) | **48 suiter, 524 tester, 517 pass, 0 fail, 7 skipped** (524 = 519 på HEAD + 5 nye RAV4-tester; de 7 skippete er GT-fixture-testene, som ikke ligger i worktreen) |
| Endrede filer | `src/vin-resolver.ts`, `tests/rav4-modellnormalisering.test.mjs`, `package.json` |

Prøven viste at sammenføyningen er ren. Den er senere gjennomført for alvor i arbeidsbranchen — se §9.

---

## 9. Etter sammenslåingen (2026-11-04)

PR #26 er nå merget inn i arbeidsbranchen etter vanlig gjennomgang (diff lest, 3 filer: `src/vin-resolver.ts`, `tests/rav4-modellnormalisering.test.mjs`, `package.json`), og staging er deployet på nytt.

| Felt | Verdi |
|---|---|
| Merge-commit | `7c20d1ad` (foreldre: `ded654d` + `ec61ca16`) |
| Konflikt | kun `qa`-linjen i `package.json` — begge testene beholdt |
| QA etter merge | **531 tester, 531 pass, 0 fail, 0 skipped** (526 + 5 RAV4-tester) |
| Staging-deploy | version `016521d3-fbcc-4371-994a-b698e6be6f5d`, `/health` 200, katalogRader 29 627 |
| Piloter | `pilot-regresjon-20261104-etter` (51) + `pilot-tilfeldig-20261104-etter` (50), samme seed og samme biler som før |

### 9.1 Samlet effekt

| Måling | Før | Etter |
|---|---|---|
| Kall / tekniske feil | 101 / **0** | 101 / **0** |
| Biler med kandidater | 77 | **77** |
| Uten dekning | 24 | **24** |
| PINPOINT | 14 | **11** |
| VERIFY | 63 | **66** |
| FALLBACK | 24 | 24 |
| Fasit (2 biler) | 2/2 SAMSVAR | **2/2 SAMSVAR** |
| Samsvar med dokumentert forventning (selvtest-50) | 50/50 | **50/50** |
| Gjennomsnittlig latens | 346 ms (regresjon) / 496 ms (tilfeldig) | 347 ms / 511 ms |

**12 av 101 utfall endret — 4 i regresjonssettet, 8 i det tilfeldige utvalget.** Ingen nye tekniske feil. Dekningen er uendret; det er *hvilke* svar kunden får som endres.

### 9.2 De 12 endringene

| Bil | Før | Etter | Vurdering |
|---|---|---|---|
| Toyota RAV4 2005 | FALLBACK / 0 | **VERIFY / 2** | **Fikset** — dette var hele poenget med PR #26 |
| Tesla Model Y 2023 | VERIFY / 4 | **PINPOINT / 1** (`8103AGCC`) | **Fikset feilkilde** — før kunne Model Y matche GT-raden «MODEL 3»; nå treffer den egen rad |
| VW Golf Plus 2011 | VERIFY / 6 | **FALLBACK / 0** | **Riktig blitt strengere** — GT har ingen «GOLF PLUS»-rad; før ble det tilbudt Golf-ruter til en annen bil |
| VW Golf Sportsvan 2014 | VERIFY / 6 | VERIFY / 3 | Strengere: Sportsvan er egen modell |
| Toyota Prius+ 2013 | VERIFY / 5 | VERIFY / 3 | Strengere: feil årganger falt bort |
| VW ID.4 GTX 2023 | PINPOINT / 1 | VERIFY / 3 | PINPOINT → VERIFY: tre varianter vises nå (8652AGAC, 8658AGAC, 8658ACKC) |
| VW ID.4 2023 (×2) | PINPOINT / 1 | VERIFY / 3 | som over |
| VW ID.5 2023 (×2) | PINPOINT / 1 | VERIFY / 3 | som over |
| Mazda CX-3 2018 | VERIFY / 2 | VERIFY / 4 | Flere varianter fra L2 |
| Mazda CX-5 2014 | VERIFY / 3 | VERIFY / 1 | Færre; grunn: «1 kandidat, men ikke bekreftet av ground_truth» |
| Toyota Yaris 2024 | VERIFY / 4 | VERIFY / 3 | Én variant mindre fra L1 |

### 9.3 Vurdering

- **To reelle feilrettinger:** RAV4 (tegnsetting) og Model Y (matchet feil modellrad før). Begge er dokumentert i PR #26.
- **Tre stramminger som fjerner feil bil:** Golf Plus, Golf Sportsvan og Prius+ fikk før ruter fra en annen modell. Å gi FALLBACK der er i tråd med doktrinen — et kataloghull skal gi hjelpeflyt, ikke et feil glass. **Dette er ikke regresjoner i feilbestillings-forstand, men de øker manuell andel** og må veies mot konvertering.
- **Fire PINPOINT → VERIFY (ID.4/ID.5):** mindre skråsikkerhet, tre varianter i stedet for én. Tryggere, men mer friksjon. Bør undersøkes: var den gamle PINPOINT faktisk riktig for GTX-varianten, eller var den et lykketreff?
- **Ingen fasit avviket**, og den dokumenterte forventningen fra 2026-08-19 holdt 50/50 også etter endringen.

### 9.4 Neste steg, i tråd med CTO-ens rekkefølge

1. **Avklar ID.4/ID.5-downgraden** før videre utvidelse — den er den eneste endringen som gir mer friksjon uten åpenbar sikkerhetsgevinst.
2. **Utvid utvalget trinnvis** til ~300–500 biler, med vekt på (a) flere biler per merke/modell/årgang, (b) nyere elbiler, (c) modellnavn med tegnsetting eller suffiks (`Plug-in Hybrid`, `GTX`, `Plus`, `Sportsvan`, `HBK`, `PHV`).
3. **De 24 uten kandidater skal ikke regnes som matchfeil** før de er vurdert som kataloghull — det gjelder særlig Golf Plus, Polestar 2, Ariya, bZ4X, Born, Eletre, i3, i7 og RAV4 Plug-in Hybrid.
4. **Nettlesertest av hjelpeflyten** for nettopp disse 24 bilene.
