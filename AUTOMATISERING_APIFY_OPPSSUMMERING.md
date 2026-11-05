# AUTOMATISERING AV APIFY SCRAPING - OPPPSSUMMERING

## Hva som er implementert (ferdig)

### 1. Actor-kode (finnbilglass-price-import) - Build 1.0.16

| Fil | Endring |
|-----|---------|
| `src/main.js` | **Hard limit enforcement**: `checkLimits()` kjøres 4 ganger per iterasjon (før side, etter side, etter hvert produkt, ved slutt). Garanterer at `maxProducts` og `maxPages` **aldri** overskrides. |
| `src/main.js` | **Typekode-only mode**: Nytt input-felt `typekodeOnly`. Når `true`: stripper alle pris/lager-felter fra output, `extractFromPage` returnerer `TYPEKODE_ONLY_MODE` for pris/lager. |
| `src/extract.js` | Accepterer `typekodeOnly` parameter. Returnerer `null` for pris, `UNKNOWN` for lager når modus er aktiv. |
| `.actor/input_schema.json` | Lagt til `typekodeOnly` felt med beskrivelse og default `false`. |

### 2. Automatiserte tester

| Fil | Dekker |
|-----|--------|
| `tests/hard-limits.test.mjs` | ✅ `checkLimits()` maxPages enforcement<br>✅ `checkLimits()` maxProducts enforcement<br>✅ Crawl loop stopper ved hard limits<br>✅ Typekode-only stripper pris/lager felter<br>✅ Typekode-only bevarer `typeCodeRaw` |

### 3. Automatiseringsskript

| Fil | Funksjon |
|-----|----------|
| `scripts/apify-automation.mjs` | **Full CLI-automatisering**:<br>- Starter Actor runs via REST API<br>- Poller status til completet<br>- Henter dataset resultat<br>- Validerer hard limits + Typekode-only<br>- Estimerer kostnad (CU → USD)<br>- Genererer GO/NO-GO rapport<br>- Cost ceiling enforcement ($0.50) |

**Bruk:**
```bash
# Start ny pilot (venter på ferdig, validerer, rapporterer)
node scripts/apify-automation.mjs --input-file=apify-typekode-only-input.json --wait

# Hent resultater fra eksisterende run
node scripts/apify-automation.mjs --run-id=3BH4i16MJdDAvT19a --fetch-results
```

### 4. Input-konfigurasjoner

| Fil | Beskrivelse |
|-----|-------------|
| `apify-typekode-only-input.json` | **Klar for neste pilot**: 5 kategorisider, `maxProducts=10`, `maxPages=20`, `typekodeOnly=true`, `saveState=false`, `allowReconciliation=false` |
| `apify-final-input.json` | Full discovery (92 kategorisider) - **IKKE BRUK FØR PILOT ER GRØNN** |

### 5. Rapporter og manifester

| Fil | Innhold |
|-----|---------|
| `RAPPORT_FASE4.1_KORRIGERT.md` | **Korrigert Fase 4-rapport** med root cause analyse av maxProducts/maxPages avviket, dokumenterte P0-korreksjoner, testbevis, SKU→URL join analyse (9/100 match), 91 manglende SKU-er listet, Mazda 29730YP status, forslag til neste pilot |
| `SKU_URL_MANIFEST_TESTUTVALG.md` | **Komplett SKU→Produkt-URL manifest**: 9 bekreftede matches, 91 manglende med historiske kategori-URLer, 83 ekstra i Apify, Mazda 29730YP spesiell behandling, anbefaling for neste pilot |

---

## ROOT CAUSE AV FORRIGE KJØRINGS-AVVIK

**Problem:** Apify Console gjør **shallow merge** av UI-input med default input fra `.actor/input_schema.json`.

**Hva som skjedde:**
- Default input hadde `maxProducts=92`, `maxPages=92`
- Bruker satt `maxProducts=10`, `maxPages=20` i UI
- **Resultat:** Actor fikk `maxProducts=92`, `maxPages=92` (defaults beholdes!)

**Løsning implementert:**
1. **Hard limits i kode** - uavhengig av input-merging
2. **Typekode-only mode** - hindrer pris/lager innsamling
3. **Validering i automatiseringsskript** - sjekker at resultater respekterer grenser
4. **Neste pilot bruker direkte /produkt/-URLer** - unngår kategori-crawling usikkerhet

---

## STATUS FOR NESTE PILOT

| Kriterie | Status |
|----------|--------|
| Hard limits testet og bevisst | ✅ `tests/hard-limits.test.mjs` alle grønne |
| Typekode-only mode implementert | ✅ Kode + tester |
| Actor build deployet | ✅ Build 1.0.16 live |
| Automatiseringsskript klart | ✅ `scripts/apify-automation.mjs` |
| SKU→URL manifest for 100 test-SKUer | ✅ `SKU_URL_MANIFEST_TESTUTVALG.md` |
| **91 manglende /produkt/-URLer kartlagt** | ⏳ **MÅ GJØRES FØR NESTE PILOT** |
| Mazda 29730YP kandidat-URL identifisert | ✅ I manifest |
| Cost ceiling enforcement | ✅ $0.50 i automatiseringsskript |

---

## ANBEFALT NESTE STEG

1. **Fullfør SKU→URL mapping** for de 91 manglende SKU-ene (bruk historisk CSV + manuell oppslag på auto-glass.no)
2. **Oppdater `apify-typekode-only-input.json`** med 100 direkte `/produkt/`-URLer
3. **Kjør neste pilot** med automatiseringsskriptet:
   ```bash
   node scripts/apify-automation.mjs --input-file=apify-typekode-only-input.json --wait
   ```
4. **Verifiser resultatet**: Mazda 29730YP funnet, TypeCodeRaw = DFFV?, typeCodeConflict håndtert korrekt
5. **Bare ved GRØNN pilot**: Overveie full discovery (92 kategorisider)

---

## SIKKERHET (HOLD-reler)

- ✅ `saveState=false` tvinges i probe-mode (ingen D1-skriving)
- ✅ `allowReconciliation=false` (ingen avstemming)
- ✅ `typekodeOnly=true` (ingen pris/lager innsamling)
- ✅ Credentials **ALDRI** i filer - kun kryptert i Apify Console
- ✅ `inquiries_enabled=0` beholdes i produksjon
- ✅ Ingen D1-import, migrasjon, merge, deploy uten eksplisitt GO
EOF