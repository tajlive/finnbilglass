# FINNBILGLASS CATALOGUE CANDIDATE EXPANSION & COVERAGE MEASUREMENT (C7.5)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. Alt katalogmateriale merket `CLASS_D_CATALOGUE_CANDIDATE` — aldri fasit, aldri EXACT, aldri automatisk OE-aksept.

## 1. MÅLING (SVV-korpus, 3 076 kjøretøy — 5 metrikker)

| Metrikk | Før (generasjonsregister) | Etter (+CLASS_D-katalogkandidater) | Δ |
|---|---|---|---|
| VEHICLE_IDENTITY_COVERAGE | 100 % | 100 % | — |
| VIN_COVERAGE | 96,8 % | 96,8 % | — |
| APPLICATION_COVERAGE | 8,3 % | 8,3 % | — (kandidater endrer ikke applikasjoner) |
| **GLASS_COVERAGE** | 8,3 % | **29,0 %** | **+20,7 pp** |
| EXACT_COVERAGE | 0 % | 0 % | — (krever OE/foto — katalog aldri) |

**893 saker stopper på Application→OE** — de har glasskandidater, men ingen autoritativ applikasjon→OE-kant. **Multi-kandidat-andel: 100 %** — katalogen gir alltid >1 kandidat per familie, noe som er riktig: katalogdata foreslår, evidens avgjør.

*Merk (ærlig tall-sammenligning):* C7 rapporterte 12,4 % applikasjonsdekning med en modell-normalisering som strippet første token alltid; C7.5 bruker konservativ stripping (kun når token = merke) → 8,3 %. Det konservative tallet er fasiten for videre målinger.

## 2. KLASSE-D-KANDIDATGENRATOR

- **Kilde:** gt-auto-prisliste (25 179 rader) → **3 021 rader** matcher høyvolumfamiliene (Golf/Passat/Polo/Transporter/CLA/Sprinter/Vito/1-3-serie/XC60/Model 3+Y/Leaf/RAV4/Corolla/Hilux/Transit/Corsa/Astra/Vectra/MINI)
- **Parsing:** varenavn → merke/familie/generasjon/produksjonsår («VW GOLF II 3/5D CC 84-90 FRONTRUTE» → Golf, 1984–90) + features fra kommentar (EMB, sensor, kamera, coated…)
- **Merking:** hver kandidat har `klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE'` — testet i challenge-suiten
- **Funn:** T6 manglet i generasjonsregisteret (T5 2018-søk ga 0 — korrekt nektelse, men T6 2015–2024 var savnet) → lagt til med pre/post-facelift-split

## 3. TECDOC/EPC-KRAVLISTE (basert på faktiske hull, ikke gjetning)

| Familie | SVV-biler | Med CLASS_D-kandidater | Behov |
|---|---|---|---|
| Tesla Model 3/Y | 135 | 120 | applikasjon→OE (kamera/HUD-varianter) |
| Nissan Leaf/Ariya | 147 | 94 | applikasjon→OE |
| Toyota RAV4/Corolla | 162 | 162 | applikasjon→OE |
| BMW i4/i3/1/3-serie | ~200 | ~70 | E/F/G-kode + applikasjon→OE |
| VW Golf VII | 66 | 66 | facelift-split + applikasjon→OE |

**Kravliste-formel:** familier med ≥10 SVV-biler OG kandidater OG ingen OE-kant → TecDoc/EPC for applikasjon→OE. Prioritet = antall biler × variantrisiko (fra C6-motoren).

## 4. HARD FITMENT SET v1 (permanent del av flyinstrumentpanelet)

12 nye cases (kategori H) — **25/25 challenge-tester grønne**:
- **VW:** Golf VIII, Passat B8, Transporter T6 — applikasjon ✓, kandidater ✓/skillende spørsmål ✓
- **Mercedes:** CLA facelift ✓, Sprinter + Vito → **ærlig UNKNOWN (ingen gjett)**
- **BMW 3-serie / Volvo XC60 / Tesla / Leaf / RAV4:** CLASS_D-kandidater ELLER UNKNOWN — aldri fasit, aldri gjett

## 5. PRINSIPP-OVERHOLD

- `CLASS_D_CATALOGUE_CANDIDATE` ≠ `VERIFIED_FITMENT` — eksplisitt i kode, data og tester
- Ingen produksjonsendringer, ingen auto-EXACT, ingen automatisk OE-aksept fra katalog
- Gratis-ekspansjon uttømt før C8-datakjøp: +20,7 pp GLASS_COVERAGE uten en krone

## 6. LEVERT

- `src/fitment-v1/catalogue-candidates.ts` — CLASS_D-kandidatgenerator (parse + indeks + match)
- `src/fitment-v1/generation-registry.ts` — T6/T6.1 lagt til
- `scripts/c75-coverage.mjs` — måling + kravliste (output: `scripts/out/c75-coverage.json`)
- `data/fitment-challenge.json` + test — Hard Fitment Set (25/25)
- Full suite + tsc: grønn

**Ingen produksjonsendring. Staging-only. STOPP.**
