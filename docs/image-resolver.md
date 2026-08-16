# AI bilde-resolver

Målet er å bruke kundebilder og lisensierte katalogbilder til å verifisere riktig frontrute uten å gjøre flyten komplisert.

Kjerneprinsipp:

```
VIN/OEM/build + crosswalk + feature-match = mulig PINPOINT
Bilde/OCR/CV = evidens og eliminering
AI alene = aldri PINPOINT
```

## Bilder vi trenger

1. `corner_marking`: bilde av rutehjørne eller glassmerking. Best for OCR av Eurocode/OE.
2. `mirror_area`: bilde bak speilet. Best for kamera, regnsensor, lys-sensor, speilbrakett og ADAS.
3. `full_glass`: valgfritt. Brukes kun som svak visuell likhet, aldri som sannhet.

For kunden bør dette først vises når resolveren havner i `VERIFY`, ikke før. En `PINPOINT`-bil skal ikke belastes med ekstra steg.

## Arkitektur

`src/image-resolver.ts` er delt core for FinnBilGlass og B2B:

```
ImageInput[]
  -> VisionProvider.observe()
  -> ImageObservation[]
  -> EvidenceSignal[]
  -> fuseEvidence()
  -> PINPOINT / VERIFY / FALLBACK / MANUAL_REVIEW
```

Provideren kan være Workers AI, OpenAI, intern B2B-modell eller en manuell testdobbel. Kontrakten er stabil: provider returnerer OCR-koder, feature-observasjoner og eventuell visuell likhet. Modulen normaliserer og vekter signalene før `evidence-fusion`.

## Produksjonsregler

- Produktbilder må komme fra lisensiert feed eller egne B2B-bilder.
- Buycarparts-bilder kan brukes til research/QA bare når rettigheter og tilgang er avklart.
- OCR av synlig Eurocode/OE er høyverdi-evidens, men ved konflikt går saken til `MANUAL_REVIEW`.
- Kamera, HUD, varme og regnsensor er hard-stop features. Hvis bilde sier ja og kandidat sier nei, skal vi ikke gjette.
- Visuell likhet er lav vekt og kan bare styrke en ellers riktig kandidat.

## Neste integrasjon

1. Lag opplastingssteg i checkout bare for `VERIFY`.
2. Lag R2-lagring med kort retention og samtykketekst.
3. Kall `resolveGlassImages()` med eksisterende resolver-kandidater.
4. Lagre `ImageObservation` i `image_observations` og signalene i `glass_evidence`.
5. Vis enkelt språk i UI: «Vi trenger to bilder for å bekrefte riktig rute», ikke tekniske feature-navn.

## Pilot-API

`POST /api/image-resolver` tar strukturerte AI-observasjoner fra en pilot-provider eller B2B og returnerer samme beslutning som `evidence-fusion`.

I produksjon kreves:

```
Authorization: Bearer $IMAGE_RESOLVER_SECRET
```

Minimal payload:

```json
{
  "queryRef": "ordre-eller-test-id",
  "candidates": [
    {
      "glassId": "EUR:8579ACSGYAVZ1B",
      "eurocode": "8579ACSGYAVZ1B",
      "oemNumbers": [],
      "features": { "camera": true, "rain_sensor": true },
      "sellable": true,
      "priceTier": 8490
    }
  ],
  "observations": [
    {
      "imageId": "corner-1",
      "role": "corner_marking",
      "modelVersion": "pilot-manual-1",
      "eurocodes": [{ "value": "8579ACSGYAVZ1B", "confidence": 0.92 }],
      "oemNumbers": [],
      "features": [],
      "similarities": [],
      "warnings": []
    }
  ]
}
```

Responsen lagres best-effort i `image_resolution_audit`. Mangler migrasjonen i miljøet, feiler ikke API-kallet, men audit-loggen uteblir.
