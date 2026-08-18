# FINNBILGLASS VEHICLE INTELLIGENCE TEST PLATFORM (C6)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Første kjøring på ekte SVV-korpus. Staging-only, ingen prod-berøring. Personvern-først.

## 1. KORPUS (importert, dedupet, pseudonymisert)

| Kilde | Antall |
|---|---|
| `data/finn-modeller/svv-verifisert.ndjson` (finn.no → SVV) | 656 |
| `data/test-500-gt-detaljer.jsonl` (ground truth) | 500 |
| `data/finn-100.jsonl` | 110 |
| `bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson` | 2 396 |
| **Unike kjøretøy etter dedupe** | **3 076** |

**Personvern (testet, C6-1):** regnr og VIN lagres KUN som `sha256(id + salt)` — rapporten inneholder 0 rå kjennemerker, 0 rå VIN-er, ingen eierdata. Kun `{make, model, year}` sendes til resolver-kjeden. Skalerbart til 1M kjennemerker (samme pipeline, streaming-vennlig lesing).

## 2. MÅLTE TALL (første kjøring, 3 076 kjøretøy)

| Metrikk | Verdi | Betydning |
|---|---|---|
| vehicleIdentityCoverage | 100 % | korpuset er SVV-verifisert — identitet er «fasit» |
| vinCoverage | **96,8 %** | 2 979/3 076 har VIN (SVV-gir den nesten alltid) |
| applicationResolutionCoverage | 12,5 % | 385 kjøretøy matcher offline-registeret (T5/CLA/BMW/Volvo/Audi/Tesla/Toyota/Ford/Opel) |
| candidateCoverage | 12,5 % | samme gap — registeret er det blokkerende leddet |
| familieCount | 735 | hele korpuset fordeler seg på 735 familier |

**Kandidatfordeling:** 348 enkelt-kandidat, 37 multi-variant (T5/CLA — der spørsmålene faktisk trengs), 2 691 ingen kandidat.

## 3. PRIORITERINGSMOTOR — TOPP-VERDIFULLE FAMILIER (verdi = biler × variantrisiko × data-gap)

| Familie | Biler | Gap | Verdi | Hvorfor |
|---|---|---|---|---|
| **VW GOLF** | 102 | 100 % | 204 | flest biler, år→generasjon-mapping kjent (del 2 i svv-monster-analyse) |
| TOYOTA RAV4 | 83 | 100 % | 166 | høyvolum, flere generasjoner |
| TOYOTA COROLLA | 69 | 100 % | 138 | høyvolum |
| NISSAN LEAF | 62 | 100 % | 124 | el-bil, sensor/kamera-varianter |
| BMW i3 | 55 | 100 % | 110 | el-bil, få men viktige varianter |
| TESLA MODEL Y | 48 | 100 % | 96 | nyeste høyvolum |
| VW PASSAT | 43 | 100 % | 86 | år→generasjon kjent |
| BMW 1/3-serie | ~40 | ~90 % | ~70 | E/F/G-kode-mapping finnes |

## 4. STØRSTE HULL (dataanskaffelses-prioritet → TecDoc/EPC)

1. **VW Golf/Passat/Polo** — 174 biler, år→generasjons-mapping ALLEREDE dokumentert (Wikipedia-fasit i svv-monster-analyse) → implementeres først, null dataanskaffelse nødvendig
2. **Toyota RAV4/Corolla/Hilux/Proace** — ~200 biler, ingen applikasjonsdata → TecDoc/EPC
3. **Nissan Leaf/Ariya** — ~115 biler → TecDoc/EPC
4. **Tesla Model 3/Y** — ~90 biler (kamera/HUD-varianter!) → TecDoc/EPC + produsentdata
5. **BMW i4/1/3-serie** — ~130 biler → E/F/G-kode-utvidelse + TecDoc

## 5. KONKLUSJON

- **Verdien er bevist:** 3 076 ekte kjøretøy → 735 familier → presis prioritering. «Vi slutter å gjette hvor problemet er.»
- **VIN-dekning 96,8 % betyr at bilidentiteten nesten alltid kan bevises** — applikasjons-/OE-laget er det eneste som mangler.
- **Første implementasjonstrekk er gratis:** VW Golf/Passat år→generasjon (dokumentert), deretter kjøps-prioritering for Toyota/Nissan/Tesla/BMW.
- Plattformen er klar for 1M-korpus når SVV-eksporten kommer — samme script, ingen kodeendring.

## 6. LEVERT

- `scripts/c6-vehicle-intelligence.mjs` — korpus-import (hash), kjede-kjøring, familie-statistikk, prioriteringsmotor, hull-rapport
- `tests/c6.test.mjs` — 3/3 (personvern-regresjon: ingen rå regnr/VIN i rapport; statistikk-sanity; prioritering-eksistens)
- `scripts/out/c6-vehicle-intelligence.json` — full rapport (kun hash-data)

**Ingen produksjonsendring. Staging-only. STOPP.**
