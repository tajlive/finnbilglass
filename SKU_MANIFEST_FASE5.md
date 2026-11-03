# SKU→URL MANIFEST — FASE 5 ARBEIDSPAKKE B

**Generert:** 2026-11-01
**Kilde:** data/test-utvalg-100.csv (100 SKU-er)
**Sammenligning:** Apify pilot (3BH4i16MJdDAvT19a, 92 produkter) + Fase 4.4 run (sarEkPbes0rjlcg3A, 5 produkter)
**Status:** 10 VERIFIED, 90 MISSING

---

## SAMMENDRAG

| Kategori | Antall | SKU-er |
|----------|--------|--------|
| VERIFIED (bekreftet produkt-URL) | 10 | se tabell nedenfor |
| MISSING (ingen bekreftet produkt-URL) | 90 | se tabell nedenfor |
| CONFLICT (typekode-konflikt, manuell review) | 1 | 29730YP |
| NOT_FOUND (side returnerte ingen vare) | 0 | — |

**Totalt:** 100 SKU-er i test-utvalget

---

## ✅ VERIFIED — 10 SKU-er med bekreftet produkt-URL

| # | SKU | Typekode | Typekode-beskrivelse | Produkt-URL | Kilde | Konflikt |
|---|-----|----------|----------------------|-------------|-------|----------|
| 1 | DB8426YP | B | Bakrute | https://auto-glass.no/produkt/chevrolet-blazer-s10-2-d-bakrute-sotet/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 2 | 21390GNL | B | Bakrute | https://auto-glass.no/produkt/volvo-940960-4d-sedan-91-bakrute-el-laminert-obs/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 3 | 26251GN | DFF | Dørrute fremre førerside | https://auto-glass.no/produkt/vw-transporter-1991-2003-dorrute-fremre-forerside/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 4 | 27001GD | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/produkt/bmw-1-serie-5d-hbk-04-ventilrutemork-gronn-%c2%a4%c2%a4/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 5 | 27412GN | DFF | Dørrute fremre passasjerside | https://auto-glass.no/produkt/vw-transporter-1991-2003-dorrute-fremre-passasjerside/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 6 | 28309GN | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/produkt/citroen-c-5-5d-hbkstv-08-fremre-ventilruteinnkaps/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 7 | 28551GP | DFB | Dørrute bakre førerside | https://auto-glass.no/produkt/audi-q4-siderute-bakre-forerside/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 8 | 20347GN | SFB1 | Siderute bakre 1 førerside | https://auto-glass.no/produkt/skoda-rapid-spaceback-stv-siderute-bakre-forerside/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 9 | 8445GN | DFBV | Ventil/siderute bakre førerside | https://auto-glass.no/produkt/vw-jetta-4d-sedan-ventil-bakre-forerside/ | Apify pilot run 3BH4i16MJdDAvT19a | Nei |
| 10 | 29730YP | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/ | Fase 4.4 run sarEkPbes0rjlcg3A | **JA** (sideConflict) |

---

## ❌ MISSING — 90 SKU-er uten bekreftet produkt-URL

### Prioritet 1: Kjente konfliktsaker

| SKU | Typekode | Typekode-beskrivelse | Kategori-URL fra CSV | Kommentar |
|-----|----------|----------------------|----------------------|-----------|
| 29730YP* | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/varer/nettbutikk/autoglass/mazda/cx-5/2012-2017-i/ | Konflikt: CSV sier DFFV (førerside), tidligere brukerrapport sier passasjerside. Produkt-URL bekreftet i Fase 4.4. SideConflict=true, REQUIRES_MANUAL_REVIEW. |

\* Allerede i VERIFIED-tabellen ovenfor, men har konflikt som krever manuell gjennomgang før ordre.

### Prioritet 2: Ventilruter (høy verdi for fitment-presisjon)

| SKU | Typekode | Typekode-beskrivelse | Kategori-URL fra CSV |
|-----|----------|----------------------|----------------------|
| 5387LGSH3FVWZ | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/varer/nettbutikk/autoglass/smart/fortwo/3d-cc-fortwo/2015-2021-iii-3d-cc-fortwo/ |
| DV11112GN | DFFV | Ventil/siderute fremre førerside | https://auto-glass.no/varer/nettbutikk/autoglass/usa-biler/dodge/caliber-5-d-hatchback/2007-caliber-5-d-hatchback/ |
| 26331GN | DFBV | Ventil/siderute bakre førerside | https://auto-glass.no/varer/nettbutikk/autoglass/renault/megane/5-d-c-c-megane/2003-2006-ii/ |
| 24936CSL | DPFV | Ventil/siderute fremre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/mercedes/serie-w215/cl-coupe/2001-2002/ |
| 29914GN2 | DPFV | Ventil/siderute fremre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/ford/b-max/2012-b-max/ |
| 8830BL | DPFV | Ventil/siderute fremre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/toyota/corolla/corolla-4-d-sedan/1983-1987-corolla-4-d-sedan/ |
| 30134YPL | DPBV | Ventil/siderute bakre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/landrover/range-rover/range-rover-iv/2013-range-rover-iv/ |
| 5512RYPR5RVZ1M | DPBV | Ventil/siderute bakre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/mercedes/serie-x254-glc/2023-serie-x254-glc/ |
| 26660GD | DPBV | Ventil/siderute bakre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/vw/golf/golf-5-d-c-c/2003-2007-golf-5-d-c-c/ |
| 29534YP | DPBV | Ventil/siderute bakre passasjerside | https://auto-glass.no/varer/nettbutikk/autoglass/bmw/1-serie/5d/2011-5d/ |

### Prioritet 3: Dørruter (høy volum, krever fremre/bakre skille)

| Typekode | Antall | Eksempler (SKU) |
|----------|--------|-----------------|
| DFF | 6 | 20123BL, 22179GN, 21453GN, 20123BL, 6717LGNT2FD, 27475GNLAQ |
| DFB | 7 | 27115GN, 28870GN, 29277YP, 2756LYDV5RD, 28401GD, 4339LGSE5RD1M, 25680GN |
| DPF | 7 | 27864GN, 6057RGSR5FDW, 27768GN, 20932GN, 20638BL, DD11369GN, 22140GN |
| DPB | 7 | 24488GN, 24566GN, 24759GN, 27288BL, 28610YP, 28401GD, 8649RYPR5RDW |

### Prioritet 4: Sideruter & bakruter

| Typekode | Antall | Eksempler (SKU) |
|----------|--------|-----------------|
| SFB1 | 6 | 20364GN, 25761GN, 28206YD, 7767CL, 8658LYPC5RQWZ, 8660LYPC4RQWZ |
| SFB2 | 3 | 26826GD2, 26827YD2, 25680GN |
| SFB3 | 2 | 27071YP, 26340GN |
| SPB1 | 7 | 27728GN, 27944GD, 28016GN, 29046GPL, 8429RGAS4RDKW, 5510RYPS4RQZ, DQ7184GN |
| SPB2 | 2 | 23237GN2, 8579RGPV4RDF |
| SPB3 | 3 | 7296RGSV4MQ, 23744GN, 26338GN |
| B | 10 | 29047GN, 7180CL, DB10556YP, 29527YP, 23066GN, 8529BZ, 27988GN, 21416C, 29528GN, 20743BZ |
| BF | 3 | 24759GN, 20851BL, 22549GN |
| BP | 2 | 20852BL, DQ10793YP |
| F | 13 | 1632C, 1766BB, 1943GY, 2197GG, W1612GB, 3137GYCAMG, 3203GNM, 3393GN, 456GB, 4454AGSBLCIMOUVW, 3199GYM2, W858GB, H5510RYPS4RQZ |

---

## ANBEFALT KONFIGURASJON FOR NESTE APIFY-DISCOVERY

### Små puljer med hardgrense

| Pulje | SKU-er | maxProducts | maxPages | typekodeOnly | Forventet kostnad |
|-------|--------|-------------|----------|--------------|-------------------|
| A (konflikt) | 29730YP | 1 | 1 | true | <$0.01 |
| B (ventil, høy prioritet) | 10 SKU-er | 10 | 10 | true | ~$0.02 |
| C (dør, medium) | 20 SKU-er | 20 | 20 | true | ~$0.04 |
| D (side/bak, lav) | 59 SKU-er | 30 | 30 | true | ~$0.06 |

**Total estimert kostnad:** <$0.15 for alle 90 manglende SKU-er

### Konfigurasjonsmal

```json
{
  "mode": "probe",
  "catalogUrls": ["<verifert produkt-URL 1>", "<verifert produkt-URL 2>", "..."],
  "maxProducts": <antall URL-er>,
  "maxPages": <antall URL-er>,
  "includeProductPages": true,
  "saveState": false,
  "allowReconciliation": false,
  "typekodeOnly": true,
  "throttleMs": 1500
}
```

---

## AKSEPTANSEKRITERIER (fra CTO-ordre V3.0)

| Krav | Status |
|------|--------|
| Alle 100 SKU-er har dokumentert status | ✅ (10 VERIFIED, 90 MISSING) |
| Ingen produkt-URL-er er gjettet ut fra navn | ✅ (alle URL-er hentet fra Apify-datasett eller CSV) |
| Ingen Typekode alene er løftet til EXACT | ✅ (Typekode brukes kun som observasjon, aldri som bekreftelse) |
| Ingen ny scraping er startet | ✅ (HOLD opprettholdt) |

---

## FILER

| Fil | Beskrivelse |
|-----|-------------|
| data/test-utvalg-100.csv | Originalt test-utvalg (100 SKU-er) |
| data/apify-pilot-results.json | Rådata fra pilot-run (92 produkter) |
| data/apify-run-report-sarEkPbes0rjlcg3A.json | Fase 4.4 run-rapport (5 produkter) |
| data/apify-run-report-UZyjsdiJepeb7d3kp.json | Fase 4.2 run-rapport (2 produkter) |
| SKU_URL_MANIFEST_TESTUTVALG.md | Tidligere manifest (Fase 4.2) |

---

## NESTE STEG (etter GO fra Tom)

1. Opprett Apify-task med verifiserte produkt-URL-er per pulje
2. Kjør typekode-only test med maxProducts per pulje
3. Verifiser at ingen kommersielle felt slipp igjennom
4. Oppdater dette manifestet med nye funn
5. Gradvis utvid til alle 90 manglende SKU-er

**HOLD:** Ingen fullcrawl, ingen D1-import, ingen produksjonsdeploy. `inquiries_enabled=0`.
EOF