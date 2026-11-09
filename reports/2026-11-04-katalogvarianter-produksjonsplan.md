# Katalogvarianter — sluttrapport og produksjonsplan

**Dato:** 2026-11-04
**Branch:** `copy/kvittering-20261103` → pushet som `feat/katalogvarianter-20261104`
**PR:** https://github.com/tajlive/finnbilglass/pull/28
**Commits:** `6d1249f` (variantidentitet) → `979dee6` (lik normalisering, GT-regel, kundereise)
**Staging:** `69abb8a9-9fd9-4b54-bddb-c2a13b7d7228`
**Katalogfil:** `/Users/taj/bilglass/PROSEKT API 16 MAI26.xls`, SHA-256 `479d7971d65041dc98782b89facb20817a954530bb22dcce7a478e00310fa595`
**Produksjon:** ikke endret — ingen migrasjon, ingen import, ingen deploy.

---

## 1. Utgangspunkt

| | |
|---|---|
| HEAD ved start | `90ff18e` |
| HEAD nå | `979dee6` |
| QA | 545 → **549/549 PASS**, `tsc --noEmit` exit 0 |
| Staging-D1 før | `finnbilglass-staging-catalog`, 29 627 rader |
| Staging-D1 etter | 30 937 → 30 949 rader (se pkt. 5 — tallet er forklart) |
| Produksjons-D1 | `finnbilglass-db`, 29 627 rader, **uendret** |

## 2. Undersøkelser

XLS lest med xlrd (formater inkludert), 34 800 rader klassifisert: 30 967 produktlinjer, 706 sideskift × 4 rapportrader, 707 kolonneoverskrifter, 302 andre. Deretter:

- `scripts/katalog-uttrekk.py` — kildeuttrekk med SHA-256, original + normalisert, varsler (numeriske identifikatorer, pris 0 vs. tom, mål-klassifisering).
- `scripts/katalog-sammenlign.py` — kilde mot DB, årsaksklassifisering av hvert tap.
- `scripts/katalog-avstemming.py` — **kan kjøres på nytt**, skriver den eksakte SQL-en bak hvert tall.
- `scripts/katalog-import-variant.py` — idempotent importgenerator, `--klassifiser-test` validerer radtype-reglene mot DB (99,98 % treff).
- `scripts/pilot-detalj.mjs` — detaljert API-svar per testbil (lag, kandidater, variantId).
- Kodegjennomgang: `src/vin-resolver.ts`, `src/glass-selection-contract.ts`, `src/index.ts` (`/api/inquiry`), `public/app.js`, `scripts/gt-generator.mjs`, `db/schema-katalog.sql`, alle 0048-migrasjoner, `db/katalog/prisliste_insert_*.sql`.
- Nettleser: Chrome via CDP, 390 px og 1280 px.

## 3. Rotårsaker (alle reprodusert, ingen gjettet)

| # | Feil | Bevis |
|---|---|---|
| 1 | `UNIQUE(varenr, varenavn)` kollapset varianter ved import | 1 275 kildevarianter med eurokode mangler i prod; **0** av dem skyldes andre årsaker |
| 2 | Tre ulike normaliseringer av `variant_id` | 0048 normaliserte eurokode men ikke varenr (185 rader), importøren fjernet alle ikke-alfanumeriske tegn, avstemmingen en tredje. Samme produkt fikk `41.0:3397110041`, `V5:PSL1501` og `V5:PSL-150-1` |
| 3 | SQLite `UPPER()` er ASCII-only | «på» → «På» i SQL, «PÅ» i Python; 30 nøkler stemte ikke |
| 4 | `Infinity` fra åpne intervaller | `Infinity − Infinity = NaN` → sorteringen ble no-op; 2024-RAV4 fikk 22 825-raden |
| 5 | ±1 års slakke på år-hint | «19-21» + slakke dekket 2022 og vant som mest spesifikk |
| 6 | Variantvalg var enkeltvalg | `prisKandidat()` LIMIT 1 + dedupe på varenr gjorde at bare én av åtte RAV4-varianter kunne vises |
| 7 | PINPOINT uten pris | BMW i7 2022 ble PINPOINT på en pris-0-rad da varianten kom inn |
| 8 | GT lagrer varenr, ikke eurokode | 3 778 av 4 283 GT-koder er varenr → GT kan ikke skille varianter |
| 9 | 3 junk-rader i produksjonsbasen | `PRISLISTE SORTERT ETTER VARENR`, `AUTOGLASS AS`, `VARENR`/`EUROKODE` ble importert som produkter |
| 10 | `v_glass_med_typekode` sprengte D1s CPU-grense | `LEFT JOIN … ON UPPER(t.varenr) = UPPER(p.varenr)` gjør indeksen ubrukelig; målt 36,15 s → CPU-feil 7429 |

**Avkreftet:** «varenr behandles som unikt» (nei, `(varenr,varenavn)`); «GT-årene er feil for RAV4» (nei); «XLS har dimensjonskolonne» (nei — 4 dokumenterte glassmål i fritekst, resten emballasje/sensor/speil); «tapene skyldes numeriske ID-er» (nei, 0 av 1 275).

## 4. Endringer

| Fil | Endring |
|---|---|
| `migrations/0048_glass_prisliste_variant_id.sql` | `variant_id` (varenr + full eurokode), unik indeks erstatter de to (varenr,varenavn)-indeksene, backup-tabell, view droppes og gjenopprettes i 0048b |
| `migrations/0048b_view_typekode.sql` | gjenoppretter `v_glass_med_typekode` (prod har ikke `glass_typekode`) |
| `migrations/0048c_variant_id_normalisering.sql` | én kanonisk regel for alle ledd; konfliktregister `glass_variant_konflikt` + `v_variant_konflikt`; fjerner identiske duplikater fra tidligere import |
| `migrations/pending/0049_typekode_uttrykksindeks.sql` | `CREATE INDEX … ON glass_typekode(UPPER(varenr))` — 36 s CPU-feil → 1,37 s |
| `src/vin-resolver.ts` | `variantNokkel`, `prisRaderEtterAar`, `prisKandidater`, `byggKandidat`, `utfraKandidater` eksportert, `pinpointTillatt`, `variantId` i kandidat/resultat, GT-regel dokumentert |
| `src/index.ts` | `/api/inquiry` validerer `variantId` mot D1, avviser ukjent (400), sjekker tilhørighet mot kandidatsettet, notatet får «Valgt variant …» |
| `public/app.js` | valgt kandidat bærer `variantId`/`eurokode`; forespørselen sender `variantId` + `bil` |
| `tests/id-familie.test.mjs` | 6 nye tester (variantnøkkel, 8-varianter-årvalg, 2022 ≠ 19-21, årang-utelukkelse, priskrav, GT-regel) |

## 5. Dataavstemming (kjøres på nytt med `scripts/katalog-avstemming.py`)

**Kilder og definisjon:** variant = `varenr` + full eurokode; uten eurokode = `varenr` + varenavn. Kode = `UPPER(TRIM(x))` med float-artefakt `.0` fjernet (SQLite-ASCII-semantikk).

| Måling | Tall |
|---|---|
| Produktlinjer i XLS | 30 967 |
| Unike varianter i XLS | 30 919 (48 duplikater i kilden) |
| Unike eurokoder i XLS | 26 023 |
| Rader uten eurokode i XLS | 4 194 |
| Ra­der i produksjon | 29 627 |
| Unike varianter i produksjon | 29 612 (15 duplikater) |
| Unike eurokoder i produksjon | 24 753 |
| I begge | 29 609 |
| Bare i XLS | **1 313** |
| Bare i produksjon | **3** (junk-radene) |

**Eurokode-regnestykket:** 26 023 − 24 753 = **1 270** = 1 271 (bare i XLS) − 1 (bare i produksjon). Restdifferanse: **0**.

**De 1 313 manglende variantene:** 1 275 der eurokoden ikke finnes i produksjon i det hele tatt + 29 der eurokoden finnes under et annet varenr + 9 uten eurokode. **1 275 er tallet på «tapte varianter»; 1 313 er antallet variantnøkler som måtte legges til.**

**Importen:** 1 313 rader skrevet, `ON CONFLICT(variant_id) DO NOTHING`. Staging gikk fra 29 627 til 30 940. Etter normaliseringsfiksen (0048c) er tallet **1 325** «nye i staging» fordi 12 nøkler endret seg da regelen ble lik — de var importert med en ikke-kanonisk nøkkel.

**Staging i dag:** 30 949 rader, 30 949 unike `variant_id`, **0 kildevarianter mangler**. 18 rader finnes i staging men ikke i kilden: 3 junk-rader + 15 registrerte duplikatkonflikter (`glass_variant_konflikt`).

**GT presisert:** 32 307 GT-rader, 4 283 unike koder, hvorav 3 778 er **varenr**. «128 GT-refererte varenr» betyr derfor 128 varefamilier der GT peker på et varenr som har ufullstendige varianter — **ikke** 128 bekreftede variantkoblinger.

## 6. Variantidentitet — robusthet

| Kontroll | Resultat |
|---|---|
| Samme varenr + eurokode med ulikt navn/pris | 15 grupper; registreres i `glass_variant_konflikt` og beholder begge rader med `#n`-suffiks. Ingen stille sammenslåing |
| Rader uten eurokode | 4 194 i kilden; nøkkel = varenr + varenavn; 9 manglet i prod og er lagt inn |
| Store/små bokstaver og mellomrom | Kanonisk regel; SQLite-ASCII-upper brukes identisk i SQL og Python |
| Numeriske varenr / ledende nuller | 187 varenr, 316 eurokoder er tallceller. Tre rader (Excel-format `000`) vises som `041`/`080`/`099` — flagget, ikke gjettet |
| Entydig sammensetning | `varenr:eurokode`; unik indeks håndhever det |
| Stabilitet ved gjentatt import | Kjørt to ganger: 30 949 → 30 949, 0 nye |
| Referanser til gamle ID-er | `id` er bevart uendret gjennom rebuild; `glass_typekode` har ingen FK i verken staging eller prod |

**`ON CONFLICT DO NOTHING` kan skjule konflikter** — derfor: importen rapporterer nye/uendrede/avvik, og `glass_variant_konflikt` + `v_variant_konflikt` gjør avvik synlige. Importen endrer **ikke** pris eller radtype på eksisterende rader (prisgrunnlaget er ikke avklart).

## 7. GT og sikkerhet — hva som nå kreves for PINPOINT

Håndhevet i `utfraKandidater` + `gtRaderKandidater`:

1. GT-kode på **varenr** alene er ikke variantbevis. PINPOINT krever at varenr + bilens år peker på **nøyaktig én** dokumentert variant.
2. GT-kode som er en **full eurokode** (b2b-seed) er eksplisitt variantbevis.
3. Kjent pris > 0 er nødvendig, men ikke bevis på passform.
4. Rader hvis dokumenterte årang **utelukker** bilens år tilbys ikke.

**15 PINPOINT-biler i 117-settet** — alle L1 (ground_truth), én kandidat, kjent pris, årang som dekker bilen:

| Bil | Varenr / eurokode | Listepris |
|---|---|---|
| BMW iX 2022 | 2300AGAC / 2300AGACMVZ (GT er eurokode) | 8 600 |
| Mazda CX-3 2018 | 5184AGAC / 5184AGACMVW3L | 9 220 |
| Mitsubishi L200 1999 | 2079GN / 5650AGN | 6 375 |
| Mitsubishi Outlander 2014 | 3186GYM / 5697AGAMV | 11 195 |
| Nissan Leaf 2021 | 3111GN / 6077AGAVZ1D | 6 140 |
| Porsche Taycan 2022 | 6746AGAG / 6746AGAGYCMVZ | 19 290 |
| Tesla Model Y 2023 | 8103AGCC / 8103AGCCHIMVZ1S | 14 520 |
| Toyota Land Cruiser 2008 | FW2652GY / FW2652GYY | 8 990 |
| VW ID.3 2020 | 8652AGAC / 8652AGACMVZ | 10 210 |
| Volvo V60 2018 | 3185GNMP / 8841AGNMPVWZ7X | 6 990 |
| Volvo XC60 2015 | 3175GNEL / 8840AGNHMPVWZ6 | 11 415 |
| Toyota C-HR 2021 | 8421AGAC / 8421AGACHMVZ1L | 13 230 |
| Toyota Camry 1999 | 2059GY / 8302AGNGYV | 5 665 |
| VW Amarok 2018 | 3046GNM2 / 8609AGSMVW1P | 10 750 |
| VW Tiguan 2013 | 2836GNCM / 8595AGACMVZ3P | 8 985 |

Fire av dem (iX, L200, ID.3, XC60) er **nye** siden forrige kjøring. Årsaken er at en kandidat hvis dokumenterte årang utelukket bilen ikke lenger teller med — ikke at evidensgaten er svekket. **Ingen av de 15 har flere varianter for samme år**, så ingen hviler på et tilfeldig valg fra et delt varenr.

## 8. Verifisering

| Kontroll | Resultat |
|---|---|
| `npm run qa` | **549/549 PASS**, exit 0 |
| `npm run typecheck` | grønn |
| 117 biler, staging `69abb8a9` | PINPOINT **15**, VERIFY **78**, FALLBACK **24**, kandidater 291, tekniske feil **0** |
| Latens | p50 **337 ms**, p95 **1 164 ms**, maks **1 339 ms** |
| Endrede utfall | **35**, alle forklart (RAV4 7 biler VERIFY/1→3, i7 FALLBACK→VERIFY/1, V60 2018 PINPOINT tilbake, 4 nye PINPOINT, 22 kandidattall-endringer) |
| Fasit | 2 av 117 biler har kontrollert fasit (begge SAMSVAR). **Dette sier ingenting om de 115 andre** |
| Nettleser 390 px | 3 varianter, ingen horisontal overløp (scrollWidth 390), utstyrsspørsmål, «Andre mulige varianter» |
| Nettleser 1280 px | 3 varianter; etter «Nei» på oppvarmet frontrute gjenstår **én** variant (RAV 4 22- FR AKU LDW, veiledende 5 490 kr) |
| Ingen kandidater (BMW i3 2017) | Ærlig melding: «Vi fant ingen dokumenterte glass … Det betyr ikke at ruten ikke finnes» |
| Tastatur | Synlig fokus (3 px solid outline) på input og knapper |
| Migrasjonsprøve | Isolert SQLite-kopi med prod-dump: 29 627 → 29 627 rader, 29 627 unike `variant_id`, 0 tapt, 0 duplikater |
| Tilbakeføring prøvd | Backup gir 29 627 rader tilbake; saker som nevner nye varianter er fortsatt lesbare (varianten står som tekst i saken) |

**Ikke verifisert i nettleser:** oppsummeringssiden/innsending ende-til-ende, bytte av bil etter valgt variant, gjenåpning i `/ops` etter innsending. Flyten stopper på utstyrsspørsmålet i frontrute-steget; innsending krever syntetisk kontakt og er ikke kjørt mot staging i denne runden.

## 9. Åpne forhold

1. **318 frontruter uten pris** (90 av dem nye varianter): 0 i kilden betyr «ikke priset». De vises med «Pris på forespørsel», kan aldri bli PINPOINT, og pris kopieres aldri fra en søskenvariant. Liste: `reports/pris0-frontruter-20261104.csv`.
2. **GT kan fortsatt ikke uttrykke variant.** Å lagre full eurokode per GT-rad er neste steg, men krever at kilden kan knytte år → eurokode entydig (i dag 3 varianter for samme år).
3. **`gt-generator.mjs` deduperer på (make, model, year, varenr)** — varianter som deler varenr får én GT-rad. Ikke rettet (endrer GT-innhold, krever dokumentasjon).
4. **3 junk-rader i produksjonsbasen** må ryddes (egen godkjenning).
5. **UI:** utstyrsspørsmålet blir stående etter at kunden har svart og bare én variant gjenstår.
6. **Klientens `bil`-felt** brukes til tilhørighetssjekk bare når modell og år finnes; ellers merkes saken «tilhørighet: ikke_verifisert» i notatet.
7. **`v_glass_med_typekode`** er rask nok med uttrykksindeksen, men bør skrives om (normalisert kolonne) før den brukes i kundespørringer.

## 10. Produksjonsplan (ikke utført)

**Forutsetninger:** eksplisitt godkjenning av hvert trinn. Ingen skriving til produksjonsdata i denne runden.

| Steg | Handling | Kontrollpunkt | Stoppkriterium |
|---|---|---|---|
| 0 | Backup: `CREATE TABLE glass_prisliste_backup_0048 AS SELECT * FROM glass_prisliste` | `count(*) = 29 627` | avvik → stopp |
| 1 | Kjør `0048_glass_prisliste_variant_id.sql` | 29 627 rader, 29 627 unike `variant_id`, 0 NULL | avvik → kjør tilbakeføring |
| 2 | Kjør `0048c_variant_id_normalisering.sql` | `v_variant_konflikt` = 15 rader | >30 → stopp og undersøk |
| 3 | Import `variant_upsert_00..02.sql` | 30 940 rader, RAV4 8/8 | avvik → stopp |
| 4 | Kjør `scripts/katalog-avstemming.py` mot prod | `bare_kilde = 0`, `bare_prod = 3` | avvik → stopp |
| 5 | Deploy Worker (`main` etter PR #28) | `/api/frontrute` for RAV4 2024 gir 3 varianter | feil → rull kode tilbake |
| 6 | Verifiser kundereise + `/ops` | én sak med valgt variant, riktig eurokode i notatet | feil → rull kode tilbake |

**Rekkefølge ved tilbakeføring:** (1) applikasjonskode tilbake først, (2) deretter data. Målt i prøven: ny kode mot gammelt skjema feiler på `variant_id`-kolonnen (fanges, men gir 400 «Ukjent variant» for nye varianter), og rader lagt inn etter migrasjonen forsvinner ved data-tilbakeføring. **Saker som nevner en ny variant forblir lesbare**, fordi variant og pris er lagret som tekst i saken — men koblingen til katalogen må slås opp på nytt etter en ny import.

**Midlertidig skrivestans:** ikke nødvendig; migrasjonen er en rebuild av én tabell uten samtidige skrivinger fra Worker, men /ops-innsendinger bør unngås i vinduet mellom steg 1 og 3 (±1 minutt).

**Kontrollsummer:**

| Fil | SHA-256 |
|---|---|
| `variant_upsert_00.sql` | se `shasum -a 256 db/katalog/variant_upsert_*.sql` ved kjøring |
| `0048_…sql`, `0048c_…sql` | idem |

## 11. Sporbarhet

- Commits: `6d1249f`, `979dee6` (branch `feat/katalogvarianter-20261104`, pushet)
- PR: **#28** — https://github.com/tajlive/finnbilglass/pull/28
- Staging: `69abb8a9-9fd9-4b54-bddb-c2a13b7d7228`
- Rapporter: `reports/katalog-uttrekk-20261104.{json,csv}`, `katalog-analyse-20261104.json`, `katalog-sammenlign-20261104.json`, `katalog-avstemming-20261104.json`, `endringer-20261104.csv`, `endringer-siste-20261104.csv`, `pris0-frontruter-20261104.csv`, `for-/etter2-/siste-20261104-*.csv`
- Skjermbilder: `~/.config/browser-harness/tmp/p-65b1dba03101/shot.png` (mobil 390, desktop 1280, ingen kandidater)
- Andre lokale endringer (`.worktrees/`, `scripts/out/*.png`, `reports/pilot-*-v4.csv`, `docs/v6-4-6-*`) er **ikke** committet — de tilhører andre oppdrag.

## 12. Vurdering

**Klar for produksjonsgodkjenning med konkret beskrevne begrensninger.**

**Bevist:** at varianttapet var systemisk og skyldtes identitetsnøkkelen (1 275 varianter, 0 med annen årsak); at migrasjonen bevarer alle 29 627 rader og er reversibel; at importen er idempotent og ikke endrer priser; at avstemmingen går i null; at RAV4-variantene nå vises samtidig i UI på mobil og desktop; at PINPOINT aldri hviler på et tilfeldig valg fra et delt varenr; at reporting-view-en er rask nok etter indeksen; at hele 117-settet kjører uten tekniske feil.

**Bygger på katalogopplysninger, ikke uavhengig bevis:** årangene (19-21, 2019-, 22-) og utstyrsforskjellene er Autoglass-prislistens egne tekster. Ingen leverandørbekreftelse foreligger. RAV4-sperren står derfor.

**Mangler fortsatt:** verifisert innsending + `/ops`-gjenåpning i nettleser; prisavklaring på 318 frontruter; GT-kobling på eurokodenivå; opprydding av 3 junk-rader; og mobil/tilbakeknapp i hele flyten er bare delvis gjennomgått.
