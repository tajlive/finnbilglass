# Egentest 50 biler — analyse av katalogtreff og triggerplan

Kjørt: 2026-08-19 · staging · runId `self_test_50_20260819144905_83534` · 50/50 pass · GO

## 1. Katalogtreff: PINPOINT vs VERIFY (32 treff av 50)

| Utfall | Antall | Biler |
|---|---|---|
| **PINPOINT** | 7 (14 %) | LAND CRUISER 2008, V60 PHEV 2013, V60 TWIN 2017, LEAF 2021, TAYCAN 2021, KONA 2024, OUTLANDER 2014 |
| **VERIFY** | 25 (50 %) | se liste under |
| **FALLBACK** | 18 (36 %) | se liste under |

### PINPOINT (7) — hva gjør dem entydige
Alle 7 har **nøyaktig 1 kandidat** i katalogen. Det finnes kun én GT-rad/glassrad for kombinasjonen, og ingen utstyrsvariant skiller dem. Fellesnevner: nyere, én-salgsvariant-biler (LEAF, TAYCAN, KONA, V60-TWIN) eller biler der katalogen kun har ett glass (LAND CRUISER 2008, OUTLANDER 2014).

### VERIFY (25) — hvorfor de ikke blir PINPOINT
Samtlige 25 har **2–6 kandidater** etter attributtfiltrering. EXACT-gaten (fitment-doktrine A3) krever én kandidat — med flere må kunden bekrefte det skillende attributtet. Årsakskategorier:

| Kategori | Eksempler | Kandidater |
|---|---|---|
| **Utstyrsvarianter** (sensor/antenne/coated/varme — står IKKE i VIN/SVV) | VW GOLF 2006 (6), BMW 318D 2008 (5), TESLA MODEL Y 2023 (5), AUDI A5 2007 (4), JAGUAR XF 2018 (4), BMW X5 2011 (4), MITSUBISHI ASX 2011 (4), TOYOTA YARIS 2024 (4) | ~17 biler |
| **Karosserivarianter** (sedan/stv/pickup) | FORD GRANADA 2,3L 1983 (3), MITSUBISHI L200 1999 (2), PAJERO 2012 (3) | 3–4 biler |
| **Årgang/facelift** (pre/post) | VW TRANSPORTER 2016 (2 — T5/T6), OUTLANDER 2009 (2), CX-3 2018 (2), XC60 2015 (2), NIRO 2022 (2), iX 2022 (2) | ~6 biler |
| **Elbil-utstyrsvarianter** (ID.3, E-TRON, MODEL Y) | ID.3 PRO 2020 (3), E-TRON 2019 (3), MODEL Y 2023 (5) | 3–4 biler |

Dette bekrefter kjent mønster (75 % av VERIFY-usikkerhet = utstyrsvarianter som ikke står i VIN; kun kundesvar/EPC kan skille dem).

### FALLBACK (18) — katalog-gap, ikke matcher-feil
Alle 18 gir **0 kandidater**. Mønster: nyere elbiler (POLESTAR 2, NISSAN ARIYA, TOYOTA BZ4X, CUPRA BORN, LOTUS ELETRE 2026, BMW i7, BMW i3, DANGEL PROACE 4X4, TOYOTA PROACE 2025, HILUX 2025, EVOQUE 2011, LAND CRUISER 150 2021, KIA CEE'D 2013, AYGO 2010, CARAVELLE 2000, CLA 2016, ISUZU 2021) — modeller som mangler eller har feil normalisering i GT-katalogen.

## 2. Vurdering: er VERIFY-andelen akseptabel for lansering?

**Ja — VERIFY er riktig og trygt, og matcheren skal IKKE strammes inn.**

- VERIFY er en **designet, sikker tilstand**: kunden bekrefter ETT skillende attributt (sensor/antenne/coated). Den garanterer aldri feil glass — det er poenget med EXACT-gaten. Å «stramme inn» for å få flere PINPOINT betyr å gjette kandidat — forbudt etter G1-doktrinen («Katalog foreslår · Evidens bestemmer · AI gjetter aldri»).
- Det reelle forbedringspotensialet ligger i **data, ikke terskler**:
  1. **FALLBACK 18/50 (36 %) er det største hullet** — nyere elbiler mangler i GT-katalogen (POLESTAR 2, ARIYA, BZ4X, ELETRE, BORN). Prioritet: utvide GT-generatoren for 2021–2026-elbiler.
  2. **EPC/utstyrsdata** (Biluppgifter/TecDoc) kan auto-differensiere utstyrsvarianter → flere PINPOINT uten å senke beviskravet.
  3. **Attributt-dekning i glavista-rules** (cameraBracket/antenne/coated) for kandidatene som mangler verdier (6a-presisering: null vs true er gyldig skillelinje, men null/null må forbli VERIFY).
- Lanseringstall: **50 % VERIFY + 36 % FALLBACK** er brukbart for beta, men FALLBACK-andelen må ned før bred lansering — det er UX-verstingen («ikke funnet»-veien), ikke VERIFY.

## 3. Triggerplan — anbefaling

**Anbefaling: automatisk pre-deploy-gate i deploy-workflow (release), IKKE per commit.**

| Alternativ | Vurdering |
|---|---|
| **A. CI-gate før hver prod-deploy (anbefalt)** | ✅ Validerer nøyaktig den kjeden deploy kan bryte (SVV→resolver→R2→ops) — enhetstester ser den ikke. Deploy er sjelden → 50 SVV-kall per release er akseptabel kostnad. Testen er deterministisk (fixture) → pålitelig gate. Blokkerer rød deploy. |
| B. Per commit | ❌ Støy + SVV-kostnad per commit, langsom feedback, lite verdi (commit bryter sjelden hele kjeden). |
| C. Kun manuelt | ❌ Risiko: regresjon i SVV/R2/ops flyter til prod fordi ingen kjører testen. |
| D. Daglig cron | 🟡 Godt supplement (dekker miljø-drift), men erstatter ikke pre-deploy-gaten. |

**Konkret:** `deploy.yml` får en `self-test-50-staging`-jobb som kjører `npm run selftest:50:staging` mot staging og **blokkerer prod-deploy ved rød** (exit 1). Kjøres kun i deploy-workflowen, ikke på vanlige commits. Manuell kjøring forblir mulig (`npm run selftest:50:staging`). Daglig kjøring kan legges til senere når SVV-kostnaden er bekreftet.

**Beslutning som kreves fra Tom:** implementere alternativ A (pre-deploy-gate) — eller velge D (daglig) / C (manuell). Anbefaling: A.
