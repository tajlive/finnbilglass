# ID-matching rettet + 117-bilers pilot (2026-11-04)

Svar på ordren «lokal ID.4/ID.5-avklaring og 500-bilers stagingkjøring», spor A og B.

**Kort:** ID.3-frontruten lekker ikke lenger til ID.4/ID.5/ID.7. 117 biler er kjørt på staging etter fiksen: **0 tekniske feil, 90 med kandidater (76,9 %), fasit 2/2 samsvar**. 500-bilers kjøring er fortsatt ikke mulig: det finnes 117 lovlige kjennemerker lokalt, og FINN.no forbyr automatisert innsamling.

---

## 1. ID-matchingen: feil, fiks og bevis

### 1.1 Feilen (målt)

| Observasjon | Verdi |
|---|---|
| `modellTokensAv('ID.4','VW')` før | `['ID']` — enkelttegnet «4» forkastes |
| `ordTreff` semantikk | sant når **minst ett** token finnes i katalograden |
| Følge | «ID» matchet ID.3, ID.4, ID.5 og ID.7 |
| Konkret skade | ID.3-frontruten `8652AGAC` / `8652AGACMUVZ` (katalog: «ID.3 5D HBK 2020-») ble tilbudt til ID.4 GTX, ID.4, ID.5 (FBG-T-0091/0093/0096/0097) |

### 1.2 Fiksen (tre deler, alle testes)

1. **`familieTokens()`** — modellfamilier med skilletegn + siffer/ bokstav bevares: «ID.4» → `ID4`, «MODEL 3» → `MODEL3`, «MODEL Y» → `MODELY`, «RAV 4» → `RAV4`. Motorkode-vakt: «TRANSIT 2.0» gir ikke familie-token.
2. **Generisk token gir ikke kandidatstøtte** — `ID`/`MODEL` blir ikke selvstendig token når familie-tokenet finnes, og `ordTreffKandidat()` krever et meningsbærende token. Prefiks-treffet hopper over generiske ord (ellers ville `MODEL3` matchet raden «MODEL Y»).
3. **SQL-forfiltreringen bruker rå ord** (`sqlTokensAv`) — `LIKE '%ID4%'` traff ingen rader fordi katalogen skriver «ID.4 SUV». Uten dette falt hele ID-familien til FALLBACK.

I tillegg er PR #26s kontrakt opprettholdt: `drivlinjeKonflikt()` hindrer at en variant kjøretøyet oppgir («V60 PLUG IN HYBRID», «RAV4 PHV») arver grunnmodellens rad. Vakten er ensidig, så GT-raden «NIRO (HYBRID)» fortsatt treffer en ren «Kia Niro». «+» normaliseres til PLUS bare når det står sist i ordet, så «PRIUS+» = «PRIUS PLUS», men «PASSAT SED+STV» forblir to ord.

### 1.3 Målt resultat per testbil (staging `0e6731f7`)

| Test-ID | Bil (SVV) | Før fiks | Etter fiks |
|---|---|---|---|
| FBG-T-0091 | VW ID.4 GTX 220 KW 2023 | VERIFY/3, hvorav 1 ID.3-rute | **VERIFY/2** — 8658AGAC, 8658ACKC. Ingen ID.3 |
| FBG-T-0093 | VW ID.4 PRO 4MOTION 2023 | VERIFY/3 | **VERIFY/2** |
| FBG-T-0094 | VW ID.4 2024 | VERIFY/3 | **VERIFY/2** |
| FBG-T-0090 | VW ID.4 GTX 2022 | VERIFY/3 | **VERIFY/2** |
| FBG-T-0096 | VW ID.5 PRO 150 KW 2023 | VERIFY/3 | **FALLBACK/0** — ingen ID.5-rad finnes |
| FBG-T-0097 | VW ID.5 2023 | VERIFY/3 | **FALLBACK/0** |
| FBG-T-0098/0099 | VW ID.7 2025 | VERIFY/3 | **FALLBACK/0** |
| FBG-T-0088 | VW ID.3 2020 | VERIFY/3 | **VERIFY/1** (kun ID.3-raden) |

**Konklusjon per variant:**

- **ID.4 (alle varianter, inkl. GTX):** `VERIFY` med to ID.4-ruter (`8658AGAC` = GN ACO CAMERA BRACKET, `8658ACKC` = CK CAMERA BRACKET RS). Katalogen skiller ikke GTX fra vanlig ID.4 — det skal den ikke gjøre før fitment er dokumentert. **Behold VERIFY.**
- **ID.5:** `FALLBACK` → manuell kontroll. Katalogen har **null ID.5-rader**; før fikk kunden ID.3- og ID.4-glass. **Dette er den trygge fallbacken ordren ba om**, og den kom uten egen resolver-gren: når ingen rad matcher familien, blir svaret FALLBACK.
- **ID.7:** samme som ID.5 — ingen ID.7-rad i katalogen, nå FALLBACK i stedet for ID.3/ID.4-glass.

### 1.4 Kan den tidligere PINPOINT bekreftes?

Nei — og det er ikke lenger relevant: den tidligere tilstanden var `VERIFY`, og PINPOINT-forsøket er ikke reproduserbart fordi staging-bygget før endringen ikke kan spores til en commit. Det som **er** dokumentert nå, er at kandidatsettet ikke lenger blandes mellom ID-modellene.

---

## 2. Datagrunnlag: 117 biler, ikke 500

### 2.1 Inventar

| Kilde | Brukbare | Merknad |
|---|---|---|
| `data/finn-100.jsonl` | 110 | finnkode + kjennemerke + merke/modell/år |
| `data/fixtures/self-test-50-cars.json` | 6 unike utover finn-settet | fast regresjonskohort (v1, 2026-08-19) |
| `data/fasit-utvalg.csv` | 1 unik | SU18018 |
| **Sum** | **117** | = `testgrunnlag v1`, seed `20261104` |
| Syntetiske plassholdere | 16 | `AA12345`, `ZZ00000`, `XX99999` … — **ikke brukt** |
| Katalog-plassholdere (`FD23776` …) | 9 | ikke ekte biler — **ikke brukt** |
| Testskilt i kode uten bilinfo | 5 | `JD79487`, `XD84921`, `EL21939`, `UR67407`, `KE42110` |

### 2.2 Hvorfor 500 ikke kan nås nå — og en compliance-funn

- **FINN.no forbyr automatisert innsamling:** `https://www.finn.no/robots.txt` sier eksplisitt: *«Crawling FINN.no is prohibited unless you have written permission.»* De 110 kjennemerkene i repoet er allerede hentet derfra; **videre innsamling på det grunnlaget er ikke lovlig**.
- SVV åpne data gir oppslag per kjennemerke, ikke lister over biler.
- Prod-D1 har 9 reelle kundehenvendelser — for få, og de er kundedata.

**Anbefalt kilde (én, jf. ordren):** skriftlig avtale med en registerleverandør som har lovlig grunnlag for uttrekk, **eller** skriftlig tillatelse fra FINN. Begge er kommersielle/juridiske beslutninger for Tom. Inntil da er 117 taket.

---

## 3. Kjøringen: 117 biler på staging

| Felt | Verdi |
|---|---|
| Staging-versjon | `0e6731f7-42d6-430e-87fb-1af0cd63fbe4` |
| Kall | **117** (51 regresjon + 50 tilfeldig + 16 reserve) |
| `lookupOnly: true` | Ja, på hvert kall — ingen D1-skriving, ingen henvendelse, ingen e-post, ingen R2 |
| Tekniske feil | **0** |
| Latens p50 / p95 / maks | **264 ms / 922 ms / 1 055 ms** |
| Kandidater funnet | **90 av 117 (76,9 %)** |
| Uten dekning | 27 (23,1 %) |
| Utfall | PINPOINT 18 · VERIFY 72 · FALLBACK 27 |
| Fasit (SU18018, AJ95429) | **2 av 2 SAMSVAR** |

### 3.1 Sammenligning mot 101-piloten (samme test-ID-er)

**20 av 101 utfall endret.**

| Endring | Biler | Vurdering |
|---|---|---|
| ID.3-ruten fjernet fra ID.4 | 4 (0090, 0091, 0093, 0094) | **Riktig** — 3 → 2 kandidater, alle ID.4 |
| ID.5/ID.7 → FALLBACK | 4 (0096–0099) | **Riktig** — kataloghull gir manuell kontroll, ikke fremmed glass |
| RAV4 → PINPOINT | 5 (0056–0060) | **Fikset** av familie-tokenet. Se forbehold i §4.1 |
| Mazda CX-3 2018 | 1 | VERIFY/4 → PINPOINT/1 (familie-token CX3) |
| Mazda CX-5 2014 | 1 | 1 → 2 kandidater |
| RAV4 2005 | 1 | 2 → 3 kandidater |
| ID.3 2020 | 1 | 3 → 1 kandidat (kun ID.3-raden) |
| Golf Sportsvan 2014 | 1 | VERIFY/3 → **FALLBACK/0** — navnemodell-vakt nå også i L2 |
| Prius+ 2013 | 1 | VERIFY/3 → **FALLBACK/0** — katalogen kaller bilen «GRAND PRIUS» |
| Volvo V60 2013 | 1 | PINPOINT/1 → **FALLBACK/0** — SVV sier «V60 PLUG IN HYBRID» |

Netto: PINPOINT 11 → 16, FALLBACK 24 → 26, latens p95 1 118 → 852 ms.

---

## 4. Avvik, sortert etter alvorlighet

| # | Alvor | Avvik | Reproduksjon | Test-ID |
|---|---|---|---|---|
| 1 | **HØY** | **PINPOINT for RAV4 2024 med en rute hvis produktnavn sier «RAV 4 19-21».** GT-raden for 2024 peker på `8432AGAC` (confidence 0,8), men prislisteraden `8432AGACHM` heter «TOYOTA RAV 4 19-21 FR AKU LDW». Enten er GT-året feil eller produktnavnet utdatert — med PINPOINT får kunden ett svar uten kontroll. | `POST /api/regnr {"regnr":"<RAV4 2024>","lookupOnly":true}` | FBG-T-0056 … -0060 |
| 2 | **HØY** | **V60 PLUG IN HYBRID mister PINPOINT** fordi drivlinjevakten (PR #26s kontrakt) blokkerer GT-raden «V60». Konservativt, men det er en dekningstap på en vanlig bil — og et fitment-spørsmål bare Tom kan svare på. | samme | FBG-T-0112 |
| 3 | **MIDDELS** | **Prius+ (SVV: «PRIUS PLUS») får null kandidater** fordi katalogen kaller bilen «GRAND PRIUS». Krever modellalias hvis den skal dekkes. | samme | FBG-T-0051 |
| 4 | **MIDDELS** | **Golf Sportsvan får null kandidater** — katalogen har ingen Sportsvan-rad, og navnemodell-vakten (riktig) fjerner Golf-radene. Kataloghull, ikke matchfeil. | samme | FBG-T-0084 |
| 5 | **MIDDELS** | Katalograder for ID.3 mangler `year_from`/`year_to` (år kun i modellstrengen) mens ID.4-radene har kolonner. Ulik datakvalitet i samme familie. | `SELECT year_from, year_to FROM glass_catalog WHERE eurocode LIKE '8652%'` | — |
| 6 | **LAV** | 4 av 7 VW ID-katalograder faller bort fordi de mangler prisrad (bare `8652AGACMUVZ`, `8658AGACMUVZ`, `8658ACKCKMUVZ` finnes i `glass_prisliste`). | SQL over `glass_prisliste` | FBG-T-0093 |
| 7 | **LAV** | Staging-bygg før endringen kunne ikke spores til en commit, så «før»-tilstanden er ikke reproduserbar utover pilot-CSV-ene. | `wrangler deployments list --config wrangler.staging.toml` | — |

**Kommentar til CTO-ens føringer:** ordren sa at kataloghull ikke skal regnes som matchfeil. Det er fulgt: Golf Sportsvan, Prius+, ID.5, ID.7, Polestar 2 og de øvrige 27 telles som **ingen dekning**, ikke som feil. «Teknisk feil»-raten er 0/117.

---

## 5. Bekreftelser

- **Produksjon:** ikke kalt, ikke endret. Alle kall mot `finnbilglass-frontrute-staging.tomarnejensen.workers.dev`.
- **Ingen saker, e-poster eller DB-poster:** `lookupOnly: true` slår av `regnr_logg`/`sok_logg` (`src/sok-logg-policy.ts:19`); staging-D1 `beta_inquiries` står uendret på 34 rader (5 test, siste `2026-11-03T23:02:46Z`).
- **Ingen R2-opplasting, ingen henvendelse, ingen e-post.**
- **Ingen fasitendring.** `data/fasit-glass.json` og `data/fitment-golden.json` er urørt.
- **Staging-deploy** er gjort (`016521d3` → `baa36d19` → `5dd408b5` → `0e6731f7`) fordi endringen må ligge i det som kjøres for at sammenligningen skal måle noe. Produksjon er ikke berørt.

---

## 6. Kodeendringer og tester

| Commit | Innhold |
|---|---|
| `6d829ba` | `familieTokens`, generisk token gir ikke kandidatstøtte, drivlinjevakt (v1) |
| `63fc296` | `sqlTokensAv` — SQL-forfiltreringen bruker rå ord (ellers LIKE-treff = 0) |
| `1949adf` | ensidig drivlinjevakt + «+»=PLUS i navnemodell-sjekken |

`tests/id-familie.test.mjs` — **11 tester**, alle grønne:

1. familieTokens bevarer sifferet (ID4, MODEL3, RAV4) og avviser motorkode (TRANSIT 2.0)
2. `modellTokensAv('ID.4')` inneholder ID4, ikke generisk ID
3. SQL-forfiltreringen bruker rå ord, ikke familie-tokenet
4. ID.4 matcher ikke ID.3 / ID.5 / ID.7
5. ID.5 får aldri ID.3- eller ID.4-glass
6. ID.4 GTX får ID.4-variantene, aldri ID.3
7. generisk token alene gir aldri kandidatstøtte
8. Tesla Model 3 og Model Y holdes adskilt (både GT og L2)
9. RAV4-familien uendret
10. «+» = PLUS uten å bryte «PASSAT SED+STV»
11. drivlinjevariant arver ikke grunnmodellens rad

**Full QA: 542 tester, 542 pass, 0 fail, 0 skipped.**

---

## 7. Anbefaling

1. **ID.5 og ID.7 skal fortsette å være manuell/FALLBACK** til katalogen har egne rader. ID.4 (inkl. GTX) skal fortsette som `VERIFY` til fitment for GTX er dokumentert.
2. **Avklar RAV4 2024-funnet (§4.1) før noe mer** — det er den eneste nye PINPOINT-en som ikke er etterprøvd, og produktnavnet motsier GT-året.
3. **Tre fitment-spørsmål til Tom:** deler V60 plug-in hybrid frontrute med V60? Er «PRIUS PLUS» og katalogens «GRAND PRIUS» samme bil? Har RAV4 plug-in samme rute som RAV4?
4. **500-bilers pilot: ikke start** før en lovlig datakilde er avtalt (§2.2). 117 er et gyldig, reproduserbart sett for videre regresjon.
5. **Neste steg som ikke krever nye data:** nettlesertest av hjelpeflyten for de 27 bilene uten dekning — det er der kunden i dag må forstå hva som skjer.
