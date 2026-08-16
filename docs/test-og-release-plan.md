# FASE 7 — Test-, fasit- og release-gate-plan (KLA-301)

> Status 2026-08-13: **Kun det som er MÅLT rapporteres.** Testsett på 500 biler er planlagt, ikke kjørt. Tilgjengelig staging-kohort nå er 110 regnr.

## 1. Nåværende målte resultater

| Mål | Resultat | Kilde |
|---|---|---|
| Fasit-tester (staging) | **2/2 grønne**: SU18018→PINPOINT 2525CSGY, AJ95429→VERIFY | `scripts/test-fasit.mjs` kjørt 2026-08-13 mot `finnbilglass-frontrute-staging.tomarnejensen.workers.dev` |
| Evidence-fusion + bilde-resolver-regresjon | **14/14 grønne** | `npm run test:fusion` |
| Crosswalk-pipeline-regresjon | **5/5 grønne** | `node --test tests/crosswalk-pipeline.test.mjs` |
| Typecheck | **GRØNN** | `npx tsc --noEmit` |
| Staging test-110 | **110/110 API OK** · correct PINPOINT 11 · wrong PINPOINT 0 · VERIFY 79 · FALLBACK 20 | `BASE_URL=... node scripts/test-100-vin.mjs` |
| Falske PINPOINT | **0 kjente** (2-bil fasit + 110-kohort; 500-bil-settet ikke kjørt) | fasit + test-110 |
| Image resolver pilot-API | **GRØNN** · OCR Eurocode + bilde-feature → PINPOINT · audit lagret | `POST /api/image-resolver` på staging |
| Bildeflyt/OCR/CV | **PILOT-API BYGGET** — kundebilde-UI og ekte CV-provider ikke bygget | docs/faser-3-5-* |

## 2. 500-bil-testsettet (design)

Balansert over: VW/Audi/Skoda/Seat · Toyota/Lexus · BMW/Mini · Mercedes · Volvo · Hyundai/Kia · PSA (Peugeot/Citroën/Opel) · Tesla/Polestar · varebiler · elbiler · eldre (pre-2010) · importbiler · ADAS · HUD · heated · acoustic · antenna · panorama.

**Datakilde:** `data/finn-100.jsonl` (110 regnr fra finn.no) som startkohort → utvides til 500 med SVV-oppslag (regnr→VIN→merke/modell/år). Fasit etableres fra ground_truth + prisliste-kobling (målt: 1 219/1 323 GT-koder = 92 % i prislisten).

**Mål-metrikker:** falsk PINPOINT · korrekt PINPOINT · VERIFY-rate · FALLBACK-rate · OCR-accuracy · feature-presisjon per feature · bilde-dekning · kildekostnad · latency p50/p95 · manuell behandlingstid · kunde-frafall i fotoflyt.

## 3. Release gates (låst — ingen produksjonspåstand før ALLE er dokumentert grønne)

| Gate | Krav | Status |
|---|---|---|
| G1 | **0 falske PINPOINT** i fullt fasit-sett | ⚠️ Ikke målt (settet på 2 grønt; 500-settet må kjøres) |
| G2 | ≥90 % feature-presisjon før positiv bruk | ⚠️ Ikke bygget (CV) |
| G3 | ≥90 % bilde-dekning på prioriterte salgbare ruter | ❌ 0 % — ingen bilde-lisens |
| G4 | 100 % provenance på viste tredjepartsbilder | ✅ i modell (glass_media krever license_ref) — 0 bilder vist |
| G5 | p95 resolver <1,5 s med cache | ⚠️ Ikke målt |
| G6 | Kill switch per kilde + per modell | ⚠️ Designet (FASE 3/5) — ikke implementert |
| G7 | Rollback testet | ⚠️ Ikke utført |
| G8 | Ingen eksterne rådata direkte til prod | ✅ Pipeline: dry-run + review-gate |

## 4. Hva som gjenstår før prod (prioritert)

1. B2B-token (KLA-299) → vin_ktype_map-import → L3 ktype aktiv.
2. 500-bil-fasit-kjøring (script + fasit-grunnlag) → måle G1/G5.
3. Bilde-lisens fra Autoglass-leverandør → FASE 3 mediaflyt → G3/G4.
4. CV-modellvalg + FASE 5-kjede → G2.
5. Kill switch-implementasjon → G6.
6. Rollback-drill → G7.

## 5. Måling 2026-08-13 etter staging-deploy

Staging versjon: `ef7700dd-f82a-4a17-82a8-440c5e49b920`.

Datastatus staging:

- `autoglass_prisliste`: 29 627
- `ground_truth`: 2 008
- `glass_catalog`: 33 215
- `oe_eurocode_mapping`: 341
- `ktype_registry`: 833
- `vin_ktype_map`: 0
- `vin_glass_overrides`: 1

Test-110:

- total: 110
- API-feil: 0
- correct PINPOINT: 11
- wrong PINPOINT: 0
- VERIFY: 79
- FALLBACK: 20

Resolver-lag:

- L1 `ground_truth`: 11
- L2 `glass_catalog`: 79
- ingen resolverdata/fallback: 20

Tolkning:

- False-positive-kontrollen er fortsatt god: 0 wrong PINPOINT.
- Alias-/årparser-patch flyttet 5 biler fra FALLBACK til VERIFY uten å introdusere false positive.
- Hovedproblemet er dekning, ikke scoring. `vin_ktype_map` er 0, OE-mapping er tynn, og 20 biler mangler resolverdata helt.
- `VERIFY`-andelen er høy fordi kandidatene ofte mangler nok build/OE/feature-bevis til streng PINPOINT.
- Bilde-resolveren er klar som pilot-API, men produktbildedekning er fortsatt 0 % uten lisensiert bildegrunnlag.
