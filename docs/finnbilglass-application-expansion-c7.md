# FINNBILGLASS APPLICATION EXPANSION & FITMENT COVERAGE (C7)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. Før/etter målt på SVV-korpuset (3 076 kjøretøy).

## 1. FØR/ETTER-MÅLING (5 metrikker, C6-korpus)

| Metrikk | Før (T5/CLA) | Etter (+generasjonsregister) | Δ |
|---|---|---|---|
| VEHICLE_IDENTITY_COVERAGE | 100 % | 100 % | — |
| VIN_COVERAGE | 96,8 % | 96,8 % | — |
| APPLICATION_COVERAGE | **6,9 %** (211) | **12,4 %** (380) | **+5,5 pp** |
| OE_COVERAGE | 6,9 %* | 12,4 %* | +5,5 pp* |
| GLASS_COVERAGE | 6,9 % | 12,4 % | +5,5 pp |
| EXACT_COVERAGE | 0 % | 0 % | — |

\* OE-tallene reflekterer applikasjons-INFERRED (produksjonsintervall), **ikke** autoritativ applikasjon→OE-kant — den krever TecDoc/EPC og forblir 0 (ærlig).

**+5,5 prosentpoeng fra ren, gratis, deterministisk mapping** (VW Golf I–VIII, Passat B1–B9, Polo I–VI + Opel Vectra/Corsa/Astra + MINI R/F). Kilden: dokumentert i `svv-monster-analyse-2026-08-16.md` (Wikipedia-fasit).

## 2. LEVERTE KOMPONENTER

| Komponent | Innhold |
|---|---|
| `src/fitment-v1/generation-registry.ts` | 34 familier med produksjonsintervaller (Golf/Passat/Polo/Opel/MINI + T5/CLA) — **kandidat-materiale, aldri fasit** |
| `scripts/c7-coverage.mjs` | Før/etter-måling, 5 metrikker, personvern (kun sha256-hash) |
| `data/fitment-challenge.json` + `tests/fitment-challenge.test.mjs` | **Permanent regresjons-benchmark**: 12 cases i kategoriene A–F |
| `application-resolver.ts` | **Design-fix: facelift-evidens ELIMINERER motstridende applikasjon** (før: bare styrket én — post-facelift lekket inn ved pre-facelift-observasjon) |

## 3. FITMENT CHALLENGE v1 (flyinstrumentpanelet)

| Kat | Case | Krav | Status |
|---|---|---|---|
| A | Golf III/VII, Polo V (enkle) | 1 applikasjon, riktig generasjon, kun informative spørsmål | ✔ |
| B | T5 (SU18018), CLA (AJ95429) (variantfeller) | flere kandidater, skillende spørsmål | ✔ |
| C | T5 sensor/kamera | spørsmål om rainSensor, aldri generiske tilbehørsspørsmål | ✔ |
| D | T5 pre-facelift | kun pre-facelift-applikasjon (etter eliminering-fixet) | ✔ |
| E | Transporter, Sprinter | flere kandidater + ærlig UNKNOWN (Sprinter — ingen data) | ✔ |
| F | Tesla Model 3, Nissan Leaf | **UNKNOWN, 0 spørsmål — AI gjetter aldri** | ✔ |

**13/13 tester grønne.** Universal-gate: 0 irrelevante spørsmål på alle cases.

## 4. PRINSIPP-OVERHOLD

- **Prisliste = kandidater, aldri fasit:** generasjonsregisteret gir APPLICATION CANDIDATE (VEHICLE → MODEL GENERATION → APPLICATION), aldri EXACT. EXACT krever fortsatt OE/foto-evidens.
- **Gratis først:** +5,5 pp uten en krone i dataanskaffelse. Neste gratis-trekk: katalog-rader for Golf/Passat/Polo fra gt-prislisten (som KANDIDATER — evidens-resolveren avgjør).
- **Målbart:** hver datakilde fremover måles mot samme 5 metrikker.

## 5. NESTE (etter arkitekt-gjennomgang)

1. Katalog-kandidat-utvidelse (Golf/Passat/Polo fra gt-prislisten, klasse-D-bevisst) → mål GLASS_COVERAGE igjen
2. C8: TecDoc/EPC-kapabilitetsvalidering (lukker OE_COVERAGE) — prioritert etter gratis-trekkene
3. AI-chat videreutvikles kun rundt det resolveren faktisk kan bevise

**Ingen produksjonsendring. Staging-only. STOPP.**
