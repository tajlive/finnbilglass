# SVV-mønster-analyse + overføring av W-kode-prinsippet til andre merker

Dato: 2026-08-16 · Datagrunnlag: 2 396 SVV-verifiserte finn.no-biler + Autoglass-prisliste (25 179 rader) + Wikipedia/leksika

## Del 1 — Gjentagende mønstre i SVV-modellnavn (målt mot staging-resolver)

| Klasse | n | PINPOINT | VERIFY | FALLBACK | Konsekvens |
|---|---|---|---|---|---|
| M1 merke-prefiks («TOYOTA TOYOTA RAV4») | 256 (10,7 %) | 1 | 4 | 1 | **Håndteres** av modelTokensAv (strip første token) — AUDI A4 → verify, OUTLANDER → pinpoint |
| M3 duplikat-token («MG MG 5», «E 350 E») | 7 | 1 | 3 | 2 | Delvis — «3.0SA - 3.0S» (BMW 1970) → fallback (ingen GT-data) |
| M4b kW/kWh-suffiks («ID.4 GTX 220 KW») | 76 | 0 | 6 | 0 | Ufarlig — stripbar støy |
| M5 komma-modell («AUDI A4, S4», «PICANTO, MORNING») | 17 | 0 | 6 | 0 | **Ufarlig** — tokens A4+S4 matcher begge → VERIFY |
| M6 tom modell («-», «---») | 14 | 0 | 1 | 5 | Riktig fallback (ingen modell-info) |
| M7 ren kode («116I», «5008», «XC60») | 300 | 0 | 4 | 2 | **Serie-mapping-hull** (se Del 2) |
| M8 VW ID-serie | 22 | 0 | 3 | 0 | Ufarlig |

**Rotårsak-funn (nytt):** `svvLookup` (src/svv.ts) sender modell-strengen RÅ videre — kun merke-alias (MERCEDES-BENZ→MERCEDES, VOLKSWAGEN→VW) gjøres. All normalisering ligger i matcher/resolver. M1 fungerer fordi `modelTokensAv` stripper første token hvis = merke — men «NISSAN X-TRAIL NISSANNENV» (merkenavn LIMT PÅ SLUTTEN) gir token-støy som aldri matcher.

## Del 2 — Overføring av W-kode-prinsippet (katalog-koder per merke)

Krysset som avgjør nytten: **har katalogen koden i varenavn, og har GT bevart den?**

| Merke | Katalog-koder i varenavn | GT bevarer? | SVV gir koden? | Status |
|---|---|---|---|---|
| **Mercedes** | W126/W140/W203… (899 rader) | ✅ | ✅ noen ganger («W140») | **Implementert** (serieKey W-regex) |
| **BMW** | E31/F20/G20… (521 rader) | ✅ | ❌ («116I», «520D») | **Implementert** (E/F/G-regex, bmwSerie) |
| **VW Golf** | GOLF I/II/IV/V/VII/VIII (195 rader) | ✅ | ❌ («GOLF» 102 biler) | **Kandidat**: år → generasjon |
| **VW Passat/Polo** | PASSAT (147), POLO (92) | ✅ | ❌ | Kandidat: år → generasjon |
| **Opel** | VECTRA A/B/C, CORSA B/C/D, KADETT D/E, ASTRA F/G/H/J/K, OMEGA B, ZAFIRA A/B | ✅ | ❌ («CORSA», «VECTRA») | Kandidat: år → bokstav |
| **MINI** | F54/F56/F60 (28 rader) | ✅ | ❌ («COOPER») | Kandidat: år → R/F-kode |
| **Nissan** | PRIMERA P10/P11, LAUREL C31/C32, 240ZX S13 | ✅ | ❌ («PRIMERA» 1) | Lav trafikk |
| **Toyota** | SUPRA MK3/MK4, CARINA T-serier, LANDCRUISER J250 | ✅ | ✅ 1 stk («SUPRA MK IV») | Lav trafikk |
| **Audi** | Ingen Typ-koder i katalogen («AUDI A4 95-00») | — | ❌ («A4») | **Fungerer allerede** via modell+år |

## Del 3 — Konklusjon og anbefaling

1. **VW Golf/Passat/Polo er den store fisken**: 174 SVV-biler (GOLF 102, PASSAT 41, POLO 31) hvor år → generasjons-mapping løfter VERIFY → PINPOINT. Wikipedia-fasit: Golf I 1974-83 (Typ 17), II 1983-91 (Typ 19E/1G), III 1991-97 (Typ 1H), IV 1997-03 (Typ 1J), V 2003-08 (Typ 1K), VI 2008-12 (Typ 5K), VII 2012-19 (Typ 5G), VIII 2019- (CD1).
2. **Opel** (VECTRA A 1988-95, B 1995-02, C 2002-08; CORSA A 1982-93, B 1993-00, C 2000-06, D 2006-14; ASTRA F 1991-98, G 1998-04, H 2004-10, J 2010-15, K 2015-21, L 2021-) — samme mekanisme, lavere trafikk.
3. **MINI** (R50 2001-06, R56 2007-13, F56 2014-24; Clubman R55/F54; Countryman R60/F60) — lav trafikk men enkel mapping.
4. **M7-hullet (116I → fallback)**: GT-raden heter «1 HBK» (uten kode) — serieKey F20 matcher ikke «1 HBK» fordi normaliserKatalogModell finner ingen F-kode i modellnavnet. Men GT HAR «F20»-rader (2012-2020, 3113GN) — gapet er at «1 HBK» og «F20» er to separate GT-rader som ikke kobles. Fiks: GT-generator må skrive F20-koden inn i «1 HBK»-rader (katalogen har «BMW 1-SERIE 5D HBK E87 04-» — koden finnes i varenavnet, men parseVarenavn stripper den).

**Anbefaling (rekkefølge):**
1. **VW generasjonstabell** (GOLF/POLO/PASSAT/TOURAN/TIGUAN) i serie-mapping — størst volumøkning av PINPOINT
2. **GT-generator-fiks**: bevar E/F/G/W-koder i modellnavn (løser 116I-klassen + styrker BMW/benz generelt)
3. Opel + MINI-tabeller (samme mekanisme, lavere prioritet)
4. SVV-modell-normalisering (strip merke-suffiks «NISSANNENV», kW/kWh, drivlinje-ord) — kosmetisk, ufarlig, reduserer støy
