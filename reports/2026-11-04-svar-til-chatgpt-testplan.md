# Svar til ChatGPT — gjennomføring av testplanen for FinnBilGlass

**Dato:** 2026-11-04 (CET)
**Kodeversjon rapportert mot:** `6c6fd16` — branch `copy/kvittering-20261103` (Node 24.18.0, wrangler 4.122.0)
**Prod-versjon:** ikke sporbar i Git (PR #27 head = `3b45715`, fire commits bak branchen). Prod-observasjonene under gjelder det som faktisk kjører, ikke `6c6fd16`.
**Datasettversjon:** testgrunnlag v0 (definert i §2), fixturedump `data/fixtures/manifest.json` = `2026-11-03T23:33:54Z`
**Utført av:** Hermes — etter Toms instruks om å svare deg komplett etter utførelse

---

## 0. Bunnlinje

1. **Fase 1, 2, 3 og 4A er gjennomført og målt.** Fase 4B (masseoppslag), 4C (50–100 biler i nettleser mot staging), 4D (e-post/OTP) og 4E (prod-test) er **ikke** kjørt: planens egen stopp-regel gjelder (tillatt oppslagsvolum ikke avklart), og vi fant en P0 som gjør lansering umulig uansett.
2. **P0: produksjon er åpen for kundehenvendelser akkurat nå.** `feature_flags.inquiries_enabled = 1`, `GET /api/pilot-status` svarer `{"inquiries_enabled":true,"pilot":"apen"}`, og prod-D1 har 9 reelle kundehenvendelser, den siste `2026-11-03T23:18:22Z`. Det bryter HOLD-statusen og release-gaten. Det finnes **ingen** invitasjonsport i denne koden (`src/invitation.ts` finnes ikke, ingen invitasjonstabell i prod-D1), så hvem som helst kan sende inn.
3. **Fasitgrunnlaget er tynnere enn det ser ut.** Det finnes **2** reelle fasiter (SU18018, AJ95429), og **begge er uten uavhengig, maskinsporbar evidens** (`fitment-golden.json`: `verificationState: PROVISIONAL` / `AMBIGUOUS`, `independentEvidenceAvailable: false`). `data/fasit-live.json` sine 118 oppføringer er gt-prisliste-avledet «current baseline», ikke fasit — det står eksplisitt i `fitment-golden.json → _kjernerelger`.
4. **Lokal kvalitet er grønn:** typecheck PASS, `npm run test` **519/519 PASS, 0 fail, 0 skipped**. Glassplassering er dekket av 105 tester i 6 suiter + en ende-til-ende Chrome-test over alle 6 plasseringer (§5.2).
5. **Glassplassering: logikken er grønn, men prod-datagrunnlaget er ikke der.** `glass_typekode` (20 601 rader) finnes bare i staging — migrasjon 0047 er ikke kjørt i prod, og prod-prislisten har ingen `typekode`-kolonne. Målt konsekvens i prod: **90,9 % av dørrutene mangler fremre/bakre, 100 % av ventilrutene mangler foran/bakre, 35,6 % av glassradene er bare «sidefamilie», 7,2 % har ukjent plassering** (§5.2).
6. **Anbefaling: IKKE KLAR for lansering.** Årsakene er ikke kodefeil i valgtreet, men (a) prod står åpen, (b) fasitgrunnlaget beviser ikke EXACT for noen bil, (c) plasseringsdataene er ikke i prod, (d) masseoppslag/nettlesertest/e-postflyt er uutført.

---

## 1. Utførelseslogg (hva som faktisk ble kjørt)

| # | Kommando / handling | Resultat | Retning |
|---|---|---|---|
| 1 | `git rev-parse HEAD`, `git status` | `6c6fd16`, 1 endret fil (min testfiks, se §8), 3 untracked | lokalt |
| 2 | Filinventar av alle kjennemerke-/fasitkilder (§2) | 12 filer, **117 unike kjennemerker**, 0 duplikater, 0 ugyldige formater | lokalt |
| 3 | PII-skann av testgrunnlaget | 0 e-postadresser, 0 telefonnumre | lokalt |
| 4 | `npm run typecheck` | PASS | lokalt |
| 5 | `node scripts/dump-d1-fixtures.mjs` | ground_truth **32 307** rader, glass_prisliste **29 627** rader (SELECT-only mot prod-D1) | lesing |
| 6 | `npm run test` (49 suiter) | **519 tester, 519 pass, 0 fail, 0 skipped** | lokalt |
| 7 | `npm run test:vin-gt` | 17/17 — inkl. GT-roundtrip: **alle 32 307 GT-rader er søkbare** (588 ms) | lokalt |
| 8 | `npm run test:quote-browser` (Playwright/Chrome) | PASS — 6 glassplasseringer til ekte inquiry-handler, syntetisk kontakt, ingen e-post | lokalt |
| 9 | `node scripts/test-fasit.mjs` (staging) | **2 av 2 fasitkrav brutt** — se §4.1 og §4.2 | 2 oppslag |
| 10 | `GET /health` + `GET /api/pilot-status` (prod + staging) | begge 200, katalogRader 29 627, `inquiries_enabled: true` **begge steder** | lesing |
| 11 | `SELECT flag, enabled FROM feature_flags` (prod-D1) | `inquiries_enabled = 1`, `resolver_all = 1`, `resolver_pinpoint = 1`, l1/l2/l3 = 1 | lesing |
| 12 | `SELECT COUNT(*), MIN/MAX(created_at) FROM beta_inquiries` (prod-D1) | 9 saker, 2026-08-20 → 2026-11-03T23:18:22Z | lesing |
| 13 | `npx wrangler secret list` (prod) | `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_NOTIFY_EMAIL`, `SUPPORT_EVIDENCE_TOKEN`, `SVV_API_KEY`, `GOOGLE_OAUTH_*` alle satt | lesing |

**Ikke kjørt, med begrunnelse:**

| Fase | Hvorfor ikke |
|---|---|
| 4B masseoppslag (110/500 biler) | Tillatt oppslagsvolum og kostnad mot SVV er ikke avklart. Planens stopp-regel. |
| 4C nettlesertest 50–100 biler mot staging | `scripts/e2e-self-test-50-cars.mjs` **skriver** til staging: `/api/evidence-capture` (DB + R2-bilder) per bil. Krever eget GO. |
| 4D e-post/OTP/testhenvendelser | Oppretter reelle saker i staging-D1. Dessuten: prod må stenges først, ellers blandes test og ekte kunder. |
| 4E prod-test | Kun lest helse-/statusendepunkter (punkt 10–12 over). Ingen innsending. |

---

## 2. Leveranse 1 — Inventar over kjennemerke- og fasitfiler

Ingen kildedata er endret, flyttet eller overskrevet.

| Fil | Format | Rader | Unike kjennemerker | Bilinfo | Fasit/kilde | Persondata |
|---|---|---|---|---|---|---|
| `data/finn-100.jsonl` | JSONL | 110 | **110** | merke, modell, år (19 merker, 1983–2026; 24 ≤ 2010, 35 ≥ 2023) | nei (kun `finnkode` = offentlig annonse) | kjennemerke + finnkode |
| `data/fixtures/self-test-50-cars.json` | JSON | 50 | **50** (44 også i finn-110, 6 unike) | merke, modell, år, segment | `forventet`: 32 «treff» / 18 «ingen-kandidat» (ikke dokumentert fasit) | kjennemerke |
| `data/fasit-utvalg.csv` | CSV | 2 | **2** | VW TRANSPORTER 2005, MERCEDES CLA 200 D 2016 | `forventet_varenr`/`forventet_eurokode`, `kilde: A`, `verifisert: 2026-08-16 / 2026-08-13` | kjennemerke |
| `data/fitment-golden.json` | JSON | 2 | **2** | samme to | **golden-fasit med evidensstatus** (PROVISIONAL / AMBIGUOUS) | kjennemerke + VIN |
| `data/fasit-glass.json` | JSON | 2 | **2** | samme to | Tom-verifisert, sporbar kilde + dato (eneste sannhetskilde, håndheves av `tests/fasit-integritet.test.mjs`) | kjennemerke + VIN |
| `data/fasit-live.json` | JSON | 118 | 0 | merke, modell, år + `gyldigeKoder` | **ikke fasit** — gt-prisliste-avledet current baseline | nei |
| `data/fitment-challenge.json` | JSON | 24 cases | 0 | make, model, year + `krav` (applikasjoner, generasjon, spørsmålsnivå) | krav, ikke glass-fasit | nei |
| `data/test-utvalg-100.csv` | CSV | 100 SKU | 0 | brand, model, year_range | ingen fasit; alle 100 har `type_code` | nei |
| `data/url-manifest.csv` | CSV | 60 SKU | 0 | — | `position`, `door_position`, `physical_side`, `conflict_status` | nei |
| `data/test-100-resolver-rapport.json` | JSON | 110 oppslag | **110** | via oppslag | kjørt 2026-08-13 mot staging | kjennemerke |
| `data/fasit-utvalg-resultat.json` | JSON | 2 oppslag | **2** | via oppslag | kjørt 2026-11-03 mot staging | kjennemerke |
| `reports/typekode-conflicts-sample.csv` | CSV | konfliktutvalg | 0 | — | 94 registrerte konflikter (utvalg) | nei |

**Totalen:** **117 unike kjennemerker** i unionen av alle kilder. **0 duplikater**, **0 ugyldige formater** (alle matcher `[A-Z]{2}[0-9]{4,5}`). 44 av de 50 i selvtest-settet er også i finn-110; 6 er unike; SU18018 er ikke i finn-settet.

**Persondata:** testgrunnlaget inneholder **0 e-postadresser og 0 telefonnumre**. Eneste personindirekte felt er kjennemerke (oppslagbart til eier via SVV) og finnkode (offentlig annonse). **Prod-D1 har 9 reelle kundehenvendelser** — disse er ikke eksportert, ikke vist og ikke blandet inn i noen test.

**Merk om Git:** `data/finn-100.jsonl` (110 kjennemerker fra offentlige finn.no-annonser) er **sporet i Git**, mens fixturedumpene (`data/fixtures/ground-truth.jsonl`, `glass-prisliste.jsonl`, `manifest.json`) er gitignored. Kjennemerkene ligger dermed i historikken og kan ikke fjernes uten historikk-rewrite — akseptabelt i et privat repo, men det bør være et bevisst valg, ikke en tilfeldighet.

**Foreslått testdekning før kjøring mot eksterne oppslag:** 117 biler er nok for regresjon, men dekningen er skjev. I finn-settet (110) er fordelingen: Volkswagen 46, Toyota 29, BMW 7, Volvo 4, Mitsubishi 4, Kia 3, Nissan 2, Audi 2, Peugeot 2, Mazda 2, og 1 hver av Hyundai, Polestar, Isuzu, Ford, Lotus, Cupra, Porsche, Jaguar, Land Rover. **Helt fraværende: Mercedes, Skoda, Seat, Tesla, Renault, Citroën, Opel, Fiat, Dacia, Honda, Subaru, Suzuki, Mini og alle kinesiske merker** — til sammen store deler av det norske markedet. Fasit-/challenge-settet er merke-balansert (57 merker i `fasit-live.json`), men har ingen kjennemerker. Det må fylles på før en 500-bilers kjøring gir meningsfull dekning per merke.

---

## 3. Leveranse 2 — Forslag til trygt, deduplisert testgrunnlag

**Prinsipp:** kjennemerket er nøkkelen (fordi oppslaget krever det), men alt annet avidentifiseres. Kilde og kilderad beholdes som sporbarhet, ikke som kopi av personopplysninger.

Foreslått skjema (én rad per unik bil, `data/testgrunnlag-v1.csv`):

| Felt | Eksempel | Regel |
|---|---|---|
| `test_id` | `FBG-T-0001` | stabil, versjonert, aldri gjenbrukt |
| `kjennemerke` | `SU18018` | beholdes — nødvendig for SVV-oppslag; feltet skal aldri inn i rapporter, kun i testlogg |
| `kilde` + `kilderad` | `data/finn-100.jsonl:1` | sporbarhet tilbake til originalfil |
| `merke/modell/aar` | VW / TRANSPORTER / 2005 | fra kilden, ikke fra oppslaget (så avvik blir synlige) |
| `fasitstatus` | `PROVISIONAL` \| `AMBIGUOUS` \| `INGEN` | aldri «bekreftet» uten uavhengig evidens |
| `fasitkilde` | `fitment-golden.json#SU18018` | hvilken fil/linje som bærer fasiten |
| `plasseringer` | `frontrute` \| `bakrute` \| `dor:fremre` \| `side:2` \| `ventil:fremre` \| `tak` | kun de plasseringer kilden faktisk dokumenterer |
| `forventet_utfall` | `BEKREFTET` \| `KONTROLL` \| `INGEN_DEKNING` \| `TEKNISK_FEIL` | fylles ut **før** kjøring |
| `sett` | `regresjon` \| `tilfeldig` | planen krever begge, og de skal aldri blandes i samme metrikk |

**Faste sett:**
- **Regresjonssett (fast):** de 2 fasitene + de 24 `fitment-challenge`-casene + 50-selvtestsettet = 76 kjøringer, alltid samme forventning.
- **Tilfeldig utvalg (for nye feil):** resten av de 117, nytt utvalg per kjøring, seed logges i rapporten.

**Versjonering:** `testgrunnlag-v0` = dagens 117 kjennemerker. Enhver endring i forventet utfall krever ny versjon + begrunnelse i endringslogg, aldri stille redigering.

---

## 4. Leveranse 3 — Avviksrapport for eksisterende fasiter

### 4.1 SU18018 — fasiten er ufullstendig, og testen krever mer enn evidensen tillater

| Kilde | Sier |
|---|---|
| `data/fasit-glass.json` | riktig glass = `2525GYA` / `8579AGSGYAVZ1B` (INNK+ANT, **ikke** coated), «Tom i chat 2026-08-16», verifisert 2026-08-16 |
| `data/fitment-golden.json` | `expectedDecision: NEEDS_CONFIRMATION`, `verificationState: **PROVISIONAL**`, `independentEvidenceAvailable: **false**` — «Kun Tom i chat … én menneskelig kilde, ingen maskin-tracebar evidens» |
| `scripts/test-fasit.mjs` | **krever `utfall === 'PINPOINT' && eurokode === '8579AGSGYAVZ1B'`** (hard regresjon) |
| Målt i dag mot staging | `utfall: VERIFY`, grunn: `L1 (ground_truth): 5 varianter — utstyr må verifiseres`. Kandidater: 2525CSGY (6 990 kr), 2525GY, 2525GYAM, 2525GYM, 2525GYA |

**Avviket:** kravet i testen (PINPOINT) er **sterkere enn evidensen** (PROVISIONAL). `fitment-golden.json` sier det rett ut: «Det gamle `scripts/test-fasit.mjs` krevde PINPOINT 8579AGSGYAVZ1B — INKONSISTENT med både data og doktrine.» Testen er derfor **rød per design**, ikke på grunn av en regresjon, og den har vært det siden doktrinen ble skjerpet.

**Anbefaling (ikke gjort):** endre **kravet** til `VERIFY` med `2525GYA` blant kandidatene, eller skaff uavhengig evidens (OE-bilde av gammelt glass, eller VIN → build-data → OE). **Fasiten skal ikke endres** for å få grønt.

### 4.2 AJ95429 — ingen dekning, ikke teknisk feil

| Kilde | Sier |
|---|---|
| `data/fasit-glass.json` | `forventet_utfall: VERIFY`, «tvetydig datagrunnlag (1B/1T-varianter) — aldri tving PINPOINT» |
| `data/fitment-golden.json` | `verificationState: AMBIGUOUS`, forventet `NEEDS_CONFIRMATION`, kjent modell-granularitetsproblem: «resolveren matcher `CLA` men ikke `CLA 200 D 4MATIC`» |
| Målt i dag mot staging | `utfall: FALLBACK` — «ingen resolver-data», SVV svarer `MERCEDES CLA 200 D 4MATIC 2016` |

**Avviket:** fasiten forventer `VERIFY` (kandidater med utstyrsvalg), systemet gir `FALLBACK` (ingen kandidater). Det er **klassifisert feil i testsettet**, ikke en systemfeil: med SVVs faktiske modellstreng finnes ingen GT-/katalograd, altså er dette «ingen katalogdekning» — som planen din krever skal behandles som hjelpeinngang, ikke som feil glass. Kravet bør være `FALLBACK + MANUAL_REVIEW med hjelpeinngang`, ikke `VERIFY`.

### 4.3 Klassifiseringsavvik i testsettet

- `data/fasit-utvalg.csv` merker SU18018 som **`kilde: A`** — men i `fitment-golden.json` er autoritet **A = «uavhengig verifisert fitment-sannhet»**, og SU18018 har pr. golden **ingen** uavhengig evidens. Riktig klasse er B/C eller «uavklart». Dette er den samme feilklassen som ga feil glass i prod i 3 døgn i august.
- `data/fasit-live.json` inneholder **118** oppføringer; `fitment-golden.json` omtaler dem som «119 `maskinverifiserte`». Tallet er ikke lenger riktig, og verken filen eller forbrukerne sier tydelig at dette er **baseline for drift-deteksjon**, ikke kvalitetsdom. Risiko: noen tolker 118/118 som «118 biler bevist riktige».
- `docs/test-og-release-plan.md` er utdatert på to punkter: den sier «SU18018 → **PINPOINT 2525CSGY**» (det glasset Tom eksplisitt avviste), og tallene `11 / 79 / 20` stemmer ikke med `data/test-100-resolver-rapport.json` som viser `11 correct PINPOINT / 0 wrong / 77 VERIFY / 20 FALLBACK + 2 apiFeil`.

---

## 5. Leveranse 4 + 6 — Testkjøring og feilliste sortert etter alvorlighet

### 5.1 Lokal validering (fase 4A)

| Måling | Resultat |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run test` (49 suiter) | **519 tester · 519 pass · 0 fail · 0 skipped** |
| `npm run test:vin-gt` (med fixturedump) | **17/17 pass** — GT-roundtrip: alle 32 307 GT-rader søkbare (588 ms) |
| `npm run test:quote-browser` (ekte Chrome, lokal server, mock-DB) | **PASS** — 6 glassplasseringer → ekte inquiry-handler, syntetisk kontakt, `inquiry-varsel: RESEND_API_KEY mangler` = ingen e-post sendt |
| Før fixturedump | 512 pass + **7 skipped** (GT-fixture-tester hoppet over fordi `data/fixtures/ground-truth.jsonl` manglet lokalt) |

De 7 som var skippet er nå kjørt og grønne etter at fixturen ble dumpet (SELECT-only mot prod-D1). Den ene røde var en **utdatert hardkodet terskel** i `tests/vin-resolver-gt.test.mjs` — se §8.

### 5.2 Glassplassering — dette er dekket, og det er målt

Dette var Toms hovedspørsmål, så det står spesifikt:

| Suite | Tester | Resultat | Hva den låser |
|---|---|---|---|
| `test:glass-posisjon` | 17 | **17/17 PASS** | klassifisering av alle plasseringer, LHD/RHD, dørledd, ventilnummer, typekode-konflikt, delt bakrute |
| `test:typekode` | 17 | **17/17 PASS** | varenr → plassering via typekode, uverifiserte rader aldri PINPOINT |
| `test:glass-valg` | 11 | **11/11 PASS** | valgtreet: bare dokumenterte plasseringer tilbys, tomme grener umulig, tilbakeknapp nullstiller |
| `test:frontrute-view` | 15 | **15/15 PASS** | frontrute-visningen (view) skiller ekte frontruter fra side/bak/dør |
| `test:frontrute-search` | 20 | **20/20 PASS** | frontrutesøk mot GT, ingen lekkasje av andre plasseringer |
| `test:all-glass-kandidater` | 25 | **25/25 PASS** | F1: plassering kommer fra `klassifiserGlass` (ikke nøkkelord i navnet), ventil og tak som egne klasser, karosseri/side-filtrering, F12 «valgt side fjerner beviselig motsatt side — og tømmer aldri listen» |
| **Sum** | **105** | **105/105 PASS** | |
| Playwright/Chrome ende-til-ende | 1 | **PASS** | klikker gjennom **front, dør, side, bak, ventil, tak** i ekte UI → ekte inquiry-handler |

`GlassType` i `src/glass-posisjon.ts:21` = `frontrute | bakrute | dor | side | ventil | tak | sidefamilie | ukjent`, og alle seks reelle plasseringer er dekket både i enhetstester og i nettleserflyten.

**Datagrunnlaget for plassering — og dette er den viktigste målingen i hele rapporten:**

| Kilde | Dekning |
|---|---|
| `data/test-utvalg-100.csv` | 100 SKU-er, **alle** med `type_code`, fordelt på **18 posisjonstyper** (13 frontrute, 12 bakrute, 16 dørrute, 14 siderute, 16 ventil, 3 delt bakrute) |
| `data/url-manifest.csv` | 60 SKU-er med `position`, `door_position`, `physical_side`, `driver_passenger_side`, `steering_position` |
| Prod-D1 `glass_typekode` | **FINNES IKKE.** Migrasjon 0047 er ikke kjørt i prod. Tabellen med **20 601 rader** ligger bare i staging (`finnbilglass-staging-catalog`). Prod-D1 `glass_prisliste` har heller ingen `typekode`-kolonne (kolonner: `varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type`). |

**Målt plasseringsdekning i prod-prislisten** (klassifisert med `klassifiserGlass()` over alle 25 178 `rad_type='glass'`-rader fra prod-dumpen):

| Plassering | Rader | Andel |
|---|---|---|
| frontrute | 6 171 | 24,5 % |
| bakrute | 3 539 | 14,1 % |
| dørrute | 3 300 | 13,1 % |
| siderute (nummerert) | 830 | 3,3 % |
| ventilrute | 537 | 2,1 % |
| tak | 44 | 0,2 % |
| **sidefamilie** (gruppe kjent, men ikke dør/side/ventil) | 8 954 | 35,6 % |
| **ukjent** (ingen posisjon i navn eller eurokode) | 1 803 | 7,2 % |

- Side (venstre/høyre) er satt på **13 370 rader (53,1 %)**.
- **Dørruter uten fremre/bakre: 3 000 av 3 300 (90,9 %).**
- **Ventilruter uten foran/bakre: 537 av 537 (100 %).**
- Kilde for klassifiseringen: eurokode 64,7 %, navn+eurokode 24,8 %, navn 2,1 %, ingen 7,2 %.
- **Navn-motstrid: 28 rader** der navnet og eurokoden sier ulik plassering (f.eks. `21304C` «TOYOTA HI-ACE BAKRUTE» med eurokode `8268ACLV` = frontrute). De blokkerer auto-godkjenning, men er ikke avklart.

**Konklusjon om plassering:** logikken er godt testet og oppfører seg riktig — men **datagrunnlaget i prod er ufullstendig**. Uten `glass_typekode`-tabellen i prod kan ikke systemet skille fremre/bakre dørrute for 90,9 % av dørrutene, eller foran/bakre ventil for 100 % av ventilrutene. Det er nøyaktig den mangelen typekode-importen (20 601 rader) skulle lukke, og den ligger fortsatt bare i staging.

**Plasseringsavvik som må lukkes:** `29730YP` har `CONFLICT` — CSV sier ventilrute **front left**, mens eurokoden `5179RYPR5RV` sier **rear right**. Raden er `UNVERIFIED` og skal ikke brukes som fasit for ventilruter før den er avklart.

### 5.3 Feilliste sortert etter alvorlighet

| # | Alvor | Funn | Bevis | Anbefalt retting |
|---|---|---|---|---|
| 1 | **KRITISK** | **Produksjon tar imot kundehenvendelser** mens release-gaten er NO-GO. Ingen invitasjonssperre finnes i koden. | `GET https://finnbilglass.no/api/pilot-status` → `inquiries_enabled: true`; prod-D1 `feature_flags.inquiries_enabled = 1`; 9 saker i `beta_inquiries`, siste `2026-11-03T23:18:22Z`; `src/invitation.ts` finnes ikke | Sett `inquiries_enabled = 0` i prod-D1 nå (krever Toms GO — prod-skriving). Deretter deploy invitasjonsporten før gjenåpning. |
| 2 | **HØY** | **Plasseringsdataene er ikke i prod.** `glass_typekode` (20 601 rader) finnes bare i staging; prod-prislisten har ingen `typekode`-kolonne. | Målt: 3 000 av 3 300 dørruter (90,9 %) og 537 av 537 ventilruter (100 %) mangler fremre/bakre; 8 954 rader (35,6 %) er bare «sidefamilie»; 1 803 (7,2 %) har ukjent plassering | Kjør migrasjon 0047 + typekode-import i prod — men det er en prod-skriving som krever eget GO, og den må komme etter at P0 er lukket. |
| 3 | **HØY** | SU18018-fasittesten kan ikke bestå: krav PINPOINT, evidens PROVISIONAL. | §4.1, målt i dag: `VERIFY` + 5 kandidater | Endre **kravet** til VERIFY + 2525GYA blant kandidater, eller skaff uavhengig OE-evidens. Ikke rør fasiten. |
| 4 | **HØY** | `2525CSGY` — glasset Tom sa «ER IKKE RIKTIG GLASS» — leveres fortsatt som kandidat uten advarsel (6 990 kr). | Målt kandidatliste i dag (jf. `fasit-glass.json` `_laerdom`) | Ekskluder per VIN når uavhengig evidens finnes; til da bør kandidatlisten merkes som usikker for denne bilen. |
| 5 | **HØY** | AJ95429 gir **ingen** kandidater fordi SVV sier «CLA 200 D 4MATIC» og resolveren mangler GT/katalog for 4MATIC-varianten. | §4.2 | Riktig at PINPOINT ikke tvinges. Men kunden må få tydelig hjelpeinngang, og saken må havne i manuell kø — verifiser at den gjør det. |
| 6 | **MIDDELS** | GT-fixture-guarden hadde hardkodet terskel `> 35 000`; prod har 32 307 (dokumentert i `docs/retensjon-2026-11-01.md`) → falsk rød test som stoppet **hele** QA-kjeden (49 suiter, alt etter `test:vin-gt` ble aldri kjørt). | `tests/vin-resolver-gt.test.mjs:130` før fiks; `manifest.json` = 32 307 | **FIKSET** i denne kjøringen — sammenligner nå eksakt mot `manifest.json`. Se §8. |
| 7 | **MIDDELS** | `fasit-utvalg.csv` klassifiserer SU18018 som `kilde: A` (uavhengig verifisert) i strid med `fitment-golden.json`. | §4.3 | Rett til B/C eller «uavklart». |
| 8 | **MIDDELS** | `docs/test-og-release-plan.md` er utdatert og nevner det **avviste** glasset som forventet PINPOINT. | §4.3 | Oppdater eller merk som historisk dokument. |
| 9 | **MIDDELS** | `29730YP` posisjonskonflikt (front-left vs rear-right) står `UNVERIFIED`. | `data/url-manifest.csv` rad 1 | Avklar før plasseringsfilteret kan stoles på for ventilruter. |
| 10 | **MIDDELS** | 28 rader der varenavn og eurokode sier ulik plassering, er ikke avklart. | Målt i dag (f.eks. `21304C` BAKRUTE vs eurokode frontrute) | Gå gjennom de 28 manuelt; de blokkerer auto-godkjenning, men ingen eier dem. |
| 11 | **LAV** | `kilde`-feltet lyver for 300 rader: dørledd utledet fra **navnet** merkes som `kilde: 'typekode'` (`src/glass-posisjon.ts:407` setter `kildeOverride` også for navn-treff). | Målt: 300 rader med `kilde: typekode` uten typekode-input | Bruk egen verdi (`navn:ledd`) eller egen boolean, så diagnostikken ikke peker på feil kilde. |
| 12 | **LAV** | `3172GNCM` vises to ganger i AJ95429-kandidatlisten (mulig to varenr med samme eurokode, eller dedupe-hull). | `data/fasit-utvalg-resultat.json` 2026-11-03: `3172GNM2 3172GNCM 3172GNCA 3172GNCM` | Verifiser at F11-dedupe også gjelder eurokode, ikke bare varenr. |
| 13 | **LAV** | `data/test-utvalg-100-corrected.csv` inneholder 3 av 100 rader og er ikke anvendt på hovedfila. | fillinventar | Slå sammen eller slett, så det ikke finnes to sannheter om samme utvalg. |

**Tekniske feil i fase 4A:** 0. **Kritiske feil i valgtreet:** 0. **Falske PINPOINT:** 0 i alle kjøringer (systemet ga `VERIFY`/`FALLBACK` der evidensen ikke holder).

---

## 6. Leveranse 5 — Nettlesertest (delvis levert)

| Krav i planen | Status |
|---|---|
| Full kundeflyt (kjennemerke → bil → plassering → side/dør → tilbake → oppsummering → innsending → kvittering) | **Levert lokalt**: `tests/quote-pilot-browser.test.mjs` kjører ekte Chrome mot ekte Worker-kode med mock-DB, for **alle 6 plasseringer**, med syntetisk kontakt (`Synthetic Test` / `12345678`), og verifiserer at operatørens notat inneholder riktig `kind` per plassering. PASS. |
| Mobil + desktop | **Ikke kjørt** mot staging. Siste visuelle dekning: `docs/nordisk-klarhet-2026-11-03.md` (skjermbilder i `~/.hermes/cache/scratch/fbg-nordisk-klarhet/`, mobil + desktop, forside + flyt). |
| 50–100 biler fra representativt sett | **Ikke kjørt**. Settet finnes og er versjonert (`data/fixtures/self-test-50-cars.json` v1: 14 vanlig, 10 eldre, 10 elbil, 8 varebil/SUV, 8 nyere). Kjøringen skriver til staging (evidence-capture + R2) og krever GO. |
| Reell testforespørsel | **Ikke sendt.** Planen krever syntetiske kontakter; det er ikke mulig å holde en slik sak utenfor kundetallene i prod uten en egen testmarkering, og prod er per i dag åpen for ekte kunder. |

---

## 7. E-post (fase 4D) — status uten å sende

- Prod-Worker har `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_NOTIFY_EMAIL`, `SUPPORT_EVIDENCE_TOKEN` satt. Brevo er fjernet fra koden (commit `973309f`), all post går via Resend.
- **`support@finnbilglass.no` har ikke bekreftet mottak.** Målt 2026-11-04 (`docs/nordisk-klarhet-2026-11-03.md` §5): MX peker til `loke.domene.no` (Domeneshop), og en sending til en **oppdiktet** adresse på domenet fikk også `last_event: delivered`. Leveringsstatus beviser derfor ingenting, og «delivered» kan ikke brukes som bevis på at kunden kan svare.
- Det betyr at planens krav «skille mellom akseptert av Resend og levert til mottakerens e-postserver» **ikke kan oppfylles med dagens Resend-status alene** — det krever en deterministisk rute (Cloudflare Email Routing → `SUPPORT_NOTIFY_EMAIL`) eller manuell kontroll av postkassen.

---

## 8. Endring jeg gjorde i koden (åpenhet)

Én fil, test-only, ingen produksjonspåvirkning: `tests/vin-resolver-gt.test.mjs` (+26 / −6).

Guard'en krevde `> 35 000` GT-rader, et tall som var riktig 2026-08-19 (36 180, jf. kommentaren i testen) men som ble foreldet etter GT-rensingen: dagens prod-D1 og `docs/v66-staging-prototype.md` / `docs/retensjon-2026-11-01.md` viser **32 307** rader (differanse 3 873). Resultatet var en **falsk rød test som stoppet hele QA-kjeden**. Guarden sammenligner nå **eksakt** mot `data/fixtures/manifest.json`, som skrives av `dump-d1-fixtures.mjs` med DB-ens egen `COUNT(*)` — det fanger både stille data-tap og utdaterte terskler, uten hardkodede tall. Faller tilbake til grove gulv (`> 30 000` / `> 25 000`) hvis manifestet mangler.

Ingen fasit, ingen forventning og ingen test er endret for å bli grønn.

---

## 9. Lanseringskriterier — oppfylt?

| Kriterium | Status | Bevis |
|---|---|---|
| Ingen åpne kritiske feil | **NEI** | P0: prod åpen for kundehenvendelser |
| Alle dokumenterte fasitcaser gir riktig resultat eller eksplisitt manuell kontroll | **NEI** | 2/2 fasitkrav brutt (§4.1, §4.2) |
| Ingen testvalg gir tomme grener eller udokumenterte alternativer | **JA (lokalt)** | 105/105 plasseringstester, F12 «tømmer aldri listen» |
| Teknisk feilrate og dekning rapportert separat fra manuell kontroll | **JA** | 0 tekniske feil lokalt; 2026-08-13-kohorten: 11 PINPOINT / 0 feil / 77 VERIFY / 20 FALLBACK / 2 apiFeil |
| Nettleserflyt mobil + desktop | **DELVIS** | Lokal Chrome 6/6 plasseringer PASS; staging-kohort ikke kjørt |
| E-postflyt kontrollert med testmottakere | **NEI** | ikke sendt; support@-mottak ikke bekreftet |
| Persondata holdt utenfor logger og rapporter | **JA** | 0 e-post/telefon i alt testgrunnlag; prod-saker ikke eksportert |
| Produksjonstester begrenset og testmerkede | **JA** | kun 4 GET-kall (2 helse, 2 status) + 4 SELECT |
| Rapporten viser testdato, kodeversjon, datasettversjon | **JA** | header øverst |

**Anbefaling: IKKE KLAR.**

Kataloghull er akseptable når kunden får tydelig hjelpeinngang — det kriteriet er oppfylt i systemet. Men feilaktig sikkerhet er ikke akseptabelt, og akkurat nå er kombinasjonen dårligst tenkelig: **prod er åpen for kunder, mens 0 av 2 fasiter er uavhengig bevist**.

---

## 10. Hva jeg trenger avklart før fase 4B–4E

1. **Stenging av prod** (`inquiries_enabled = 0`) — krever Toms GO. Dette er den eneste endringen som haster, og den er en D1-skriving i prod.
2. **Tillatt SVV-kallvolum og kostnad** for 4B: 117 biler i dag, 500 i planen. Uten dette stopper masseoppslaget.
3. **GO for staging-skriving** i 4C (evidence-capture + R2 per bil) og 4D (testhenvendelser med syntetiske kontakter).
4. **SU18018:** senker vi kravet til `VERIFY + 2525GYA blant kandidatene`, eller skaffer vi uavhengig evidens først (OE-bilde / VIN → build-data)?
5. **`2525CSGY`:** skal den hard-ekskluderes per VIN (krever evidens vi ikke har), eller skal kandidatlisten bare merkes som usikker?
6. **Plasseringsdata i prod:** skal migrasjon 0047 + typekode-import (20 601 rader) kjøres i prod før lansering? Uten den kan ikke fremre/bakre dør (90,9 %) eller foran/bakre ventil (100 %) avgjøres — og det er plasseringen som avgjør om kunden får riktig rute.
7. **PR-hygiene:** 10 åpne PR-er, og prod-koden er ikke sporbar i Git (PR #27 er fire commits bak branchen). En testrapport uten sporbar prod-versjon bryter planens eget krav om kodeversjon i rapporten.
