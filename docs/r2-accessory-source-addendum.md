# R2 — ACCESSORY SOURCE ADDENDUM (proveniens-undersøkelse, read-only)

**Dato:** 2026-08-18 · **Utført av:** Hermes (Implementation Agent) · **Branch:** `arch/conversational-assistant-staging-v1`
**Status:** Undersøkelse ferdig. Ingen produksjons-endring, ingen stor-skala scraping. Del av R2.

---

## 1. KILDEIDENTIFIKASJON — hvor kommer varekort-relasjonene fra?

**Konklusjon: relasjonene er lagret i WooCommerce-DB-en (auto-glass.no) og servert via tilpasset produktkort-template; de er IKKE tilgjengelige via noe offentlig API. Eksisterende fangst i repoet skjedde via autentisert DOM-scraping (Playwright, ALFA GLASS AS min-konto).**

| Spørsmål | Funn |
|---|---|
| Plattform | **WooCommerce/WordPress** (robots.txt: `/wp-admin/`, `admin-ajax.php`; `/wp-json/wp/v2/types` → post-type `product` «Produkter») |
| Strukturert API? | WP REST `/wp-json/wp/v2/product` er ÅPENT og har `acf`- og `meta`-felt — men innholdet er **tomt anonymt** (relasjonene krever autentisering). WooCommerce Store API (`/wp-json/wc/store/v1/products`) = 404; `wc/v3` krever API-nøkler. |
| Offentlig produkt-side | Viser kun kode-legend (K=klips, PY=list osv.) — **ingen per-produkt relasjoner** uten login. |
| Eksisterende fangst i repoet | `data/accessory-map.json` (49 produkter, 87 relasjoner), `data/glass-accessories.json` (eurokode→tilbehør), `data/autoglass-scrape/` (logg + `sku-eurocode-mapping.json`, 9610 mappinger) — Playwright-scrape juni 2026, commit `70b75039`. |
| Kildetype-klassifisering | **Autentisert DOM-scraping av produktkort** (ikke API, ikke DB-dump, ikke statisk app-data). Sannsynlig underliggende struktur: ACF-relasjonsfelt i WooCommerce-produkt-DB. |

## 2. REPRESENTATIVE CAPTURES (fra eksisterende fangede data, ingen ny scraping)

| Glass (SKU/eurokode) | Tilbehør-SKU | Kategori (R2-klasse) | Beskrivelse (vist) | Relasjonskilde | required (fanget) |
|---|---|---|---|---|---|
| 3355 (BMW X1 frontrute) | `3355PYKIT` | MOULDING_TRIM | PYNTELIST KIT V+H FRONTRUTE (2 140 kr) | produktkort (accessory-map) | false |
| 2488 (BMW X4 G02) | `2488ASGRT` | MOULDING_TRIM | PYNTELIST TOPP FRONTRUTE (455 kr) | produktkort | false |
| 2492 (BMW X5 G05) | `2492ASGRT` | MOULDING_TRIM | PYNTELIST TOPP (490 kr) | produktkort | false |
| 1526BZ | `1526PY` | MOULDING_TRIM | list (samme familieserie) | glass-accessories | — |
| 1831GB | `1831PY` | MOULDING_TRIM | list | glass-accessories | — |
| 2304 (BMW i7) | `2304ACDCMUVZ2L` m.fl. | OTHER (relatert glass — se advarsel) | BMW i7 WS SENSOR LDW HUD COATED GN (0 kr) | produktkort | false |

**Typer i hele datasettet:** lim (47), pyntelist (28), bunnlist (4), gummilist (4), klips (2), sensortape (2). `required=true`: 8 av 87.

## 3. KATEGORIKLASSIFISERING (minimumskrav)

| R2-klasse | Mapping fra fangede typer |
|---|---|
| MOULDING_TRIM | pyntelist, bunnlist, gummilist, PYKIT |
| CLIP | klips |
| WIPER | ingen fanget (0 relasjoner i alle datasett) |
| OTHER | lim (adhesive/INSTALLATION_CONSUMABLE), sensortape (sensor_gel), relatert glass |

## 4. SEMANTIKK-ADVARSEL (viktig)

1. **`required`-flagget er scrape-avledet, ikke verifisert kilde-semantikk** — 8/87 er true, men vi vet ikke om WooCommerce-relasjonstypen faktisk betyr «kreves». Per addendum: **default COMPATIBLE** inntil kilde-semantikk eller VERIFIED ekspertkunnskap beviser REQUIRED.
2. **`type`-feltet er upålitelig for noen produkter:** produkt 2304 (BMW i7) har type=`lim` på poster som i virkeligheten er andre GLASS-produkter (dørglass/bakglass) — sannsynligvis fanget en «relaterte produkter»-seksjon og klassifisert den feil. Verifiser mot kilden før bruk.
3. **glass-accessories.json** er eurokode-nøkklet men har selv-relasjoner (1526PY→1526PY) og familie-interne glass-relasjoner (1896GG→1896GN) — ikke alle er lister/klips. Rensing kreves.

## 5. VISKERE (wiper) — status

- **0 fangede visker-relasjoner** i accessory-map.json, glass-accessories.json eller produktsidene (offentlig HTML har kun «viskere» i sensor-legend-tekst).
- Tom bekrefter at varekortet (innlogget) viser viskere — dvs. kilden HAR dem, men fangsten fanget dem ikke (seksjonen kan være egen/ny).
- **Implementering i R2:** `salesPolicy = DISABLED`-guard på WIPER-kategorien — selv om/når visker-relasjoner importeres, returneres de ALDRI fra FinnBilGlass-verktøy, DeepSeek, tilbud eller checkout inntil Tom eksplisitt endrer policy. (Guard implementeres i accessory-v1-katalogen; se R1-kode.)

## 6. ANBEFALT NESTE STEG (R2)

1. **Verifiser autentisert REST-tilgang:** prøv min-konto-autentisering mot `/wp-json/wp/v2/product/{id}` med ACF-felt (cookies fra min-konto-login) — hvis ACF-relasjonene returneres strukturert, foretrekk dette framfor DOM.
2. Hvis REST forblir tom: **kontrollert autentisert fangst** av produktkort for ~20 representative glass (T5, CLA + høyvolum) med korrekt seksjonsklassifisering (tilbehør vs relaterte produkter).
3. **Rens eksisterende datasett** (fjern selv-relasjoner, relatert-glass, feil type) → seed accessory-v1-katalogen med MOULDING_TRIM/CLIP-kategorier, alle COMPATIBLE default.
4. **Wiper-guard** på plass før eventuell wiper-import.

## 7. KOMMERSIELL SLUTTFLYT (bekreftet)

Finn eksakt rute → slå opp varekort-relasjoner → legg til kun relevante lister/klips → fjern det som allerede følger med ruta (INCLUDED_WITH_GLASS, EMB) → skjul vindusviskere → presentér ferdig korrekt ordre. Eksakt rutesøk forblir P0; tilbehør blir korrekt nesten automatisk når ruta er identifisert.

**Ingen produksjons-endring utført. Read-only. STOPP.**
