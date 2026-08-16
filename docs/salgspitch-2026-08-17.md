# Finnbilglass.no — Salgspitch

> **Dato:** 2026-08-17 · **Status:** Live i produksjon (www.finnbilglass.no, HTTP 200)
> **Ett-linje:** Norges bilglass-nettbutikk for dem som betaler selv — finn riktig glass på 2 steg, til 40 % lavere pris enn listepris.

---

## 1. Elevator pitch

Finnbilglass.no er en landsdekkende nettbutikk for bilglass til **privatpersoner som ikke har forsikringsdekning for glasskade** — steinsprut, sprukken frontrute, knust siderute. Kunden tar **foto av kjennemerket** (eller skriver regnr), får bilen identifisert automatisk mot Statens vegvesen, får presentert **riktig glass med fast, lav pris** og bestiller glass + monteringspakke i én flyt. Glasset leveres over hele Norge, montering via avtaleverksteder til fastpris.

Posisjon: **prisutfordrer**. De store bilglassaktørene er bundet av avtaler med forsikringsselskapene og kan ikke gi selvbetalende kunder rabatt uten å bryte dem. Finnbilglass er ikke bundet av slike avtaler — derfor kan vi gi «ekte pris» til dem som betaler selv.

---

## 2. Problemet

| Faktum | Konsekvens |
|---|---|
| ~15 % av norske biler kjører uten kasko/glassdekning | Glasskade = full pris av egen lomme |
| Store aktører gir forsikringsselskapene store rabatter | Selvbetalende kunder kryss-subsidierer forsikringsmarkedet |
| Ingen pristransparens på bilglass i Norge | Kunden kan ikke sammenligne — må ringe og få «pris på forespørsel» |
| Riktig glass er vanskelig å finne (eurokode, modell, år, utstyr) | Kunden kan ikke selv verifisere at hun får riktig vare |

**Markedshullet:** et helt kundesegment (selvbetalende) som betaler overpris, uten et nettsted som gjør det enkelt å finne og kjøpe riktig glass.

---

## 3. Løsningen — hvordan det virker

**Maks 2 steg fra kjennemerke til bestilling:**

1. **Foto av kjennemerket** (hovedhandling) — AI leser skiltet, slår opp i Statens vegvesen, og henter bil: merke, modell, år, VIN, farge, importstatus og førstegangsregistrert dato. Skriving av regnr er sekundært; VIN kun som backup hvis SVV-oppslag feiler.
2. **«Vi fant bilen din»** → riktig glass presentert med pris + tilbehør (monteringspakke med rutelim, primer, klips, pyntelist, sensorgel). Bestill i én flyt.

**Treffsikkerhet i tre nivåer:**
- **PINPOINT** — eksakt glass identifisert (ingen spørsmål, direkte resultat)
- **VERIFY** — kunden får kun spørsmål om skillende varianter (utstyr, årstall)
- **FALLBACK** — manuelt søk

**Verifisering:** kunden kan bekrefte glasset med **ECE R43-koden** som står i hjørnet av ethvert glass — alle glasstyper (frontrute, siderute, bakrute, dørrute). Tar man bilde av koden, leser AI den automatisk.

---

## 4. Alt som er bygget

### 4.1 Plattform & infrastruktur (2026-08-13 →)
- Cloudflare-stack: **Pages** (frontend) + **Worker** (API) + **D1** (database) + domene på finnbilglass.no (Cloudflare-zone, e-post aktiv: support@finnbilglass.no)
- 9 D1-migrasjoner: resolver-tabeller, glass-master, feature-flags, image-resolver, B2B-sync, TecDoc-snapshot, ece_r43
- Canonical **glass master** med systemnøytralt snapshot (gzip + manifest med fingerprint) og automatisk B2B→FinnBilglass-synk
- Kill-switch + feature-flags for trygg drift

### 4.2 Identifikasjon (API-endepunkter i prod)
- `/api/regnr` — Statens vegvesen-enkeltoppslag: merke, modell, år, VIN, farge, import
- `/api/les-skilt` — **foto av kjennemerket**: Workers AI leser skilt → regex-validering (konfidens 0,9) → SVV → hele bilen. Testet med ekte skiltbilde. Erstattet manuell bilinnfylling
- `/api/vin` — VIN-oppslag som backup
- `/api/frontrute` — direkte frontrute-søk
- `/api/image-resolver` — AI-bildeavlesning av glass
- `/api/verify-glass` — ECE R43-kodeverifisering (43R-merket i glasshjørnet)

### 4.3 Matching-motoren (resolver)
- **Eurokode-dekoder** — autoritativ parsing av A/M/C/H-koder inkl. coated-attributt
- **Serie-mapping** — Mercedes W / BMW E-F-G / VW / Opel / MINI / Nissan / Toyota, begge-veier (eks.: SU18018 → 2525GYA, VW T5)
- **GT-generator** — 148 159 GT-rader generert fra prislisten (serie-tall, karosseri-alias, årvinduer, 2–3-sifrede veteran-koder)
- **VIN-pos-10 → faktisk modellår** — ultimate matching
- **Evidence-fusion** — kombinerer OCR, katalog og kundedata med vekting (ocr_r43 = 0,95)
- **Fasit-SSoT** — data/fasit-glass.json med integritetsvakt (testet ved hver endring)
- **Kvalitetsgater:** 0 harde falske PINPOINT (Gate A grønn), test-500-GT, søke-nøyaktighets-harness med 121 reelle norske fixtures + hard-negative mining

### 4.4 Datagrunnlag
- 29 627 katalograder i D1 (utgangspunkt), løpende utvidet via canonical glass master
- Eurocode-kataloger scrapet: Glavista/Guardian 4 621 + Pilkington 4 843 frontruter (resumable scraper)
- Tilbehørskart (accessory map), monteringspakker (Sika rutelim + primer + Q-tips)
- TecDoc-snapshot-import (0008), ktype-crosswalk + vin_ktype_map fast path

### 4.5 Pris & montering
- **Prisregel:** listepris × 0,60 (40 % rabatt), rundet NED til tier: **3 990 / 5 490 / 6 990 / 8 490 kr** (over = spesialpris)
- Tilbehør: 20 % rabatt
- Kunden ser KUN sluttpris — aldri rabatt/utregning
- Levering over hele Norge; montering via avtaleverksteder til fastpris (inkl. lim og garanti)

### 4.6 UX/design (mobil-først)
- «Den mest mobilvennlige siden i bilglass-Norge» — 80 % av brukerne er på mobil
- Verifisert på iPhone 13: 0 horisontal scroll på alle sider, tap-targets ≥ 52 px, service worker for rask gjentatt besøk
- Automotive Pro-design: amber-palett, Inter Tight, OG-tags, fremdrifts-prikker, ARIA
- Bilglass-spesifikke SVG-ikoner (skilt med norsk flaggfelt, frontrute, limtube, verktøy, lastebil) — ingen generiske ikoner
- WCAG AA-kontrast på priskort og footer
- Sider: Forside, «Bilglass uten forsikring», Om oss, Personvern, Kontakt, pen 404

### 4.7 SEO/GEO (AI-søk-optimalisering)
- sitemap.xml + robots.txt åpen for AI-crawlere (GPTBot, ChatGPT-User, PerplexityBot, Google-Extended, anthropic-ai)
- FAQPage-schema på «Bilglass uten forsikring» (Q&A-format med priser)
- JSON-LD: OnlineStore/Product-schema (nettbutikk, ikke lokalbedrift)
- GEO-handlingsplan: Google Business Profile, Apple Maps, Gule Sider/1881 (NAP-konsistens), anmeldelser med nøkkelord, målbart via Arch ai-visibility
- GDPR/personvern-side

### 4.8 Copy & posisjonering
- Prisutfordrer-vinkling — nøytral, uten konkurrentnavn, uten udokumenterte påstander («Alltid fakta»)
- Finnbilglass står alene som merkevare — leverandør-/grossist-tilknytning er skjult i alle kundevendte kanaler
- «Leveres over hele Norge»

### 4.9 Kvalitet & drift
- Tester: les-skilt, resolver, search-accuracy, e2e-verifisering mot prod
- Rollback-drill, staging-verifisering, kill-switch
- 48 commits i B2C-repoet (finnbilglass) + 446 i B2B-repoet (Autoglass) — ~500 commits totalt på plattformen

### 4.10 B2B-synergi (samme plattform)
- AI-ordremottaker med live varekort- og prisoppslag, tilbehørsdialog (lim, klips, pyntelist, sensorgel S1/S2/S3/S1C), handoff-regler
- B2B-portal med ECE R43-verifisering i prod (43R-004592 → PINPOINT med varenavn og pris, verifisert end-to-end)
- VIN-søk-agent, katalog på 27 184 produkter, TecDoc-integrasjon
- Katalog- og prissynk mellom B2B og B2C er automatisert (samme master)

---

## 5. Forretningsmodell

| Element | Modell |
|---|---|
| Kunde | Privatperson uten glassdekning (selvbetalende) |
| Inntekt | Marginal per glass (grossistpris → tier-pris), tilbehør +20 % |
| Montering | Avtaleverksteder til fastpris (inkl. lim og garanti) |
| Distribusjon | Direktelevering eller til verksted, over hele Norge |
| Merkevare | Finnbilglass står alene — ingen leverandør-merking mot kunde |

## 6. Konkurransefortrinn

1. **Pris** — 40 % under listepris, faste nivåer, ingen pruting: «ekte pris»
2. **Enkelhet** — 2 steg fra skilt-foto til bestilling; ingen manuell leting
3. **Treffsikkerhet** — AI-matching med fasit-verifisering og 0 kjente falske treff
4. **Verifiserbarhet** — 43R-koden på glasset bekrefter at kunden får riktig vare
5. **Teknologi** — hele plattformen (B2C + B2B + AI-ordremottaker) bygget og i prod
6. **Skalerbarhet** — landsdekkende uten fysisk butikk, prissynk automatisert

## 7. Veien videre

- Flerglass-kurv (flere glass i én ordre) — neste steg
- Bak-/sideruter i full bredde
- GEO-utrulling: lokale oppføringer, anmeldelser, AI-synlighetsmåling
- Betalingsflyt og ordrehåndtering ende-til-ende
- AI-ordremottaker på B2C-siden

---

*Alle tall i denne pitchen er verifiserbare fra repo og prod (curl/git). Simulerte tall er merket som simulert. Ingen oppdiktede kundetall eller statistikker.*
