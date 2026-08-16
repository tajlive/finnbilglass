# FASE 0 — Kildematrise og lisens (GO/NO-GO)

> Dato: 2026-08-13 · For: KLA-301 Monster Catalog Harvester · Regel: «Alltid fakta» — deknings-tall er MÅLT kun der de er merket målt; resten er ANTATT og merket.

## 1. Leverandørmatrise

| # | Kilde | Type | Eurocode | OEM | kType | VIN | Features | Bilder | Oppdatering | API/feed | Lisensrisiko | Kostnad | Teknisk risiko | Produksjonsegnet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | Buycarparts (windscreen-katalog) | Scraping av nettbutikk | Delvis (kandidat-tekst) | Delvis | Nei | Nei | Ja (tekst) | Ja — MEN opphavsrett | Løpende (butikk) | Nei (uoffisiell) | **HØY** — bilder kan ikke republiseres kommersielt uten skriftlig rett | 0 (ulovlig bruk) | HØY — JS-render, WAF, blokkering | **NO-GO** |
| B | Buycarparts produkt (19113424) | Scraping produktside | Delvis | Delvis | Nei | Nei | Ja (tekst) | Ja — MEN opphavsrett | Løpende | Nei | **HØY** (samme) | 0 | HØY (samme) | **NO-GO** |
| C | TecAlliance TecDoc (Catalogue/Web Service/Data Package/VIS) | **Lisensiert datasett + API** | Ja (12,8M artikler, 724M linkages) | **Ja (OE)** | **Ja** | **Ja (VIN/VRM VIS)** | Ja | Via produsentavtale | Kontinuerlig (cloud 24/7) | **Ja — offisiell** | LAV-MED (kontraktsstyrt) | Årlig lisens (forhandles) | LAV-MED (integrasjon) | **GO (strategisk primærkilde — krever kjøp)** |
| D | Lokal B2B glass_catalog (Pilkington-dump) | Egen dump/eksport | **Ja — målt: 33 215 rader** | Via oe_eurocode_mapping — målt: 341 rader | Delvis — 833 ktype_registry; vin_ktype_map = 0 lokal (B2B-token, KLA-299) | Nei lokal (token) | **Ja — målt: rain_sensor/antenna/hud/camera/adas-flagg** | Nei | Ved ny eksport fra B2B | Eksport-skript | LAV — samme eierskap (Autoglass) | 0 (allerede i hus) | LAV | **GO — primærkilde NÅ** |
| E | ground_truth (B2B) | Fasit-seed | Ja — målt: 2 008 rader | Nei | Nei | Nei | Nei | Nei | Manuelt vedlikehold | Eksport | LAV | 0 | LAV | **GO (L1)** |
| F | autoglass_prisliste | Egen prisliste | Ja — målt: 29 628 linjer eksportert | Nei | Nei | Nei | Nei | Nei | Egen | Eksport | Ingen (eget data) | 0 | LAV | **GO — eneste priskilde** |

## 2. GO/NO-GO

| Kilde | Vurdering | Begrunnelse |
|---|---|---|
| **D+E+F (lokal B2B + prisliste)** | ✅ **GO — brukes i produksjon i dag** | Autoritative data i hus, målt dekningsgrad, samme eierskap (Autoglass→FinnBilGlass), null lisensrisiko |
| **C (TecDoc)** | ✅ **GO — men kjøp må godkjennes av Tom (kontrakt + kostnad)** | Eneste leverandør som dekker VIN→OEM→linkage lovlig med API. Lukker kType/VIN-gapet (KLA-299) uavhengig av B2B-token. Ingen scraping |
| **A/B (Buycarparts)** | ❌ **NO-GO for produksjon** | Scraping mot WAF/JS-butikk + opphavsrettsbilder. Kun OK som engangs research-referanse (harvesteren er bygget med robots-respekt og stopper ved blokkering — det er dokumentert) |

## 3. Lovlighetsregler (oppdragsgitt, låst)

- Bilder: **aldri** republiser offentlig tilgjengelige bilder. Unntak: skriftlig bruksrett (leverandørfeed fra Pilkington/Saint-Gobain/AGC/Xinyi/Fuyao via Autoglass sin avtale, eller TecDoc-medieavtale).
- Scraping: aldri produksjonsstrategi der API/datapakke/feed finnes. TecDoc finnes → TecDoc.
- AI-verifisering: AI eliminerer kandidater; AI bestemmer aldri korrekt frontrute alene.

## 4. Anbefalt kilde-arkitektur

```
Primær NÅ:      D (glass_catalog) + E (ground_truth) + F (prisliste)   → resolver L1-L3 + tier-pris
Strategisk:     C (TecDoc VIS: VIN/VRM → OEM → linkage)               → dekker gapet uten B2B-token
Media:          Kun godkjent leverandørfeed (skriftlig rett)          → 0 % bilder inntil avtale
Fasit-overstyring: vin_glass_overrides (migrasjon 0003)               → manuelt verifisert, L0
```

## 5. Neste kilde-anbefaling (konkret)

**Kjøp TecDoc Web Service + VIS (VIN/VRM)-modul.** Det er den eneste kilden som:
1. Gir VIN→kType→glass lovlig via API (lukker KLA-299-blokkeren uavhengig av B2B-token).
2. Gir OEM-frontrutenummer→Eurocode-kryssreferanser med versjon.
3. Har 724M kjøretøy-linkages — dekningen for norske biler (inkl. import) er markedsledende.

Kostnad: lisensiert (forhandles med TecAlliance Nordics). Blokkere: kontraktssignering (Toms beslutning) + integrasjonsarbeid. Frem til da: lokal B2B + fasit-tester er produksjonsgrunnlaget.
