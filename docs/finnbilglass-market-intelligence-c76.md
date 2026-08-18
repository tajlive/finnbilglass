# FINNBILGLASS MARKET INTELLIGENCE LAYER (C7.6)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. Finn.no = markedsignal — aldri sannhet.

## 1. HISTORISK KORREKSJON (akseptert)

| Metode | Rolle | Hva den måler |
|---|---|---|
| Gammel finn.no-metode (manuell modell/merke) | **Market Reality Dataset** | kommersiell prioritering — menneskeskrevet, feil år/modell mulig, ingen VIN/produksjonsdato/import |
| C6/C7/C7.5 SVV-korpus (ekte kjennemerker) | **Truth/Test Dataset** | arkitektur: identitet → generasjon → kandidat → evidens-gate |

De måler to forskjellige ting og sammenlignes aldri direkte. **893 saker som stopper på Application→OE kunne aldri vært målt med finn-data.**

## 2. TRE PARALLELLE DATASETT

1. **Truth/Test** (SVV) — arkitektur, regresjon, måling: «kan systemet løse bilen korrekt?»
2. **Market** (Finn.no) — prioritering: «hvilke biler gir mest kommersiell verdi?»
3. **Customer** (ekte søk) — læring: «hva spør kundene faktisk etter?» (kommer med prod)

## 3. ROI-PRIORITET: MARKEDSVOLUM × DATA-GAP (1 385 finn-annonser, 3 076 SVV-biler)

| Familie | Annonser | SVV-biler | App-gap | **ROI** | Beslutning |
|---|---|---|---|---|---|
| **Nissan LEAF** | 135 | 94 | 100 % | **135** | 🔴 TecDoc/EPC |
| **BMW 3-SERIE** | 133 | 86 | 100 % | **133** | 🔴 TecDoc/EPC |
| **Toyota RAV4** | 131 | 83 | 100 % | **131** | 🔴 TecDoc/EPC |
| **Tesla MODEL-3** | 99 | 72 | 100 % | **99** | 🔴 TecDoc/EPC |
| **Toyota COROLLA** | 93 | 76 | 100 % | **93** | 🔴 TecDoc/EPC |
| **Volvo XC60** | 91 | 49 | 100 % | **91** | 🔴 TecDoc/EPC |
| **Tesla MODEL-Y** | 88 | 50 | 100 % | **88** | 🔴 TecDoc/EPC |
| VW TRANSPORTER | 89 | 79 | 49 % | **43,6** | 🟡 gratis-trekk først (T5/T6-register finnes) |
| VW GOLF | ~100 | 102 | ~0 % | ~0 | 🟢 gratis-trekk allerede utført |

**ROI-mekanismen er selvkorrigerende:** Golf/Transporter har lav kjøps-ROI *fordi* gratis-mappingen allerede dekker dem — nøyaktig slik den skal virke.

## 4. TECDOC/EPC-KJØPSANBEFALING (ROI ≥ 50, 7 familier)

LEAF → 3-SERIE → RAV4 → MODEL-3 → COROLLA → XC60 → MODEL-Y. **Dette er kravlisten fra faktiske hull × markedsverdi — ikke gjetning.** Kjøpsordre for C8-validering.

## 5. DATA HIERARCHY (arkitektur, kodifisert i rapport-meta og tester)

```
SVV                    → vehicle identity TRUTH
Supplier/catalogue     → candidate generation (CLASS_D_CATALOGUE_CANDIDATE)
Finn.no                → market demand SIGNAL (aldri sannhet)
Customer conversations → learning signal (C3)
Kun evidenskilder      → kan skape EXACT
```

## 6. LEVERT

- `scripts/c76-market-intelligence.mjs` — finn-volum-import → familie-normalisering → SVV-gap-kryss → ROI-tabell + kjøpsanbefaling (output: `scripts/out/c76-market-intelligence.json`)
- `src/fitment-v1/catalogue-candidates.ts` — `FAMILIER` eksportert for gjenbruk
- `tests/c76.test.mjs` — 3/3 (ROI-sortering, kjøpsanbefaling med terskel, ingen EXACT-claims i data)
- 25/25 challenge + suite + TSC 0

**Ingen produksjonsendring. Staging-only. STOPP.**
