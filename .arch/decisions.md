# Arch beslutninger — finnbilglass
## D-20260813-03 — forretningsmodell + arkitekturvalg låst
**Beslutning (Tom 2026-08-13):**
- **Leverandør:** Autoglass AS til grossistpris; drop-ship fra lager Oslo + Stockholm.
- **Levering:** direkte til kunde (DIY side/bakrute) eller avtale-verksted (frontrute).
- **Montør:** 2 testverksteder — Oslo (ved Autoglass-lageret) + Trondheim. Fastpris 2 000 + mva for skifte (inkl. lim + garanti).
- **Ordre-kanal til Autoglass:** 1B (gjenbruk eksisterende B2B-flyt) — byttes til API når Uni Micro tilbyr det.
- **Prisvisning:** transparente linjer — glass + tilbehør + frakt.
- **Betaling:** i nettbutikken — Vipps / Klarna / kort.
- **Fraktrisiko:** transportrisiko eies av Autoglass AS frem til levering (avklares i avtalen med Eduard).
**Hvorfor:** konkurrentene (Carglass/Riis) er bundet av forsikrings-rammeavtaler og kan ikke underby prisene uten avtalebrudd. Finnbilglass er forsikringsuavhengig.

## D-20260813-04 — glass-katalog i D1 + frontrute-matcher (POC verifisert)
**Utført (Hermes, 2026-08-13):**
- Autoglass-prislisten importert til `finnbilglass-db`: **29 627 rader** (glass 25 179, tilbehør 2 961, alias 1 420, frakt 59, emballasje 8). Alle 25 179 glassrader har eurokode.
- **Frontrute-deteksjon:** varenavn er IKKE pålitelig (Autoglass-navn er inkonsistente — `2525GYA` har verken «T5» eller «FRONTRUTE» i navnet). Fasit: eurokode-posisjon (`[0-9]+A...` = frontrute, GLOB-mønster). 751 frontrute-varianter detektert.
- **Eurokode-dekoder** (scripts/eurokode-dekoder.mjs): posisjon (A=front/B=bak/L-R=dør), fargetone (GY/GN/BL/BZ/CL), egenskaper (C=coated, S=sensor, A=antenne, M=sensorgel, H=oppvarmet, EL=elektrisk).
- **Frontrute-matcher** (scripts/frontrute-matcher.mjs): bil-profil → D1-kandidater (primær+sekundær nøkkelord) → dekoder-score → riktig vare. **SU18018-fasit bekreftet: VW T5 2003 (sensor+antenne, ikke coated, ikke sensorgel) → 2525GYA 9 980 kr.** Coated/sensorgel/antenne-løse varianter forkastes korrekt.
- **Bilde-konklusjon (testet):** eurocode finnes IKKE i offentlige søk (Google/Bing/eBay gir null relevante treff — Bing viser til og med dinosaurer for T5-frontrutekoder). Bilder til matching er unødvendig — utstyrsprofilen kommer fra bilen (VIN/PR-koder/kunde) og variantene skilles av eurokoden. Bilder er kun til kundevisning (generiske hjelpebilder + ev. lagerfoto fra Eduard).
- **Åpent:** SVV_API_KEY for finnbilglass (kjennemerke → bil), worker-endepunkt, bildevisning, Domeneshop NS-peking.


