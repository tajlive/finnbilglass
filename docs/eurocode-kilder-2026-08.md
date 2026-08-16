# Eurocode-kilder — komplett kartlegging (2026-08-16)

Søk på tvers av språk (en/de/fr/it/pl/da/sv/no), forum, PDF-er og dokumentplattformer.
Kilde-etterretning for finnbilglass/Autoglass: hvor finnes eurocode-lister og -kataloger.
Fokus: **frontruter = prioritet 1** (egenskaper + kalibreringsflagg per kode).

## Vokabular per språk (søkeord)

| Språk | Begrep |
|---|---|
| Engelsk | Eurocode, ARGIC code, ECE R43 approval |
| Tysk | Eurocode, Scheibenstempel, E-Nummer, Glasliste |
| Fransk | eurocode, code verre, pare-brise |
| Italiensk | eurocodice, codice vetro, parabrezza |
| Polsk | Eurokod ARGIC, szyba, homologacja |
| Nordisk | eurokode / eurokod, «skannummer» (intern grossist-terminologi, ingen offentlig database funnet) |

## 1. ARGIC — eurocode-systemets eier (DEN HELLIGE GRAL)

- **argic.org** — Automotive Replacement Glass Identification Center, AISBL, Winterbeeklaan 10, 3600 Genk, Belgia.
- Grunnlagt **1993** av Saint-Gobain, Pilkington og Belron. Non-profit.
- Database: **93 560 referanser** (glass + tilbehør) per 2021-tall. Copyright-beskyttet.
- Tilgang: KUN medlemskap → intranett med full kode-database + teknisk info. Registrer konto på argic.org → «Register your account».
- Format: maks 15 tegn; fra **1. jan 2025: 17 tegn**, modifikasjonsfelt 2→3 tegn (eldre koder fortsatt gyldige).
- Kode-logikk («Matrix»): finnes som PDF på Scribd — «MATRIX-31072014» (EUROCODE® MATRIX, Edition 2014.7.31):
  https://www.scribd.com/document/754377389/MATRIX-31072014
- Viktig: **eurokode ≠ E-mark**. E-mark (43R-xxxxxx E<land>) er myndighets-godkjenning per glassprodukt (UNECE/KBA/RDW); eurokode er ARGIC sin handelskode per monteringsvariant.

## 2. Produsentkataloger (offisielle)

- **AGC**: agc-arg.com (B2B-portal m/ VIN-søk + 24/7 bestilling, krever konto); e-katalog: glass-catalogue-aaeu.com (glazing-konfigurasjoner + tekniske specs); agc-automotive.com.
- **Pilkington/NSG**: pilkingtonautomotiveglass.ie (søkbar katalog, 4 843 vindskjermer; `data-product-code` = eurokode på hver produktside; kategorier: windscreens/c-2.html, 12/side, 404 sider); pilkington.com classic-cars «All Makes and Models» (eurocode-kolonne, f.eks. HT0347 → 9119ABL; JS-lastet — scrape API-en); Pilkington Auto Glass Price List 2020 (Scribd 510701835 — NB: **indisk** prisliste, lav verdi for oss).
- **Saint-Gobain Sekurit**: sekurit-service.com — webshop m/ VIN-søk, **har egne kataloger for Norge (no), Danmark (dk), Sverige (se), Finland (fi)** (contentCatalog-parametere); «Classic Windscreen Assortment»-PDF: https://bkpublish-backend.blaetterkatalog.de/getcatalog.do?catalogVersionId=2568506&share (>300 klassiske frontruter m/ modell-årstabell).
- **Glavista / Guardian Automotive** (tysk): **glavista.com + guardianautomotiveglass.com** — beste scrapebare katalog:
  - Sitemap: https://www.glavista.com/sitemap-guardian-en-products.xml (6 785 URLer, **4 621 windscreen**; URL-ene peker til guardianautomotiveglass.com)
  - Struktur: `/en//windscreen/<merke>-windscreen/<eurokode>-<modell>` og `/en/windscreen/<eurokode>-<modell>` (guardian)
  - Produktkort (itemprop): `mpn`/`sku` = eurokode, `gtin13` = Glavista-nr, `description` = «Eurocode: X OE Number: … Glavista Number: Y», Tinting, Properties (VIN notch, Mirror boss…), Product group, cert (43R / 43R-DOT)
  - Produktside: + «Calibration required», «MOUNTING ACCESSORIES», varianter + similar products
- **Fuyao**: fuyaogroup.com/en; fygi.com (Europeisk ARG, anti-counterfeit-sporing per glass).
- **Xinyi**: global.sypglass.com (SYP-merket ettermarkedsportal); xygna.com (Nord-Amerika).

## 3. EU-nettbutikker med eurocode i produktdata (scrapebare)

- glavista.com / guardianautomotiveglass.com (se over) · autoglas.online (tysk; eurocode i produktnavn, f.eks. 8579AGSMVZ15) · shop.autoglasservice.com (tysk) · buycarparts.co.uk (Saint-Gobain-koder, f.eks. 70017011B3) · pilkingtonautomotiveglass.ie · ebay.de (masser av eurocode i titler — god data-mining-kilde) · bildelaronline24.se (Sverige, Frankberg) · classic-autoglas.de (klassiske biler, ARGIC-koder, WordPress /marken-modelle/).

## 4. Kommersielle VIN→eurocode-API-er

- **autoglassportal.com** — VIN/lisensplate → ARGIC-eurocode + OE-nummer; API + gratis start. Bygget av glassfolk.
- **vehicledatabases.com** — «Windshield by VIN» API (NAGS/OEM/calibration).
- **RightGlass** — betalt per vellykket identifikasjon.
- **Everything Auto Glass** (glassinc.net/vin-lookup).
- **Mitchell NAGS** — Mitchell Cloud Glass Parts LookUp (US-fokus, betalt).
- **TecDoc/TecAlliance** — tecalliance.net; VIN→del, 11,9M artikler / 254K+ kjøretøytyper / 636M+ linkage; lisensiert (koster). Alternativer diskutert i reddit.com/r/webdev (søk «tecdoc api»).

## 5. Myndighets-/standardkilder (ECE R43)

- UNECE: R043r2e.pdf (reguleringstekst) + «Registre Mondial» ECE-TRANS-180a6f.pdf (verdensregister over typegodkjenninger, incl. R43-glass) — unece.org.
- KBA (Tyskland) tildeler E1-godkjenninger; MPA NRW + TÜV Rheinland = tekniske tjenester (certipedia hos TÜV).
- Glass for Europe: glassforeurope.com/glass-safety-r43-and-gtr6 (bransjeoversikt).
- ECE R43 rev03 PDF: Scribd 739580218.

## 6. Forum & fellesskap

- **glassBYTEs.com / AGRR Magazine** — bransjemedier; gratis **DOT-nummer-database** (glassbytes.com/dot); teknisk blogg: beranek.agrrmag.com («European Codes», april 2013).
- **r/autoglass** (Reddit) — praktikere; tråder om lookup-verktøy/priser (f.eks. «Windshield lookup», «Pilkington vs Fuyao interchangeability»).
- **JDMjunkies.ch** — 240Z ARGIC-eurokode-liste (klassisk eksempel).
- **forum.etypeuk.com** — Pilkington Classic glass catalogue på Dropbox (lenke i tråd t=19371).
- **jagrullar.se / husbilsklubben.se** (svenske forum), **Sveriges Volvoforum**.

## 7. PDF-er og dokumenter (konkrete nedlastinger)

- ARGIC EUROCODE MATRIX 2014 — Scribd 754377389
- Pilkington MRP-prisliste 2020 — Scribd 510701835 (indisk)
- PMA Tools 2016 (tilbehør med eurocode-kolonne!) — http://epvs.ru/images/katalogi/PMA-TOOLS-2016.pdf
- Pilkington Classic Glass Catalogue — Dropbox via forum.etypeuk.com
- Sekurit Service Classic Windscreen Assortment — blaetterkatalog.de (catalogVersionId=2568506)
- DOT Number Database — glassbytes.com/dot

## 8. Datasett — eksisterer IKKE åpent

Ingen åpne eurocode-datasett på GitHub/HuggingFace/Kaggle (ARGIC-databasen er copyright-beskyttet; Kaggle/Roboflow har kun skadebilder; UCI glass = kjemisk analyse, ikke katalog).
Konsekvens: komplett data må bygges ved (a) ARGIC-medlemskap, (b) scraping av nettkataloger (Glavista/Guardian 4 621 + Pilkington IE 4 843 + autoglas.online/eBay), eller (c) lisens (TecDoc/autoglassportal/vehicledatabases).

## Anbefalt rekkefølge (frontruter først)

1. **Scrape Guardian Automotive** (glavista-sitemap, 4 621 windscreen) — gratis, komplett, egenskaper + kalibrering + OE + 43R per produkt.
2. **Scrape Pilkington IE** (windscreens/c-2.html, 4 843 produkter) — `data-product-code` = eurokode + egenskaps-beskrivelse.
3. **ARGIC-medlemskap** (Autoglass AS) — komplett database + Matrix + fremtidige koder før lansering.
4. **Scribd-dokumentene** (Matrix + Pilkington MRP 2020 + PMA) — kodeforståelse + deldata.
5. **Kommersiell API som fallback** for VIN→eurocode der egen data mangler.
