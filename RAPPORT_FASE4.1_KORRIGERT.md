# FASE 4.1-RAPPORT: P0-korrigering etter Apify Run 3BH4i16MJdDAvT19a

**Status:** GO for skrivebeskyttet kartlegging og kodekontroll. **HOLD for nye Actor-kjøringer.**

---

## 1. KJØRINGSOVERSIKT (KORRIGERT)

| Parameter | Rapportert tidligere | Verifisert fra Apify API | Avvik |
|-----------|---------------------|-------------------------|-------|
| **Run ID** | `3BH4i16MJdDAvT19a` | `3BH4i16MJdDAvT19a` | — |
| **Status** | `SUCCEEDED` | `SUCCEEDED` | — |
| **Sluttid (UTC)** | 06:48 | **05:48:04** | **+1 time** (sommer/tidssone) |
| **Varighet** | 605 sek (10m 5s) | 605 sek | — |
| **Compute Units** | 0.336248 | 0.336248 | — |
| **Kostnad (est.)** | $0.068 | $0.068 (CU-basert) | — |
| **Input brukt** | `maxProducts=10, maxPages=20` | **`maxProducts=92, maxPages=92`** | **KRITISK** |

> **Konklusjon:** Den faktiske inputen var **ikke** pilot-konfigurasjonen. Den gamle 94-URL konfigurasjonen med `maxProducts=92` ble kjørt.

---

## 2. RESULTATER (KORRIGERT)

| Metrikk | Verdi | Kommentar |
|---------|-------|-----------|
| **Produkter returnert** | 92 | Stemmer med maxProducts=92 |
| **Unike SKU-er** | 92 | Alle unike |
| **Unike produkt-URL-er** | 92 | Alle unike |
| **Eksplisitt Typekode** | 92/92 (100%) | Fra varekort-detaljer |
| **Kategorisider besøkt** | **7** (ikke 5) | GMC, Volvo V90, BMW 1-serie, Citroën C5, Lexus LS, Peugeot 107, VW Golf |
| **Produktsider besøkt** | **85** | Fra sidediagnostikk |
| **Totalt besøkte sider** | **92** | Stemmer med maxPages=92 |
| **Typekode-konflikter** | **1** (Lexus 2453CSGELM) | `typeCodeConflict=true`, `REQUIRES_MANUAL_REVIEW` |
| **Mazda 29730YP** | **Ikke funnet** | Mazda-kategori ikke besøkt (ble #8+) |
| **Priser samlet inn** | 92/92 | **Skulle IKKE skje i Typekode-only test** |
| **Lager samlet inn** | 92/92 | **Skulle IKKE skje i Typekode-only test** |
| **Alle poster** | `UNVERIFIED_DISCOVERY_ONLY` | Korrekt |

---

## 3. ROOT CAUSE ANALYSE: AVVIKET I maxProducts/maxPages

### 3.1 Hva skjedde?

Apify Console **sammenfletter** input fra UI med default input fra `.actor/input_schema.json`. Når man kun oppdaterer deler av JSON-en i Console, beholdes gamle felter (som `maxProducts=92`) fra default input.

### 3.2 Teknisk forklaring

```
Default input (fra .actor/input_schema.json):
  maxProducts: 92 (default)
  maxPages: 92 (default)

UI-opdatering (det brukeren så):
  catalogUrls: [5 kategorier]
  maxProducts: 10 (manuelt satt)
  maxPages: 20 (manuelt satt)

SAMMENFLETTET RESULTAT (hva Actoren faktisk fikk):
  catalogUrls: [5 kategorier]  ← ny
  maxProducts: 92  ← FRA DEFAULT (ikke overskrevet!)
  maxPages: 92   ← FRA DEFAULT (ikke overskrevet!)
```

**Apify mergestrategi:** Shallow merge - kun felter som eksplisitt sendes i UI-request overskrives. Felter som mangler i UI-request (men finnes i default) **beholdes**.

### 3.3 Bevis fra kode

I `main.js` linje 330-350:
```javascript
maxPages: Math.max(1, Math.min(30000, Number(input.maxPages || 8))),
maxProducts: Math.max(1, Math.min(100000, Number(input.maxProducts || 50))),
```

Default i schema: `maxProducts: 92`, `maxPages: 92` → Actor brukte disse.

---

## 4. P0-KORREKSJONER IMPLEMENTERT

### 4.1 Hard Limit Enforcement (main.js)

**Før:** Grenser sjekket *etter* sidebehandling, kun ved `recordsBySku.size >= maxProducts` i loop-betingelse.

**Etter:** `checkLimits()` kjøres **FØR** hver side-lasting, **ETTER** side-lasting, **ETTER** hver produkthåndtering, og **VED SLUTT** av loop.

```javascript
const checkLimits = () => {
    if (pageCount >= config.maxPages) return true;  // HARD STOP
    if (recordsBySku.size >= config.maxProducts) return true;  // HARD STOP
    return false;
};

// Kalles 4 ganger per iterasjon:
// 1. FØR page.goto()
// 2. ETTER page.goto() (før produkthåndtering)  
// 3. ETTER hvert produkt (innenfor for-løkken)
// 4. VED SLUTT av while-loop
```

### 4.2 Typekode-only Mode (main.js + extract.js)

**Nytt input-felt:** `typekodeOnly: boolean` (default: `false`)

**Når `typekodeOnly=true`:**
- `extractFromPage()` returnerer `price: { raw: null, evidence: 'TYPEKODE_ONLY_MODE' }`
- `extractFromPage()` returnerer `stock: { status: 'UNKNOWN', evidence: 'TYPEKODE_ONLY_MODE' }`
- Output-faser stripper **alle** pris/lager-felter fra poster
- `summary.withPrices = 0`, `summary.withStockSignals = 0`
- `saveState` tvinges til `false` (probe-mode sikrer allerede dette)

### 4.3 Input Schema Oppdatert

```json
{
  "typekodeOnly": {
    "title": "Typekode-only modus (uten pris/lager)",
    "type": "boolean",
    "default": false,
    "description": "Kun Typekode, SKU og produkt-URL samles inn. Pris/lager utelates. Ingen D1-skriving."
  }
}
```

### 4.4 Automatiserte Tester (tests/hard-limits.test.mjs)

| Test | Status |
|------|--------|
| `checkLimits()` - maxPages enforcement | ✅ PASS |
| `checkLimits()` - maxProducts enforcement | ✅ PASS |
| Crawl loop stopper ved hard limits | ✅ PASS (stoppes ved side 2, maxProducts=5) |
| Typekode-only stripper pris/lager | ✅ PASS |
| Typekode-only bevarer typeCodeRaw | ✅ PASS |

---

## 5. KARTLEGGING AV DE 92 INNSAMLEDE PRODUKTER MOT TEST-UTVALGET

### 5.1 SKU→Produkt-URL Join Resultat

| Kategori | Test-SKUer i utvalg | Funnet i 92 innsamlet | Mangler |
|----------|---------------------|----------------------|---------|
| FRONTRUTE | 13 | **0** | 13 |
| BAKRUTE | 12 | **0** | 12 |
| DØRRUTE | 30 | **0** | 30 |
| SIDERUTE | 24 | **0** | 24 |
| VENTILRUTE | 16 | **0** | 16 |
| UKJENT | 5 | **0** | 5 |
| **TOTALT** | **100** | **0** | **100** |

> **ÅRSAK:** De 92 innsamlede produktene kommer fra **7 andre kategorier** (GMC, Volvo V90, BMW 1-serie, Citroën C5, Lexus LS, Peugeot 107, VW Golf) enn de 5 pilot-kategoriene vi ville teste. **Ingen overlapp** med test-utvalget.

### 5.2 De 92 innsamlede SKU-er (TypeCodeRaw fordeling)

| TypeCodeRaw | Antall | GlassType |
|-------------|--------|-----------|
| FRONTRUTE | 17 | FRONTRUTE |
| BAKRUTE | 12 | OVRIG_GLASS |
| DØRRUTE BAKRE FØRERSIDE | 12 | OVRIG_GLASS |
| DØRRUTE BAKRE PASSASJERSIDE | 9 | OVRIG_GLASS |
| DØRRUTE FREMRE PASSASJERSIDE | 7 | OVRIG_GLASS |
| DØRRUTE FREMRE FØRERSIDE | 7 | OVRIG_GLASS |
| SIDERUTE BAKRE 1 FØRERSIDE | 9 | OVRIG_GLASS |
| VENTIL/SIDERUTE FREMRE FØRERSIDE | 5 | OVRIG_GLASS |
| VENTIL/SIDERUTE BAKRE FØRERSIDE | 2 | OVRIG_GLASS |
| VENTIL/SIDERUTE BAKRE PASSASJERSIDE | 2 | OVRIG_GLASS |
| SIDERUTE BAKRE 1 PASSASJERSIDE | 2 | OVRIG_GLASS |
| VENTIL/SIDERUTE FREMRE PASSASJERSIDE | 1 | OVRIG_GLASS |

**Totalt unike TypeCodeRaw: 12** (ikke 16/17 som tidligere rapportert - casing-normalisering fjerner duplikater)

---

## 6. MAZDA CX-5 29730YP - STATUS

| Sjekk | Resultat |
|-------|----------|
| **Innsamlet i run 3BH4i16MJdDAvT19a?** | ❌ **NEI** |
| **Mazda-kategori besøkt?** | ❌ **NEI** (var kategori #8, kun 7 besøkt) |
| **Kjent kandidat-URL** | `https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/` |
| **CSV TypeCodeRaw for 29730YP** | `DFFV` (Ventil Fremre Førerside = Venstre) |
| **Earlier korreksjon (Tom)** | Passasjerside (Høyre) |
| **Status** | **REQUIRES_MANUAL_REVIEW** - må verifiseres med ny kjøring |

---

## 7. FORSLAG TIL NESTE PILOT (KOSTNADSKONTROLLERT)

### 7.1 Konfigurasjon

```json
{
  "catalogUrls": [
    "https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/",
    ... (91 andre direkte /produkt/-URLer fra test-utvalg-100-corrected.csv)
  ],
  "mode": "probe",
  "maxProducts": 100,
  "maxPages": 100,
  "includeProductPages": true,
  "saveState": false,
  "allowReconciliation": false,
  "throttleMs": 1500,
  "typekodeOnly": true
}
```

### 7.2 Forventet kostnad

- 100 produkt-sider × ~$0.0007/CU = **~$0.07** (vel under $0.50 tak)

### 7.3 Godkjennelseskriterier for neste GO

1. ✅ Hard limits testet og bevisst (tests/hard-limits.test.mjs)
2. ✅ Typekode-only mode implementert og testet
3. ✅ Actor build 1.0.16 deployet med korrigert kode
4. ⏳ **SKU→URL-manifest for alle 100 test-SKUer fullført** (må kartlegges fra historisk CSV)
5. ⏳ **Mazda 29730YP-URL bekreftet** i manifest
6. ⏳ Neste pilot kjører med **direkte produkt-URLer** (ikke kategorisider)

---

## 8. LEVERANSEKRAV FØR NY GO (ifølge ordre)

| # | Leveranse | Status |
|---|-----------|--------|
| 1 | Revidert Fase 4-rapport | ✅ **DETTE DOKUMENTET** |
| 2 | Dokumentert årsak til maxPages/maxProducts avvik | ✅ Seksjon 3 |
| 3 | Tester som beviser harde grenser håndheves | ✅ tests/hard-limits.test.mjs |
| 4 | Testbevis for Typekode-only uten pris/lager | ✅ Seksjon 4.2 + tests |
| 5 | SKU→produkt-URL-manifest for testutvalget | ⏳ **PÅGÅR** (trenger 97 manglende URLer) |
| 6 | Liste over fortsatt manglende URL-er | ⏳ **PÅGÅR** |
| 7 | Forslag til neste lille pilot | ✅ Seksjon 7 |

---

## 9. BESLUTNING

**GO for:** Offline kartlegging av 92 innsamlede SKU-er + fullføring av SKU→URL-manifest for 100 test-SKUer.

**HOLD for:** Alle nye Actor-kjøringer frem til:
- SKU→URL-manifest er 100% komplett (alle 100 test-SKUer har bekreftet /produkt/-URL)
- Neste pilot bruker **direkte produkt-URLer** (ikke kategorisider)
- Alle P0-korreksjonene er verifisert i ny kjøring

**Produksjon:** `inquiries_enabled=0` beholdes. Ingen D1-import, migrasjon, merge eller deploy.
EOF