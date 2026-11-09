# Arbeidsrapport — katalogvarianter, RAV4 og variantidentitet

**Dato:** 2026-11-04
**Oppdrag:** gjennomgå XLS-katalogen, finne ut om produktvarianter forsvinner eller blandes, rette dokumenterte feil, verifisere i staging.
**Miljø:** lokal analyse + staging (`finnbilglass-frontrute-staging`, D1 `finnbilglass-staging-catalog`). **Produksjon er ikke endret.**

---

## 1. Hva som ble undersøkt

| Element | Verdi |
|---|---|
| Kildefil | `/Users/taj/bilglass/PROSEKT API 16 MAI26.xls` |
| SHA-256 | `479d7971d65041dc98782b89facb20817a954530bb22dcce7a478e00310fa595` |
| Ark | `Sheet1`, 34 800 rader, 7 kolonner |
| Rapportdato i filen | 16.05.2026 20:19:08 |
| Produktlinjer (målt) | **30 967** (resten: 706 sideskift × 4 rapportrader + 707 kolonneoverskrifter + 302 andre) |
| Unike varenr / eurokoder | 27 759 / 26 023 |
| Produksjons-D1 `glass_prisliste` | 29 627 rader, 27 763 varenr, 24 753 eurokoder |
| Staging-D1 etter endring | 30 937 rader, 30 937 unike `variant_id` |
| GT (prod) | 32 307 rader, 4 283 unike koder, 3 778 av dem er varenr |

Kodeområder gjennomgått: `src/vin-resolver.ts` (`prisKandidat`, `gtRaderKandidater`, `utfraKandidater`, `pinpointSperre`), `scripts/gt-generator.mjs`, `db/schema-katalog.sql`, `migrations/*`, `db/katalog/prisliste_insert_*.sql` (den faktiske importen), kunde-UI (`public/app.js` via browser), `/api/regnr`.

Nye analyseverktøy: `scripts/katalog-uttrekk.py` (kildeuttrekk med SHA-256, normaliserte felt og varsler), `scripts/katalog-sammenlign.py` (kilde mot DB), `scripts/katalog-import-variant.py` (idempotent importgenerator), `scripts/pilot-detalj.mjs` (detaljert API-svar per testbil).

### De åtte RAV4-radene — bekreftet ord for ord

Tom-s tabell er korrekt med **Excel-radnummer (1-basert)**; xlrd-indeksen er én lavere (27510–27517). Alle åtte er lest på nytt fra originalfilen:

| Excel-rad | Varenr | Eurokode | Navn | Merknad | Pris |
|---|---|---|---|---|---|
| 27511 | 8432AGAC | 8432AGACHM | RAV 4 **19-21** FR AKU LDW | FULLY HEATED | 19 410 |
| 27512 | 8432AGAC | 8432AGACHMU | RAV 4 **2019-** FR AKU LDW | FULLY HEATED | 22 825 |
| 27513 | 8432AGAC | 8432AGACHMUV1E | RAV 4 2019- WS GN ACO LDW | HEATED WIPER AREA | 15 810 |
| 27514 | 8432AGAC | 8432AGACHMV1E | RAV 4 2019- WS GN ACO LDW | HEATED WIPER AREA | 16 230 |
| 27515 | 8432AGAC | 8432AGACHMV1L | RAV 4 **22-** FR AKU LDW | FULLY HEATED ENDRET | 19 425 |
| 27516 | 8432AGAC | 8432AGACHMV30 | RAV 4 **22-** WS GN ACO LDW | HEATED WIPER AREA | 14 860 |
| 27517 | 8432AGAC | 8432AGACMV | RAV 4 2019- FR AKU SENSOR | – | 0 (ikke priset) |
| 27518 | 8432AGAC | 8432AGACMV1L | RAV 4 **22-** FR AKU LDW | IKKE ELEKTRISK ENDRET | 10 745 |

---

## 2. Hva som faktisk var feil

### 2.1 Rotårsak: identiteten var `(varenr, varenavn)` — ikke eurokoden

`glass_prisliste` hadde `UNIQUE(varenr, varenavn)` (migrasjon 0002 + to dupliserte unike indekser fra 0007). Importen brukte `INSERT OR IGNORE`. Når to rader har samme varenr **og** samme varenavn, men ulik eurokode, ble den andre stille forkastet.

Målt konsekvens mot kilden: **1 275 varianter med eurokode mangler i prod**, fordelt på **1 005 varenr-familier**:

| Årsaksklasse | Antall |
|---|---|
| A — `UNIQUE(varenr, varenavn)` kollapset raden | **1 275** |
| B — numerisk identifikator | 0 |
| C — ukjent | 0 |

**363 av de tapte er frontruter** (282 varenr; 276 med pris > 0, 85 med pris 0, 2 uten pris), og **128 varenr som `ground_truth` peker på** har ufullstendige varianter. Eksempler: `6573LGSV3` (6 eurokoder i kilden, 1 i basen), `8848AGCC` (6 → 3), `2303AGAC` BMW X1 (mangler 3), `2487AGAC` (7 → 3).

For RAV4 konkret: **8 i kilden, 6 i basen.** Tapt: `8432AGACHMV1E` (16 230 kr) og `8432AGACMV1L` (10 745 kr). Begge er dokumentert videre: rad 26940 fører `8048AGAC` med navnet «USE 8432AGACHMV1E» — altså peker kildens egen erstatter-regel på nettopp en av variantene som forsvant.

Feilen lå i **lagring + import**, ikke i GT eller visning.

### 2.2 Feil i forrige ukes årvalg (`velgPrisRadEtterAar`, commit 06585f4)

To målte feil, begge reprodusert med den ekte funksjonen på de åtte radene:

1. **Åpent intervall ble aldri sortert.** `parseAar` gir `Infinity` for «2019-»; `Infinity − Infinity` er `NaN`, så spesifisitetssorteringen ble en no-op. En 2024-bil fikk dermed første rad (22 825 kr, «2019-») i stedet for 22-varianten.
2. **±1 års slakke snudde valget.** Slakken ble brukt på år-hintet fra varenavnet, så `19-21` + slakke dekket 2022 og vant som «mest spesifikk». **En 2022-RAV4 fikk 19-21-ruten.** (Samme feilklasse som Porsche 996-saken, men i en ny funksjon.)

### 2.3 Numeriske identifikatorer

187 varenr og 316 eurokoder er tallceller. Importen skrev dem som `41.0`/`3397110041.0`; kilden har `041`/`3397110041`. Tre rader (9, 11, 12) har Excel-format `000`, dvs. visningen er **`041`, `080`, `099`** — de er ikke gjenskapt (ingen gjetting), men flagget i uttrekket og normalisert kun i `variant_id`.

Pris 0 er «ikke priset» i kilden; importen gjorde den om til `NULL`. 4 097 rader i kilden har pris 0.

### 2.4 Mål i cm — kravet stemmer, men ikke som kolonne

Filen har **ingen størrelseskolonne**. Mål finnes som fritekst i `Merknad`/`Varenavn`, og de gjelder fire ulike ting:

| Type | Antall | Eksempel |
|---|---|---|
| Sensor-/kamerasone (mm) | 42 | `SENSORPAD S3 B25*H34MM` (også på RAV4-rad 27511) |
| Emballasje (ukjent/cm) | 127 | `EMBALLASJE LITEN (1150x150x720)` |
| Glassmål (dokumentert) | **4** | `OBS MÅL 84X149`, `MÅL 48,5X76,5`, `OK MÅL=1335*935` |
| Speilplassering | ~ | `SPEIL 10 CM NED PÅ RUTEN` |

173 linjer har mål totalt; **4 kan dokumenteres som glassmål**. RAV4-radene har kun sensorpute-mål, ingen rutedimensjon. `glass_catalog.dimensions` er `null` for alle tre RAV4-eurokodene. Mål dekker altså ikke behovet for å skille RAV4-variantene, og brukes ikke som PINPOINT-grunnlag.

### 2.5 Avkreftede hypoteser

- **«Varenummer alene behandles som unikt»** — nei, nøkkelen var `(varenr, varenavn)`; varenr var aldri unik.
- **«GT-årene er feil for RAV4 2022-2025»** — nei. GT-årene kommer fra de dokumenterte `22-`-radene. GT-årene er ikke endret.
- **«XLS-en har en dimensjonskolonne»** — nei (se 2.4).
- **«Tapte varianter skyldes numeriske identifikatorer»** — nei, 0 av 1 275.
- **Andre arbeidsbøker med mål** (`Abdeckungsliste_CSC_V78`, `SUPPLIES_04-2026`, `5724.xls`) er undersøkt og avvist: kalibreringstabell, merkevareliste og tilbud — ingen rutedimensjoner.

---

## 3. Hva som ble endret

### `src/vin-resolver.ts`
| Endring | Begrunnelse |
|---|---|
| `variantNokkel(varenr, eurokode, varenavn)` | Identitet = varenr + full eurokode (uten eurokode: varenr + navn). Eksportert og testet. |
| `prisRaderEtterAar()` erstatter `velgPrisRadEtterAar()` | Lukket intervall før åpent, kortest spenn / senest start; **ingen** slakke på varenavn-år; returnerer hele den beste gruppen (ekte utstyrsvarianter). `velgPrisRadEtterAar` beholdt som tynn wrapper. |
| Rader hvis dokumenterte årang **utelukker** bilens år forkastes | En «23-»-rute skal ikke tilbys en 2018-bil. Rader uten årang beholdes. |
| `prisKandidater()` + `byggKandidat()` | Ett oppslag kan gi flere varianter; `prisKandidat()` er første (VIN-overstyring, katalog-eurokode, ktype). |
| `gtRaderKandidater()` deduperer på variant, ikke varenr | Ellers ville variantene blitt slått sammen i L1 også. |
| `utfraKandidater()`: PINPOINT krever kjent pris (`pinpointTillatt`) | Målt: BMW i7 2022 ble PINPOINT på en pris-0-rad. Ukjent pris → VERIFY. |
| `ResolverKandidat.variantId` / `ResolverResultat.variantId` | Valgt variant følger svaret ut til API/kunde/ops. |
| RAV4-sperren (`pinpointSperre`) | **Beholdt** som belte-og-bukseseler. Den er nå overflødig for 2022-2025 (den generiske regelen gir VERIFY), men fjernes ikke før leverandøren har bekreftet årangene. |

### Datastruktur
`migrations/0048_glass_prisliste_variant_id.sql` (kjørt i staging, **ikke** i prod):
- `glass_prisliste_backup_0048` — full kopi før inngrep (rollback-grunnlag).
- Ny tabell uten `UNIQUE(varenr, varenavn)`, med `variant_id`; `ROW_NUMBER` gir `#2`-suffiks der samme (varenr, eurokode) finnes med ulikt navn (konflikten blir synlig i stedet for at data forsvinner).
- `uq_glasspris_variant_id` unik indeks; de to `(varenr, varenavn)`-indeksene fjernet; oppslagsindeksene gjenopprettet.
- `0048b_view_typekode.sql` gjenoppretter `v_glass_med_typekode` (måtte splittes: prod har ikke `glass_typekode`).

**Rollback:** `DROP TABLE glass_prisliste; ALTER TABLE glass_prisliste_backup_0048 RENAME TO glass_prisliste;` + indeksene fra 0002/0007/0032.

### Import
`db/katalog/variant_upsert_00..02.sql` (1 313 varianter), generert av `scripts/katalog-import-variant.py`:
- `INSERT … ON CONFLICT(variant_id) DO NOTHING` → gjentatt kjøring er no-op (verifisert).
- **Eksisterende rader endres ikke** — ingen nye kundepriser, ingen endret `rad_type` (Tom: prisgrunnlaget er ikke avklart).
- `rad_type`-klassifiseringen treffer **99,98 %** av de 29 627 eksisterende radene (5 avvik, alle forklart).
- Identifikatorer skrives som tekst; pris 0 → `NULL` som før (dokumentert konvensjon).

**Omfang:** produktdata er endret **kun i staging-D1**: 29 627 → 30 937 rader (+1 313 varianter). `ground_truth` er **ikke** rørt (32 307 rader før og etter). Produksjons-D1 er uendret.

---

## 4. Hva som ble testet

### Kommandoer og status
```
npm run qa        → EXIT 0, 548/548 tester PASS (var 545 ved oppdragets start)
npm run typecheck → EXIT 0 (tsc --noEmit)
```
Nye tester: `tests/id-familie.test.mjs` — variantnøkkel, 8-varianter-årvalg, 2022 ≠ 19-21, årang som utelukker bilen, PINPOINT-priskrav.

Lokal DB-rehearsal (SQLite på ekte prod-dump): 29 627 → 29 627 etter 0048, 0 duplikate `variant_id`, +1 310 etter import, gjentatt import = uendret.

### 117 biler mot staging (før = `før`-kjøring 08:33, etter = `etter2`-kjøring 09:0x, staging-versjon `2399af69`)

| | FØR | ETTER |
|---|---|---|
| PINPOINT | 11 | 15 |
| VERIFY | 81 | 78 |
| FALLBACK | 25 | 24 |
| Kandidater totalt | 263 | 291 |
| Tekniske feil | 0 | 0 |
| Endrede biler | – | 35 (se `reports/endringer-20261104.csv`) |

**Alle 35 endringer er forklart med data, ikke med kode:**

- **RAV4 2023/2024 (7 biler): VERIFY/1 → VERIFY/3.** De tre `22-`-variantene vises nå samtidig (FULLY HEATED ENDRET, HEATED WIPER AREA, IKKE ELEKTRISK). Sperren står, så det er fortsatt VERIFY.
- **BMW i7 2022: FALLBACK/0 → VERIFY/1** — ny variant med pris 0 (ikke PINPOINT, takket være priskravet).
- **V60 2018: tilbake til PINPOINT/1** — «23-»-raden tilbys ikke en 2018-bil.
- **4 PINPOINT-gevinster** (BMW iX 2022, Mitsubishi L200 1999, VW ID.3 2020, Volvo XC60 2015): det eneste som endret seg er at en kandidat hvis **dokumenterte årang utelukker bilen** ikke lenger teller med. Alle fire er L1 (ground_truth), entydig kode, kjent pris, og årangen dekker bilen.
- **Øvrige 22 endringer er kandidattall** (Corolla/ID.4/XC60 får 1–2 flere, Kona/Expert/Caddy 1–2 færre) med uendret utfall.
- **ID-familien, PRIUS PLUS og V60-lempen er uendret** (testet).

### Nettleserbevis (staging, Chrome, desktop-viewport)
Regnr `DS30475` (Toyota RAV4 2024):
1. Ruteforside: «Toyota RAV4 · 2024», «10 dokumenterte glass for denne bilen», **4 dokumenterte frontruter**.
2. Frontrute: **tre varianter samtidig** — `RAV 4 22- FR AKU LDW` (oppvarmet, regnsensor, sol-/varmereflekterende, antenne), `RAV 4 22- WS GN ACO LDW` (samme utstyr), `RAV 4 22- FR AKU LDW` **uten oppvarmet** med «Veiledende fra 5 490 kr».
3. Spørsmål: «Har bilen oppvarmet frontrute?» med Ja/Nei/Vet ikke.
4. Etter svar **Nei**: listen avgrenses til **én** variant — nettopp `8432AGACMV1L`, den som manglet i basen før denne runden.

**Ikke fullført i nettleser:** oppsummeringssiden og tilbakeknappen ble ikke testet ende-til-ende — frontrute-flyten stopper på utstyrsspørsmålet i dette steget (ingen «Velg dette glasset»-knapp der). Mobil-viewport er ikke testet. Se pkt. 6.

---

## 5. Hva som gjenstår

1. **Produksjonsmigrasjon 0048 + import** — krever Toms eksplisitte godkjenning. Rollback er dokumentert; staging-bevis foreligger.
2. **Pris-0-varianter (85 tapte frontruter + 4 097 kildrader)**: bør avklares med leverandøren. I dag vises de som kandidat med «Pris på forespørsel», aldri PINPOINT.
3. **GT kan ikke uttrykke variant.** `gt-generator.mjs` skriver varenr i `frontrute_eurocode`, så GT sier «denne bilen bruker denne varefamilien», ikke hvilken eurokode. Å lagre eurokode per GT-rad er neste naturlige steg, men krever at kilden kan knytte år → eurokode entydig (i dag: 3 varianter for samme år).
4. **`gt-generator` kollapser varianter på samme måte**: nøkkelen er `(make, model, year, varenr)`. Varianter som deler varenr får én GT-rad. Ikke rettet (endrer GT-innhold, som krever dokumentasjon).
5. **UI-observasjon:** etter at kunden svarte «Nei» og bare én variant gjensto, ble spørsmålet «Har bilen oppvarmet frontrute?» stående. Kosmetisk/logisk opprydding i kundeflyten.
6. **Mobil-viewport og tilbakeknapp** er ikke verifisert.
7. **`v_glass_med_typekode` er dyr**: `SELECT count(*)` på view-en traff D1s CPU-grense (feil 7429). View-en er uendret fra 0020, men bør indekseres/omskrives før den brukes i produksjonsspørringer.
8. **Fasitgrunnlaget er tynt**: 2 av 117 biler har kontrollert fasit. Kandidatøkningen (263 → 291) er ikke kvalitetsbevis i seg selv.

---

## 6. Sporbarhet

| | |
|---|---|
| Branch | `copy/kvittering-20261103` |
| HEAD før arbeidet | `90ff18e` |
| Commit | se `git log -1` etter commit `fix(resolver): variantbevisst årvalg + variant_id` |
| Staging-versjon | `2399af69-0486-4284-b535-ff8bd685b897` (etter endring), `c119c1e9…` (mellomsteg) |
| Produksjon | **uendret** — ingen migrasjon, ingen deploy, ingen dataskriving |
| Filer | `reports/katalog-uttrekk-20261104.{json,csv}`, `reports/katalog-analyse-20261104.json`, `reports/katalog-sammenlign-20261104.json`, `reports/endringer-20261104.csv`, `reports/for-*`, `reports/etter2-*` |
| Skjermbilder | `~/.config/browser-harness/tmp/p-65b1dba03101/shot.png` (kandidatside, RAV4 2024) |

---

## 7. Vurdering

**Klar med beskrevne begrensninger** — for staging.

Tryggheten er styrket: en kandidat hvis dokumenterte årang utelukker bilen tilbys ikke lenger, PINPOINT krever kjent pris, og RAV4 2022+ gir tre varianter i stedet for én vilkårlig. Alle 35 endringene i 117-settet er forklart.

**Ikke klar for produksjon** før: (a) Tom godkjenner 0048 + import (rollback finnes), (b) mobil/tilbakeknapp er verifisert, (c) leverandøren har bekreftet at `8432AGAC` gjelder 2022–2025 slik at sperren kan vurderes fjernet.

> **RETTELSE 2026-11-04:** beløpet 5 490 kr bygget på den gamle regelen
> (listepris × 0,60 → faste trinn) og er erstattet. Gjeldende regel er
> `XLS-listepris eks. mva × 0,25 × 1,25` = **3 357,81 kr** for denne varianten.
> Se `reports/2026-11-04-pr28-prisregel-og-sluttkontroller.md`.
