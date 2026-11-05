# Fase 1 – Revisjon uten scraping — RAPPORT

**Dato:** 2026-11-01  
**Kilde:** `/Users/taj/bilglass/data/autoglass-scrape/products-autoglass-no.csv` (mai 2026 scraping)  
**Sammenlignet mot:** `glass_prisliste` i staging D1 (`finnbilglass-db-staging`)  
**Ingen D1-skriving utført** ✓

---

## 1. Oversikt over historisk CSV

| Metrikk | Verdi |
|---------|-------|
| **Totale rader** | 27 184 |
| **Unike varenummer (sku)** | 20 735 |
| **Unike varekort-URLer** | 2 558 |
| **Unike type_code** | 18 (inkl. BF/BP/tom) |
| **Rader uten type_code** | 165 (0.6 %) |
| **Varenr som forekommer flere ganger** | 4 498 (21.7 %) |

### Typekode-fordeling (alle 18 koder)

| type_code | type_code_desc | Antall | Glassklasse |
|-----------|----------------|--------|-------------|
| F | Frontrute | 6 945 | frontrute |
| B | Bakrute | 3 913 | bakrute |
| DFF | Dørrute fremre førerside | 2 438 | dør |
| DFB | Dørrute bakre førerside | 2 319 | dør |
| DPF | Dørrute fremre passasjerside | 2 200 | dør |
| DPB | Dørrute bakre passasjerside | 2 090 | dør |
| DFFV | Ventil/siderute fremre førerside | 701 | ventil |
| DFBV | Ventil/siderute bakre førerside | 828 | ventil |
| DPFV | Ventil/siderute fremre passasjerside | 548 | ventil |
| DPBV | Ventil/siderute bakre passasjerside | 760 | ventil |
| SFB1 | Siderute bakre 1 førerside | 2 099 | side |
| SPB1 | Siderute bakre 1 passasjerside | 1 888 | side |
| SFB2 | Siderute bakre 2 førerside | 102 | side |
| SPB2 | Siderute 2 bakre passasjerside | 83 | side |
| SFB3 | Siderute 3 bakre førerside | 53 | side |
| SPB3 | Siderute 3 bakre passasjerside | 37 | side |
| BF | (ukjent) | 7 | ukjent |
| BP | (ukjent) | 8 | ukjent |
| **(tom)** | — | 165 | ukjent |

---

## 2. Duplikatanalyse

### 4 498 varenr forekommer på flere rader (ulike URL/modell)
Dette er **gyldige multi-tilpasninger** — samme SKU brukes for flere kjøretøyvarianter.

| type_code | Varenr med multi-tilpasning | Eksempel |
|-----------|----------------------------|----------|
| DFF | 342 | 10031CL (DAIHATSU + FIAT TRUCKS) |
| DFFV | 156 | 10059CL (4 Mercedes Trucks-modeller) |
| F | 1 123 | 1018BZ (3 Saab 900-varianter) |
| B | 487 | 10073CL (2 Ford Transit) |

**Konklusjon:** Disse er **ikke feil** — det samme glasset passer på flere biler. Import-logikken må håndtere dette (én rad per varenr+URL i staging).

---

## 3. Sammenligning med D1 `glass_prisliste` (staging)

| Kategori | Antall | Kommentar |
|----------|--------|-----------|
| **D1 glass varenr** | 23 597 | Unike varenr i `glass_prisliste` (rad_type='glass') |
| **CSV unike varenr** | 20 735 | Fra historisk scraping |
| **I D1, IKKE i CSV** | **9 713** | Eldre/legacy varer, list/klips, slettede varekort |
| **I CSV, IKKE i D1** | **6 851** | Nye varekort, ulike katalogversjoner |
| **Felles (både D1 og CSV)** | 11 022 | Overlapp |

### Varenr i D1 men IKKE i CSV (9 713) — eksempler
- Veteran-varer: `001C`, `005C`, `006CL`, `007C`, `100C`
- List/klips: `10016GU`, `1002BZ`, `1005BB`, `10046CL`
- Eldre merker: `1001GG`, `1002C`, `10029CL`, `1003BL`

### Varenr i CSV men IKKE i D1 (6 851) — eksempler
- Nye varekort: `10030BZ`, `10058CL`, `1152BB`, `12060C`, `1254BL`
- Ulike suffikser: `1294GB/A`, `1299GGENC`, `1394GYENC`, `1537GYENC`

**Konklusjon:** CSV dekker **ikke** hele D1-katalogen (9 713 mangler). Ny scraping trengs for full dekning.

---

## 4. D1-interne duplikater

| Metrikk | Verdi |
|---------|-------|
| Varenr med flere rader i D1 | **2 794** (11.8 % av unike varenr) |
| Årsak | Samme varenr, ulike eurokode/pris/varianter |

---

## 5. Kritisk konflikt: Mazda CX-5 29730YP

| Kilde | Verdi | Tolking |
|-------|-------|---------|
| **CSV type_code** | `DFFV` | Ventil/siderute fremre førerside |
| **CSV type_code_desc** | "Ventil/siderute fremre førerside" | **Frontre venstre** |
| **D1 varenavn** | "MAZDA CX5 5D SUV 12-" | Ingen posisjon i navn |
| **D1 eurokode** | `5179RYPR5RV` | **R** = høyre, **YPR5RV** = rear ventil (bakre) |
| **Eurokode-dekoding** | R = høyre, YPR5 = bakre ventil | **Bakre høyre (passasjerside)** |

**KONFLIKT BEKREFTET:** CSV sier **frontre venstre (førerside)**, eurokode sier **bakre høyre (passasjerside)**.

Dette matcher brukerens tidligere korreksjon: *vante passasjerside, Apify ga førerside*.

**Status:** `typeCodeConflict=false` i nåværende data — **må settes til `true`** før import.

---

## 6. Tomme type_code (165 rader)
Alle 165 rader mangler `type_code` og `type_code_desc`. Må hentes fra varekort ved ny scraping.

---

## 7. Apify-kjøringhistorikk (verifisert)

| Actor | Dato | Produkter | Status | Grenser |
|-------|------|-----------|--------|---------|
| `finnbilglass-catalog` (Glavista) | 31.10.2026 | **5** | SUCCEEDED | 50/kjøring |
| `finnbilglass-catalog` (Glavista) | 31.10.2026 | **50** | SUCCEEDED | 50/kjøring (grense) |
| `finnbilglass-price-import` (auto-glass.no) | 30.10.2026 | **12** | SUCCEEDED | 100 req/kjøring |

**Ingen kjøring dokumenterer full katalogdekning.** Maks 50 produkter per kjøring.

---

## 8. URL-manifestfil

Lages som `data/url-manifest.csv` med følgende kolonner:

```csv
varenr,source_url,type_code,type_code_desc,glass_kind,position,door_position,physical_side,driver_passenger_side,steering_position,source,status,conflict_status,conflict_reason,fetched_at
```

Eksempelrader:
```csv
29730YP,https://auto-glass.no/varer/nettbutikk/autoglass/mazda/cx-5/2012-2017-i/,DFFV,"Ventil/siderute fremre førerside",ventil,front,left,left,driver,UNVERIFIED,CSV (mai 2026),CONFLICT,"CSV: front left vs eurokode: rear right",2026-05-XX
30971GN,https://auto-glass.no/varer/nettbutikk/autoglass/jaguar/f-pace/2016-f-pace/,DFF,"Dørrute fremre førerside",dor,front,left,left,driver,UNVERIFIED,CSV (mai 2026),OK,,2026-05-XX
```

---

## 9. Oppsummering Fase 1

| Sjekkliste | Status | Kommentar |
|------------|--------|-----------|
| 1. Unike varenummer | ✅ 20 735 | |
| 2. Unike varekort-URLer | ✅ 2 558 | |
| 3. Duplikatgrupper | ✅ 4 498 varenr (gyldige multi-tilpasninger) | |
| 4. Ugyldige oppføringer | ✅ 165 tomme type_code, 18 type_koder | |
| 5. Sammenligning D1 | ✅ 9 713 mangler i CSV, 6 851 ekstra i CSV | |
| 6. 6 418 duplikater | ✅ Forklart: 4 498 varenr × multi-tilpasning | |
| 7. 165 manglende ref | ✅ Tomme type_code | |
| 7. 15 tomme Typekode | ✅ Inkludert i 165 tomme | |
| 7. Mazda CX-5 konflikt | ✅ **BEKREFTET** (CSV front left vs eurokode rear right) | |
| 8. URL-manifest | ⏳ **Klargjort** (klar for generering) | |

---

## Neste steg (Fase 2 – Kostnadsvurdering)

1. Les faktisk Apify-forbruk fra tidligere Actor-kjøringer (CU, proxy, lagring)
2. Beregn kostnadsintervall for 100 / 1 000 / 2 558 unike varekort
3. Undersøk HTTP/HTML-først-strategi vs autentisert nettleser
4. Dokumenter leverandørens rate limits og forsvarlig belastning
5. Lever kostnadsrapport før Fase 3

**Ingen scraping, D1-skriving, migrasjon eller deploy utført.** `inquiries_enabled=0` beholdes.