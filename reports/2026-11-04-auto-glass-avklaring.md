# Auto-glass.no som kilde: fem åpne spørsmål avklart (2026-11-04)

Tom ba meg bruke nettleseren mot `www.auto-glass.no` for å løse det som stod fast. Fem spørsmål er nå besvart med skjermbildetekst fra butikken — som er den samme katalogen FinnBilGlass selger fra.

Alle oppslag er gjort på offentlige produktsider i butikken (ingen innlogging, ingen endring).

---

## 1. VW ID.5 — butikken har ingen ID.5-frontrute

Søk på `ID.5` gir **14 produkter, alle side-/bak-/dørglass**:

```
VW ID.5 5D CROSSOVER CPE 21- H BACKLI PRIV ANT ALARM (SVER)
VW ID.5 5D SUV 22- R VENT RIGHT ENC GN
VW ID.5 5D SUV 22- R QTR LEFT ENC GN
VW ID.5 5D SUV 22- R DOORW RIGHT GN
… (ingen «WS»-rad)
```

Til sammenligning har **ID.4** fire frontruter:

```
VW ID.4 5D SUV 20- WS GN ACO LDW DETECT ENC
VW ID.4 5D SUV 20- WS GN ACO LDW DETECT H.U.D ENC ##@
VW ID.4 5D SUV 20- WS COAT HEAT ACO LDW DETECT ENC #-10%#
VW ID.4 5D SUV 20- WS COAT HEAT ACO LDW DETECT ENC #-10%#  (variant)
```

og **ID.3** to:

```
VW ID.3 5D HBK 20- WS GN ACO LDW DETECT ENC
VW ID.3 5D HBK 20- WS GN ACO LDW DETECT H.U.D ENC
```

**Konklusjon:** ID.3-, ID.4- og ID.5-frontruter er tre separate produktserier, og ID.5-frontrute finnes ikke. Resolverens nye oppførsel — `FALLBACK` for ID.5 i stedet for ID.3/ID.4-glass — er **korrekt**, og det er butikkens egen virkelighet som bekrefter det.

**ID.4 GTX:** det finnes ingen GTX-spesifikk frontrute. `VERIFY` med de to ID.4-rutene er riktig til fitment er dokumentert.

---

## 2. Toyota Prius+ — bilen finnes, men katalogen kaller den «GRAND PRIUS»

Butikken fører bilen:

```
TOYOTA PRIUS PLUS 7 + 5D CC 12- FR+AKU+LDW+SENS+GN
TOYOTA PRIUS PLUS 7 + 5D CC 12- FRONTRUTE+SENSOR+GNGY NB
TOYOTA PRIUS PLUS 7+5D CC 12- FR+AKU+SENS+HUD+SPEIL= EL
TOYOTA PRIUS+SEVEN 5D CC 12- …
```

Pilkington-katalogen (`glass_catalog`, `source=pilkington-irl`) har samme bil som:

```
GRAND PRIUS LHD 04/2012 · 2012–2022 · 8406AGAMUV / 8406AGAUV / 8406AGABMUV (RHD)
```

**Konklusjon:** «PRIUS PLUS» og «GRAND PRIUS» er samme bil (2012–). Dekningen finnes — det som mangler er et **modellalias** i matchereren. Det er en liten, avgrenset endring, men den rører matchingen og bør godkjennes som fitment-alias før den innføres.

---

## 3. Volvo V60 — butikken skiller ikke plug-in

```
VOLVO S60 SED+V60 12- NB FRONTRUTE+SENS+CITY+GN
VOLVO S60 SED+V60 01/12- FRONTRUTE+SENS+CITY+LDW+GRØNN
VOLVO S60 SED+V60 10- KLIPS KIT A-STOLPER FRONTRUTE
```

Én frontrute-familie for S60/V60, ingen egen PHEV-vare. **Indikasjon:** V60 plug-in hybrid bruker samme frontrute som V60. Det betyr at drivlinjevakten (som nå gir `FALLBACK` for «V60 PLUG IN HYBRID») koster dekning uten å beskytte mot noe — men det er Toms faglige avgjørelse, ikke min.

---

## 4. RAV4 2024 — PINPOINTen peker sannsynligvis på feil årgang

Butikken har **to** serier for dagens RAV4:

```
TOYOTA RAV 4 19-21 FR AKU LDW SENSOR EL INNK GN      ← lukket 2019–2021
TOYOTA RAV 4 2019- FR AKU LDW SENSOR EL HUD GN       ← åpen 2019–
TOYOTA RAV 4 2019- FR AKU SENSOR GN                  ← åpen 2019–
TOYOTA RAV 4 2019- WS GN ACO LDW EL DETECT           ← åpen 2019–
TOYOTA RAV 4 2019- WS GN ACO LDW EL HUD DETECT
```

GT-raden for 2024 peker på `8432AGAC` (confidence 0,8), og prislisteraden for den eurokoden heter nettopp **«TOYOTA RAV 4 19-21 FR AKU LDW SENSOR EL INNK GN»**. Butikkens produkt for eurokoden er `USE 8432AGACHMV1E` (varenummer 8048AGACHMV) — **uten pris**.

**Konklusjon:** PINPOINTen for RAV4 2024 (og 2022/2023/2025, som GT også mapper til `8432AGAC`) peker på en **2019–2021-rute**. Det er enten feil årgang i `ground_truth`, eller en utdatert produkttekst. Inntil det er avklart er dette en **mulig falsk PINPOINT** — den eneste i hele 117-bilers-kjøringen som ikke er etterprøvd.

Merk også: RAV-4 13-serien er en helt annen vare (`3202GNELM` / `8410AGAHMW`), så den er ikke involvert.

---

## 5. Hva dette betyr for de tre åpne spørsmålene

| Spørsmål | Svar fra butikkataloggen | Konsekvens |
|---|---|---|
| Har ID.5-frontrute? | **Nei** — bare side/bak/dør | `FALLBACK` er riktig, ingen endring |
| Skiller katalogen ID.4 GTX? | **Nei** — 4 ID.4-ruter, ingen GTX | `VERIFY` er riktig |
| Er «PRIUS PLUS» = «GRAND PRIUS»? | **Ja** — samme bil, 2012–, ulike navn | Krever modellalias for å gi dekning |
| Deler V60 plug-in frontrute med V60? | **Butikken skiller ikke** — én S60/V60-rute | Drivlinjevakten koster dekning; Tom bør bekrefte |
| Er RAV4 2024 → 8432AGAC riktig? | **Nei, sannsynligvis ikke** — ruten heter 19-21 | Mulig falsk PINPOINT; må avklares |

---

## 6. Anbefaling

1. **Stopp ikke på ID.4/ID.5 — de er ferdig avklart** (VERIFY / FALLBACK, bekreftet mot butikken).
2. **RAV4 2024 må avklares før lansering.** Enten rettes `ground_truth`-årene for `8432AGAC` til 2019–2021, eller eurokoden byttes til riktig 2019– vare. Det er en prod-dataendring og krever Toms godkjenning.
3. **PRIUS PLUS-alias** er en liten, velbegrunnet endring (butikken fører bilen, Pilkington kaller den GRAND PRIUS). Bør inn som egen commit med test — ikke gjort i denne runden, fordi det er en fitment-alias, ikke en feilretting.
4. **V60 plug-in:** Tom bør svare på om den deler frontrute. Butikkataloggen indikerer ja; hvis ja, bør drivlinjevakten bare gjelde varianter der katalogen faktisk har en egen rad.
5. **500-bilers-sporet står fortsatt fast** på lovlig datakilde (FINN forbyr crawling). 117 er settet som gjelder.

---

## 7. Gjennomført etter avklaringen

### 7.1 PRIUS PLUS-aliaset er innført og verifisert

Commit `f7b0f86` (PRIUS PLUS = GRAND PRIUS, smalt synonym + `GRAND` i navnemodell-vakten).
QA **543/543** grønt. Deployet til staging `6eebb902`.

Målt på staging etter deploy:

| Test-ID | Bil (SVV) | Før alias | Etter alias |
|---|---|---|---|
| FBG-T-0051 | TOYOTA PRIUS PLUS 2013 | FALLBACK / 0 | **VERIFY / 2** — `8406AGAMUV`, `8406AGAMUV1P` (Grand Prius 2012–2022) |

Det er samme varefamilie som butikkens «TOYOTA PRIUS PLUS 7 + 5D CC 12- FR…». En vanlig Prius får den ikke: `gtRadMatch('GRAND PRIUS …', 'TOYOTA', 'PRIUS 5D CC')` er false, og det er låst i test.

### 7.2 Status for de øvrige

| Bil | Status etter avklaringen | Neste handling |
|---|---|---|
| ID.5 / ID.7 (FBG-T-0096–0099) | `FALLBACK` — bekreftet riktig (butikken har ingen ID.5-frontrute) | Ingen |
| ID.4 GTX (FBG-T-0090/0091) | `VERIFY` med 2 ID.4-ruter — bekreftet riktig (ingen GTX-vare finnes) | Ingen |
| Volvo V60 PHEV (FBG-T-0112) | `FALLBACK` — drivlinjevakten | **Toms fitment-svar** |
| RAV4 2024 (FBG-T-0056–0060) | `PINPOINT` på `8432AGAC`, hvis vare heter «19-21» | **Må avklares** — mulig falsk PINPOINT |

### 7.3 Oppdatert dekningstall

117 biler: **91 med kandidater (77,8 %)**, 26 uten dekning, 0 tekniske feil. (Ett kall — Prius+ — er kjørt på nytt etter aliaset og verifisert direkte; de øvrige 116 er uendret fra kjøringen `pilot-*-endelig`.)

---

## 8. Etter Toms faglige føring (samme dag)

Tom besluttet: RAV4 2022–2025 skal holdes på `VERIFY` til årsmodell/glasskode er bekreftet, GT-årene skal **ikke** endres, og drivlinjevakten skal bare blokkere når katalogen faktisk skiller varianten.

### 8.1 Implementert

| Endring | Commit | Virkning |
|---|---|---|
| `pinpointSperre()` — data-drevet sperretabell | `8e6c6d7` | PINPOINT på `8432AGAC` for RAV4 2022–2025 svekkes til `VERIFY`. Kandidaten beholdes. GT er **uendret**. Sperren fjernes når leverandør bekrefter passformen. |
| L2 uten hard PHEV-blokk (to-pass) | samme | Skiller katalogen varianten (egen rad), brukes bare variantradene. Ellers beholdes de generiske radene → `VERIFY`, ikke `FALLBACK`. |

Sperretabellen er smal og inneholder bare det ene dokumenterte tilfellet:

```ts
{ eurokodePrefiks: ['8432AGAC'], merke: /^TOYOTA$/, modell: /(?:^|\s)RAV[\s-]?4\b/,
  aarFra: 2022, aarTil: 2025,
  grunn: 'GT sier 2022-2025, men varen heter «RAV 4 19-21» …' }
```

Merk: første forsøk sperret ikke, fordi SVV sender modellstrengen «TOYOTA RAV4» (merkenavnet gjentatt). Regexen er rettet og låst i test.

### 8.2 Målt effekt på de 117 bilene (staging `35b5f96a`)

| Endring fra forrige kjøring | Biler | Resultat |
|---|---|---|
| RAV4 2024 | 5 (FBG-T-0056 … -0060) | `PINPOINT/1` → **`VERIFY/1`**, kandidaten står |
| Volvo V60 PLUG IN HYBRID | 1 (FBG-T-0112) | `FALLBACK/0` → **`VERIFY/5`** |
| Alt annet | 111 biler | uendret |

**Ingen vanlig V60 ble mer «sikker»:** V60 2013 er nå `VERIFY` med 5 kandidater — ikke PINPOINT. Det var Toms kontrollkrav.

### 8.3 Sluttall for 117 biler

| Måling | Verdi |
|---|---|
| Kandidater | **92 av 117 (78,6 %)** |
| Uten dekning | 25 |
| Utfall | PINPOINT **11** · VERIFY 81 · FALLBACK 25 |
| Tekniske feil | **0** |
| Fasit | **2 av 2 SAMSVAR** |
| Latens p50 / p95 / maks | 303 / 1 049 / 1 236 ms |
| QA | **544 tester, 544 pass, 0 fail, 0 skipped** |

### 8.4 Produksjon

Uendret og ikke berørt. RAV4-koden er ikke bekreftet, så sperren ligger i kode på staging — den skal **ikke** til produksjon før leverandøren har bekreftet at `8432AGAC` gjelder 2022–2025, eller GT-årene er rettet med dokumentasjon.

---

## 9. RAV4: rotårsaken var søskenrader, ikke GT-årene

Funnet etter Toms tips om at katalogen har størrelse i cm:

**Autoglass-prislisten** (`PROSEKT API 16 MAI26.xls`, 34 800 rader) har **ett varenr med flere eurokoder og ulik årang**:

| Rad | Varenr | Eurokode | Varenavn | Pris |
|---|---|---|---|---|
| 27510 | `8432AGAC` | `8432AGACHM` | TOYOTA RAV 4 **19-21** FR AKU LDW | 19 410 |
| 27511 | `8432AGAC` | `8432AGACHMU` | TOYOTA RAV 4 **2019-** FR AKU LDW | 22 825 |
| 27512 | `8432AGAC` | `8432AGACHMUV1E` | TOYOTA RAV 4 **2019-** WS GN ACO LDW | 15 810 |
| 27513 | `8432AGAC` | `8432AGACHMV1E` | TOYOTA RAV 4 **2019-** WS GN ACO LDW | 16 230 |
| 27516 | `8432AGAC` | `8432AGACMV` | TOYOTA RAV 4 2019- FR AKU SENSOR | 0 |

`prisKandidat()` brukte `LIMIT 1` og tok den **første** raden — altså 19-21-varen — for en 2024-bil. Det var rotårsaken; GT-årene var ikke problemet.

### 9.1 Rettet

`velgPrisRadEtterAar()` velger nå raden hvis varenavn-år inneholder bilens år, og den mest spesifikke når flere dekker året (19-21 foran «2019-» for en 2020-bil). Uten år, eller når ingen rad dekker året: første rad som før.

**Målt på staging `67ddbf8c`:** RAV4 2024 gir nå `8432AGACHMU` = «TOYOTA RAV 4 2019- FR AKU LDW» i stedet for `8432AGACHM` = «… 19-21 …». Utfallet er fortsatt **VERIFY** fordi sperren står — som bestemt.

Hele 117-settet er kjørt på nytt: **0 endringer i utfall eller kandidatantall**, 0 tekniske feil. QA **545/545**.

### 9.2 Størrelse i cm — filen mangler

Jeg har lett gjennom maskinen. Det finnes **én** stor XLS-katalog: `PROSEKT API 16 MAI26.xls` (34 800 rader, også i `~/Developer/autoglassgrossisten/` og `~/Downloads/`). Den har **7 kolonner — Varenr, Varenavn, Merknad, Pris, (tom), Eurokode, (tom) — ingen størrelseskolonne.**

`glass_catalog.dimensions` i D1 er `{"width":null,"height":null,"thickness":null}` for alle tre RAV4-eurokodene. `autoglass-katalog.csv` (Pilkington-scrapen) har heller ingen mål-kolonne.

**Trenger:** stien til XLS-filen som har cm-målene. Med den kan jeg avgjøre saken objektivt:

- er `8432AGACHM` (19-21) og `8432AGACHMU` (2019-) **samme mål** → samme glass, sperren kan fjernes når leverandør bekrefter;
- er målene **ulike** → to forskjellige ruter, og årvalget er ikke bare riktig, men nødvendig.

### 9.3 Merknad fra Pilkington-katalogen

Den scrapede Pilkington-katalogen (`~/bilglass/data/autoglass-katalog.csv`) sier `8432AGACHMV1E` = **RAV 4, 2019–2029**. Autoglass-prislisten kaller søskenraden «19-21». Kildene er altså uenige om årspennet — også dette avgjøres av målene.
