# Produksjonsforespørsel — én samlet release

**Én forespørsel.** Ingen parallelle forespørsler for samme release.

| | |
|---|---|
| **Releasecommit** | `7af60fd` (HEAD på `feat/katalogvarianter-20261104`) |
| **Kodecommit for de tre endringene** | `d8c858a` + `4cb64ea8` + `4250cb5` |
| **Stagingversjon** | `ba35ee51-be7b-4b18-ada1-358b5b10bf1c` |
| **Bygget fra** | arbeidstreet = `d8c858a`; `git diff d8c858a..HEAD -- src/ public/` er **tom** → staging testet nøyaktig denne koden |
| **Rollbackmål** | `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d` (produksjonsversjon i dag, kode `e03d5ec`) |
| **QA** | **605/605**, `tsc` grønn |
| **Tag** | `release/glassvalg-20261104-v2` |

## De tre endringene

| # | Endring | Filer | Diff siden prod |
|---|---|---|---|
| 1 | **Felles tilbehørsklassifisering** — `erTilbehorVare()` er eneste regel; kandidatsøk og `produkttype()` delegerer. Stopper SENSORGEL, SENSORTAPE, BUNNLIST, LIST | `src/glass-posisjon.ts` (+17), `src/fitment-v1/catalogue-candidates.ts`, `src/glass-variant-kontroll.ts` | ✅ |
| 2 | **Korrigert statusordlyd** — `bekreftet_bil_ukjent_kontroll` i stedet for «ingen dokumenterte egenskaper» | `src/index.ts` (6 linjer) | ✅ |
| 3 | **Tilbake i frontruteflyten** — knappen vises etter rutevalg, nullstiller svar/variant/resultat og går til rutevalget | `public/app.js` (+36/−4) | ✅ |

Verifisert med `git log -S` per endring og `git diff --stat e03d5ec..HEAD -- src/ public/`
(5 filer, 58 innsettinger, 11 slettinger — ingen andre kodeendringer).

## Stagingbevis

| Kontroll | Resultat |
|---|---|
| Tilbake, mobil 390 | 4 ruter tilbake · svar 0 · priser 0 · ingen valgt variant |
| Tilbake, desktop 1280 | samme · ny rute + «Ja» → 6 070,31 / 4 643,75 uten gammelt valg |
| Tilbehør (sensorgel/sensortape/bunnlist/pyntelist) | stoppes i kandidatsøk **og** innsending; ekte glass med sensor-/listord slipper gjennom |
| 616-settet etter endring | 157 biler med kandidater · 4 208 kandidater · 945 løv · **0 feil** |
| Frontrute separat | 534 av 616, 0 tekniske feil |

## Hva releasen IKKE endrer

- **Flagg:** uendret (`ALL_GLASS_KANDIDATER_ENABLED` kun i `[env.staging.vars]`, produksjon beholder `MANUAL_QUOTE` for `/api/glass/valg`)
- **Skjema/migrasjoner:** ingen. `0047`/`0049`/`0050` kjøres ikke
- **Katalogdata:** uendret (30 937 rader, 15 variantkonflikter består uavklart)
- **XLS-prisregel:** uendret (`× 0,25 × 1,25`, estimat, «Pris på forespørsel» ved manglende pris)
- **Manuell tilbudskontroll:** uendret

## Rollback

Ved regresjon: deploy forrige versjon (`wrangler rollback` til `7ae6d2a6`) — ingen
dataskriving er gjort, så tilbakeføringen er ren kode-tilbakeføring.

**Venter på Toms eksplisitte GO.**
