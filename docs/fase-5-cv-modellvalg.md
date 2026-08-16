# FASE 5 — CV-modellvalg (KLA-301)

> Beslutning 2026-08-13: **Cloudflare Workers AI — `@cf/unum/uform-gen2-qwen-500m`** (visuelt språkmodell, åpen vekter, kjører på CF GPU-inferens).

## Hvorfor

| Kriterium | Valg | Alternativ vurdert |
|---|---|---|
| Runtime | Kjører i Worker (samme edge, ingen ekstra infra, ingen data ut av CF) | egen modell-eksport (tungt) |
| Lisens | Åpen (ikke kommersiell blokker) | proprietær vision-API (dataeksport/GDPR-risiko) |
| Oppgaver | VLM: OCR + featuredeteksjon i én modell (trinn 3+4) | separat OCR + CV |
| Kostnad | Workers AI-gratisnivå i utvikling; per 1k tokens i prod | per kall hos ekstern leverandør |
| Kill switch | `cv_model_uform1` i feature_flags (G6, bygget) | — |

## Design (trinn i kundeflyten, FASE 4-bilder)

1. Kunden laster opp Bilde 1 (hjørnemarkering) / Bilde 2 (bakspeilområde) — EXIF-strippet, kvalitetssjekk.
2. Worker kaller `env.AI.run('@cf/unum/uform-gen2-qwen-500m', { prompt, image })` med stram prompt: «Returner JSON: {eurocode_markering, oem_markering, features: {rain_sensor, camera, hud, heated}, kvalitet} — ukjent = null. Ingen gjetting.»
3. Output normaliseres til `EvidenceSignal[]` (FASE 6-format) med modelVersion='uform1', inputHash=SHA-256(bilde).
4. **Fusion bestemmer** — CV-signalet er image_feature (vekt 0.5), aldri avgjørende alene.

## Status: IKKE BYGGET

- Modellen er valgt og formatet er definert. Ingen CV-kode finnes ennå, ingen presisjon er målt.
- Kill-switch-flagget `cv_model_placeholder=0` er default → ingen CV-signaler når koden kommer.
- Neste: POC mot Workers AI i staging med 10 kjente fasit-bilder (når bilde-lisens/kundebilder finnes).
