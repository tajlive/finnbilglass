# FASE 4.3 — LUKK DE SISTE P0-FEILENE

**Dato:** 2026-11-01
**Status:** P0-1 fixet + testet, P0-2 dokumentert, P0-3 verifisert
**GO for:** kodekorrigering og tester
**HOLD for:** ny scraping, D1-import, migrasjoner, merge, deploy

---

## SAMMENDRAG

| P0 | Krav | Status |
|----|------|--------|
| P0-1 | Typekode-only dataminimering (ingen pris/lager i output) | ✅ FIXET + TESTET |
| P0-2 | Produktsider som ikke finnes (404/omdirigering) | ✅ DOKUMENTERT |
| P0-3 | Mazda 29730YP side-konflikt bevart | ✅ VERIFISERT |

---

## P0-1 — TYPEKODE-ONLY DATAMINIMERING

### Oppdaget feil
Mazda `29730YP` inneholdt `accessories[0].listPriceRaw = "Pris: kr 232"` selv om `typekodeOnly=true`.

### Rotårsak
1. `main.js` brukte en **delete-liste** som ikke omfattet `priceText` og ikke rørte nestede `accessories`-objekter.
2. `extract.js` satte alltid `listPriceRaw` på tilbehør uavhengig av `typekodeOnly`.

### Kodeendring 1: `finnbilglass-price-import/src/main.js` (linje 428-460)

Erstattet delete-liste med **eksplisitt tillatt-liste (allow-list)**. Alle felt ikke på listen fjernes, inkludert nestede objekter.

```javascript
const TOP_LEVEL_ALLOWED = new Set([
    'sku', 'title', 'titleSource', 'url', 'sourceUrl', 'sourcePage', 'scope',
    'glassType', 'glassTypeSource',
    'typeCodeRaw', 'typeCodeSource', 'typeCodeObservations', 'typeCodeSide',
    'typeCodeConflict', 'sideConflict', 'reviewStatus', 'reviewReasons',
    'manualReviewRequired', 'automaticOrderAllowed', 'orderBlockReasons',
    'priorReportedSide', 'priorReportedSideSource', 'priorReportedSideVerified',
    'categoryEvidence', 'verification', 'accessories'
]);
const ACCESSORY_ALLOWED = new Set([
    'sku', 'title', 'sourceUrl', 'sourcePage', 'relation',
    'verifiedFitment', 'priceVerified'
]);
```

- Top-level: alle felt ikke på `TOP_LEVEL_ALLOWED` slettes (`listPriceRaw`, `listPriceValue`, `priceText`, `priceEvidence`, `currency`, `sourcePriceKind`, `vatBasis`, `discountPercentPolicy`, `customerPriceInclVat`, `stockStatus`, `stockEvidence`, `stockQuantity`, `stockCheckedAt`, osv.)
- Accessories: alle felt ikke på `ACCESSORY_ALLOWED` slettes (`listPriceRaw`, `vatBasis`, osv.)
- `priceVerified` tvinges til `false` på alle tilbehør i Typekode-only mode

### Kodeendring 2: `finnbilglass-price-import/src/extract.js` (linje 216, 271-278)

- `priceText`/`priceEvidence` utelates helt fra produkt-objektet når `typekodeOnly=true`
- `listPriceRaw`/`vatBasis` utelates helt fra tilbehør når `typekodeOnly=true`

### Testresultater — ALLE PASS

| Test | Beskrivelse | Resultat |
|------|-------------|----------|
| `checkLimits` | maxPages/maxProducts hard limits | ✅ PASS |
| `testCrawlLimitEnforcement` | Crawl loop stopper ved grense | ✅ PASS |
| `testTypekodeOnlyFiltering` | Eksisterende felt-sletting | ✅ PASS |
| `testTypekodeOnlyDataminimering` | **Ny**: rekursiv allow-list, top-level + accessories | ✅ PASS |
| `testExtractOmitsPriceTextInTypekodeOnly` | **Ny**: extract.js utelater priceText | ✅ PASS |

**Total: 17 test-suites, 0 feil** (npm test grønn)

### Felt som nå fjernes i Typekode-only mode

| Nivå | Felt fjernet |
|------|-------------|
| Produkt (topp) | `listPriceRaw`, `listPriceValue`, `priceText`, `priceEvidence`, `currency`, `sourcePriceKind`, `vatBasis`, `discountPercentPolicy`, `customerPriceInclVat`, `stockStatus`, `stockEvidence`, `stockQuantity`, `stockCheckedAt` |
| Tilbehør (nested) | `listPriceRaw`, `vatBasis` |
| Tilbehør (tvingt) | `priceVerified = false` |

### Felt som bevares i Typekode-only mode

| Nivå | Felt bevart |
|------|-------------|
| Produkt | `sku`, `title`, `titleSource`, `url`, `sourceUrl`, `sourcePage`, `scope`, `glassType`, `glassTypeSource`, `typeCodeRaw`, `typeCodeSource`, `typeCodeObservations`, `typeCodeSide`, `typeCodeConflict`, `sideConflict`, `reviewStatus`, `reviewReasons`, `manualReviewRequired`, `automaticOrderAllowed`, `orderBlockReasons`, `priorReportedSide`, `priorReportedSideSource`, `priorReportedSideVerified`, `categoryEvidence`, `verification`, `accessories` |
| Tilbehør | `sku`, `title`, `sourceUrl`, `sourcePage`, `relation`, `verifiedFitment`, `priceVerified` |

---

## P0-2 — PRODUKTSIDER SOM IKKE FINNES

### Problem
Tre av fem direkte produkt-URLer i `apify-test-3-5-produkter.json` returnerte ingen varer i probe-kjøringen `UZyjsdiJepeb7d3kp`:
- BMW 1-serie
- Volvo 940/960
- Citroën C5

### Årsak
Direkte produkt-URLene i test-filen samsvarer **ikke** med auto-glass.no sine faktiske URL-slugger. Sluggene var antatte/bruker-oppgitte, ikke verifisert mot siden.

### Funn fra eksisterende data (apify-pilot-results.json)

| SKU | Test-URL (returnerte ingenting) | Korrekt produkt-URL fra pilot | Forskjell |
|-----|--------------------------------|-------------------------------|-----------|
| **27001GD** BMW 1-serie | `https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrute-mork-gn/` | `https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrutemork-gronn-%c2%a4%c2%a4/` | Slug: `ventilrute-mork-gn` → `ventilrutemork-gronn-%c2%a4%c2%a4` |
| **21390GNL** Volvo 940/960 | `https://auto-glass.no/produkt/volvo-940-960-4d-sedan-91-bakrute-el-lam-obs/` | `https://auto-glass.no/produkt/volvo-940960-4d-sedan-91-bakrute-el-laminert-obs/` | Slug: `volvo-940-960` → `volvo-940960`, `el-lam-obs` → `el-laminert-obs` |
| **28309GN** Citroën C5 | `https://auto-glass.no/produkt/citroen-c5-5d-hbk-stv-08-fremre-ventilrute-innk/` | `https://auto-glass.no/produkt/citroen-c-5-5d-hbkstv-08-fremre-ventilruteinnkaps/` | Slug: `citroen-c5` → `citroen-c-5`, `hbk-stv` → `hbkstv`, `ventilrute-innk` → `ventilruteinnkaps` |

### Kildebevis
URLene er hentet fra `data/apify-pilot-results.json` (tidligere Apify-kjøring `3BH4i16MJdDAvT19a`, 92 produkter), hvor disse SKUene ble funnet med `typeCodeRaw` og pris data.

### Handling
Ikke gjett nye URL-er. De korrekte produkt-URLene er dokumentert ovenfor med kildereferanse til pilot-data. Neste test skal bruke disse verifiserte URLene.

---

## P0-3 — MAZDA 29730YP

### Status: UENDRET (korrekt som det er)

| Felt | Verdi |
|------|-------|
| `typeCodeRaw` | `VENTIL/SIDERUTE FREMRE FØRERSIDE` (leverandørens observasjon, bevart) |
| `typeCodeSource` | `SUPPLIER_TYPEKODE_DETAIL_FIELD` |
| `sideConflict` | `true` ✅ |
| `reviewStatus` | `REQUIRES_MANUAL_REVIEW` ✅ |
| `automaticOrderAllowed` | `false` ✅ |
| `priorReportedSide` | `PASSENGER` (Toms tidligere korreksjon) |
| `priorReportedSideSource` | `PRIOR_USER_REPORTED_CORRECTION` |
| `priorReportedSideVerified` | `false` ✅ (ikke uavhend-verifisert) |
| `reviewReasons` | `SUPPLIER_TYPECODE_VS_REPORTED_SIDE`, `UNRESOLVED_REPORTED_SIDE_DISCREPANCY` |
| `orderBlockReasons` | `FITMENT_NOT_VERIFIED`, `CUSTOMER_PRICING_NOT_VERIFIED`, `SIDE_DISCREPANCY_REQUIRES_REVIEW` |

### Verifisert
- Leverandørens Typekode (`VENTIL/SIDERUTE FREMRE FØRERSIDE` = førerside) er bevart som egen observasjon
- Toms tidligere rapporterte passasjerside er klassifisert som `priorReportedSideVerified: false` (uavhend-verifisert brukeropplysning)
- Ingen automatisk godkjenning av riktig fysisk side — `automaticOrderAllowed=false`, `manualReviewRequired=true`

---

## NYE TESTER (PASS/FAIL)

Følgende tester ble lagt til i `tests/hard-limits.test.mjs`:

| Test | PASS/FAIL | Hva den verifiserer |
|------|-----------|---------------------|
| `testTypekodeOnlyDataminimering` | ✅ PASS | Allow-list fjerner ALLE kommersielle felt fra topp-nivå OG nestede accessories |
| `testExtractOmitsPriceTextInTypekodeOnly` | ✅ PASS | `extract.js` utelater `priceText`/`priceEvidence` når `typekodeOnly=true` |

Eksisterende tester fortsatt grønne: `checkLimits`, `testCrawlLimitEnforcement`, `testTypekodeOnlyFiltering`.

---

## FORSLAG TIL NY VERIFIKASJONSTEST

**Test: "Typekode-only pilot med korrigert URL-manifest"**

Bruk de korrigert produkt-URLene fra P0-2 sammen med Mazda 29730YP:

```json
{
  "mode": "probe",
  "catalogUrls": [
    "https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/",
    "https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrutemork-gronn-%c2%a4%c2%a4/",
    "https://auto-glass.no/produkt/volvo-940960-4d-sedan-91-bakrute-el-laminert-obs/",
    "https://auto-glass.no/produkt/chevrolet-blazer-s10-2-d-bakrute-sotet/",
    "https://auto-glass.no/produkt/citroen-c-5-5d-hbkstv-08-fremre-ventilruteinnkaps/"
  ],
  "maxProducts": 5,
  "maxPages": 5,
  "includeProductPages": false,
  "saveState": false,
  "allowReconciliation": false,
  "typekodeOnly": true,
  "throttleMs": 1100
}
```

**Forventet resultat:**
- Alle 5 returneres med `typeCodeRaw` fylt
- Ingen `listPriceRaw`, `listPriceValue`, `priceText` på produkter
- Ingen `listPriceRaw`, `vatBasis` på tilbehør
- Mazda 29730YP: `sideConflict=true`, `reviewStatus=REQUIRES_MANUAL_REVIEW`, `automaticOrderAllowed=false`
- Kostnad: <$0.01 (tak $0.50)
- D1: ingen skriving

---

## FILER ENDRET

| Fil | Endring |
|-----|---------|
| `finnbilglass-price-import/src/main.js` | Allow-list for Typekode-only (erstatter delete-liste), rekursiv tilbehør-strip |
| `finnbilglass-price-import/src/extract.js` | Utelat `priceText`/`priceEvidence` på produkt, `listPriceRaw`/`vatBasis` på tilbehør når `typekodeOnly=true` |
| `tests/hard-limits.test.mjs` | 2 nye tester: rekursiv dataminimering + extract.js priceText-utelatelse |
| `RAPPORT_FASE4.3_P0_LUKKET.md` | Denne rapporten |

---

## HOLD OPPRETHOLDT

- Ingen ny scraping før P0 er fulle lukket (P0-1 fixet, P0-2 dokumentert, P0-3 verifisert)
- Ingen D1-import, migrasjoner, merge eller produksjonsdeploy
- `inquiries_enabled=0` beholdes
- `apify-test-3-5-produkter.json` oppdateres med korrigert URL-manifest før neste test

---

## NESTE STEG (etter Tom-godkjenning)

1. Oppdater `apify-test-3-5-produkter.json` med korrigert URL-manifest fra P0-2
2. Kjør `--task-id=efh6cQo6pYdYdBX8Y --wait` (eller ny task med korrigert URLer)
3. Verifiser at ingen kommersielle felt finnes i output
4. Verifiser Mazda 29730YP side-konflikt fortsatt til stede
5. GO/NO-GO for gradvis utvidelse til 100-produkt test
EOF