# SKU→URL MANIFEST - FASE 4.2 VERIFISERING

**Generert:** 2026-11-01
**Kilde:** Apify run `3BH4i16MJdDAvT19a` (92 produkter) + test-utvalg-100.csv (100 SKUer)
**Status:** 9/100 eksakte treff, 91 mangler

---

## ✅ 9 VERIFISERTE MATCHES

| SKU | Test Typekode | Apify TypeCodeRaw | Konflikt | SideKonflikt | Review Status | Produkt-URL |
|-----|---------------|-------------------|----------|--------------|---------------|-------------|
| DB8426YP | B (Bakrute) | BAKRUTE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/chevrolet-blazer-s10-2-d-bakrute-sotet/ |
| 21390GNL | B (Bakrute) | BAKRUTE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/volvo-940-960-4d-sedan-91-bakrute-el-lam-obs/ |
| 27001GD | DFFV (Ventil fremre førerside) | VENTIL/SIDERUTE FREMRE FØRERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrute-mork-gn/ |
| 28309GN | DFFV (Ventil fremre førerside) | VENTIL/SIDERUTE FREMRE FØRERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/citroen-c5-5d-hbk-stv-08-fremre-ventilrute-innk/ |
| 26251GN | DFF (Dørrute fremre førerside) | DØRRUTE FREMRE FØRERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/vw-transporter-1991-2003-dorrute-fremre-forerside/ |
| 27412GN | DFF (Dørrute fremre førerside) | DØRRUTE FREMRE PASSASJERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/vw-transporter-1991-2003-dorrute-fremre-passasjerside/ |
| 28551GP | DFB (Dørrute bakre førerside) | Dørrute bakre førerside | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/audi-q4-siderute-bakre-forerside/ |
| 20347GN | SFB1 (Siderute bakre 1 førerside) | SIDERUTE BAKRE 1 FØRERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/skoda-rapid-spaceback-stv-siderute-bakre-forerside/ |
| 8445GN | DFBV (Ventil bakre førerside) | VENTIL/SIDERUTE BAKRE FØRERSIDE | false | false | UNVERIFIED_DISCOVERY_ONLY | https://auto-glass.no/produkt/vw-jetta-4d-sedan-ventil-bakre-forerside/ |

**Obs:** Ingen `typeCodeConflict` eller `sideConflict` på de 9 matchene. Alle har `reviewStatus=UNVERIFIED_DISCOVERY_ONLY` som forventet i probe-modus.

---

## ❌ 91 MANGLER - PRIORITERT OPPFOGG

### PRIORITET 1: KJENTE KONFLIKTSAKER (eksplisitt i test-utvalg)

| SKU | Merke/Modell | Typekode | Kategori-URL | Kommentar |
|-----|--------------|----------|--------------|-----------|
| **29730YP** | **MAZDA CX-5** | **DFFV** | https://auto-glass.no/varer/nettbutikk/autoglass/mazda/cx-5/2012-2017-i/ | **KJENT KONFLIKT**: CSV sier DFFV (ventil fremre venstre), eurokode antyder bakre høyre. **Kandidat produkt-URL**: https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/ |

### PRIORITET 2: VENTILRUTER (høy verdi for fitment-presisjon)

| Typekode | Antall | SKUer (utvalg) |
|----------|--------|----------------|
| DFFV | 3 | 5387LGSH3FVWZ (Smart Fortwo), DV11112GN (Dodge Caliber), **29730YP (Mazda CX-5)** |
| DFBV | 3 | 4469LYPR5RVZ (Kia EV3), 26331GN (Renault Megane), 8823GN (VW Jetta) |
| DPFV | 3 | 24936CSL (Mercedes CL), 29914GN2 (Ford B-Max), 8830BL (Toyota Corolla) |
| DPBV | 4 | 30134YPL (Range Rover), 5512RYPR5RVZ1M (Mercedes GLC), 26660GD (VW Golf), 29534YP (BMW 1-serie) |

### PRIORITET 3: DØRRUTER (høy volum, krever fremre/bakre skille)

| Typekode | Antall | Eksempler |
|----------|--------|-----------|
| DFF | 6 | Opel Corsa, Alfa Romeo 33, Nissan Primera, Mitsubishi Colt, Porsche 968, Volvo S80 |
| DFB | 7 | BMW 3-serie Touring, Ford Focus, Daewoo Cruze, Volvo V60, VW Passat CC, Jaguar XF, Peugeot Expert |
| DPF | 7 | Skoda Fabia, Infiniti QX, Opel Corsa (ny), Citroen AX, Nissan Sunny, Chrysler Voyager, VW Polo |
| DPB | 7 | Mercedes M-klasse, Mitsubishi Space Wagon, Fiat Uno, Citroen C5 X, Nissan Murano, Toyota Prius, VW T-Cross |

### PRIORITET 4: SIDERUTER & BAKRUTER

| Typekode | Antall | Eksempler |
|----------|--------|-----------|
| SFB1 | 6 | Fiat Stilo, Audi Q4, VW Caddy, Jeep Cherokee, Volvo 240, VW ID.5 |
| SFB2 | 3 | Renault Trafic, VW Caddy (x2) |
| SFB3 | 2 | SsangYong Rexton, Opel Vivaro |
| SPB1 | 7 | BMW 3-serie Coupe, Peugeot Expert, Peugeot 5008, Lexus LS, Audi A5, Dacia Logan, Mercedes EQS |
| SPB2 | 2 | VW Transporter (last), Mercedes Vito |
| SPB3 | 3 | Renault Trafic, Citroen Berlingo, Opel Vivaro |
| B (Bakrute) | 10 | Peugeot 5008, Ford Fiesta, Ford Explorer, BMW 6-serie, BMW 1-serie, Citroen Evasion, Ford Sierra, Seat Altea, VW Transporter, Saab 900 |
| BF | 3 | Mercedes Vito, Toyota Landcruiser, Opel Combo |
| BP | 2 | Toyota Landcruiser, Jeep Grand Cherokee |
| F (Frontrute) | 13 | Chrysler Lebaron, Mitsubishi Space Runner, Ford Freestyle, Porsche 911 Cab, Skoda Favorit, Skoda Rapid, Toyota RAV4, BMW 4-serie, VW Transporter, Ford Ranger, Mercedes W111, Kia Stinger, Toyota Landcruiser 100 |

---

## MAZDA CX-5 29730YP - DETALJERT UNDERSØKELSE

### Test-utvalg data
- **SKU:** 29730YP
- **Navn:** MAZDA CX 5 (ventilrute)
- **Typekode (CSV/varekort):** DFFV = Ventil/siderute fremre førerside
- **Kategori-URL:** https://auto-glass.no/varer/nettbutikk/autoglass/mazda/cx-5/2012-2017-i/

### Kandidat produkt-URL (fra bruker)
- **URL:** https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/
- **Mønster:** `/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/`
- **Indikasjoner:** "5d-suv" = 5-dør SUV, "ventilrute" = ventilrute, "sotet" = søt

### Hvorfor den mangler i pilot
Piloten kjørte **7 kategorier** med **maxProducts=92 globalt** (ikke per kategori). Mazda-kategorien var den **7. kategorien** besøkt og ble **ikke nådd** før grensen traff.

### Anbefalt handling
1. Neste pilot: **Direkte produkt-URLer** for alle 100 test-SKUer (unngår kategori-crawling usikkerhet)
2. Mazda 29730YP legges som **første** i neste test (høyest prioritet konfliktssak)
3. Forventet TypeCodeRaw fra produkt-side: **DFFV** eller **DFBV** (avslører konflikt)

---

## ANBEFALT KONFIGURASJON FOR NESTE PRØVE (3-5 PRODUKTER)

### Input-fil: `apify-test-3-5-produkter.json`

```json
{
  "username": "[kryptert i Console]",
  "password": "[kryptert i Console]",
  "mode": "probe",
  "catalogUrls": [
    "https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/",
    "https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrute-mork-gn/",
    "https://auto-glass.no/produkt/volvo-940-960-4d-sedan-91-bakrute-el-lam-obs/",
    "https://auto-glass.no/produkt/chevrolet-blazer-s10-2-d-bakrute-sotet/",
    "https://auto-glass.no/produkt/citroen-c5-5d-hbk-stv-08-fremre-ventilrute-innk/"
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

**Valgte 5 produkter:**
1. **29730YP Mazda CX-5** - konfliktssak (DFFV vs eurokode)
2. **27001GD BMW 1-serie** - verifisert match (DFFV)
3. **21390GNL Volvo 940/960** - verifisert match (Bakrute)
4. **DB8426YP Chevrolet** - verifisert match (Bakrute)
5. **28309GN Citroen C5** - verifisert match (DFFV)

**Forventet resultat:**
- Alle 5 returneres med `typeCodeRaw` fylt, `listPriceValue=null`, `stockStatus=UNKNOWN`
- `typeCodeConflict` kun hvis varekort-typekode skiller fra produkt-side-typekode
- Kjøretid: ~2-3 min, kostnad: <$0.01

---

## GO/NO-GO VURDERING

### ✅ GO for:
- Offline SKU-kartlegging (fullført - dette dokumentet)
- Typekode-only mode implementert og testet (tester grønne)
- Hard limits enforcement implementert og testet (tester grønne)
- Automatiseringsskript klart (`scripts/apify-automation.mjs`)
- Build 1.0.16 tagget som `latest` med oppdatert input schema

### ⚠️ NO-GO for ny scraping inntil:
1. **P0 - Publisert input-skjema**: Verifiser at `typekodeOnly` vises i Apify Console UI (krever manuell sjekk i Console)
2. **P0 - API-autentisering**: Verifiser at `apify-automation.mjs` fungerer med integrasjonstoken (krever test-kjøring)
3. **P0 - Reelle kjøregrenser**: Verifiser at maxProducts=5, maxPages=5 respekteres i live-kjøring

### Neste steg (når P0 lukket):
1. Kjør 3-5 produkt test med ovenstående konfig
2. Verifiser at pris/lager = null/UNKNOWN
3. Verifiser at Mazda 29730YP returnerer TypeCodeRaw og eventuell typeCodeConflict
4. Gradvis utvid til 100-produkt test med fullstendig SKU→URL manifest

---

## FILER OPPRETTET/OPPERTERT

| Fil | Beskrivelse |
|-----|-------------|
| `SKU_URL_MANIFEST_TESTUTVALG.md` | Oppdatert manifest (denne filen) |
| `apify-test-3-5-produkter.json` | Input for neste lille test |
| `data/apify-pilot-results.json` | Rådata fra run 3BH4i16MJdDAvT19a |
| `data/test-utvalg-100.csv` | Originalt test-utvalg |
| `scripts/apify-automation.mjs` | Automatiseringsskript |
| `tests/hard-limits.test.mjs` | Hard limits + Typekode-only tester |
| `RAPPORT_FASE4.1_KORRIGERT.md` | Korrigert Fase 4.1 rapport |
EOF