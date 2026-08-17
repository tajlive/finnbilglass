# FINNBILGLASS FITMENT TRUTH BASELINE v1

> Phase A0 — read-only analyse + deterministisk golden-fasit + live-drift-lane.
> Ingen endring i produksjonsresolverens oppførsel. Ingen deploy. Ingen merge.

## 1. Status
**INVESTIGATION COMPLETE** — golden-lane (deterministisk) og live-lane (drift) implementert og kjørt. Ingen produksjonsendring.

## 2. Git / repository state
- Repo: `/Users/taj/finnbilglass` (B2C finnbilglass.no, Worker `finnbilglass-frontrute`, konto `80d5b1d5`).
- Branch: `arch/fitment-truth-baseline-v1` (opprettet fra `main`).
- HEAD: `f715ce2` (uendret — ingen ny commit av resolver-kode).
- Working tree FØR arbeid: 15 ubeslektede modifikasjoner (`public/bilmerker/*.svg`) — **bevart urørt**.
- Working tree ETTER arbeid: de 15 SVG-ene + nye filer nedenfor.

## 3. Source authority matrix (VERIFIED)

| Kilde | Rader | Opphav | Uavhengighet | Klasse | Nåværende bruk | Sirkularitet |
|---|---|---|---|---|---|---|
| `ground_truth` (gt-auto-prisliste) | 34 201 | Autogenerert FRA prislisten (scripts/gt-generator) | **IKKE uavhengig** — avledet fra samme kilde den validerer | **D** | Behandles som autoritativ fasit (L1, conf 0.80) + GT-gate for L2/L3 | **SIRKULÆR** |
| `ground_truth` (b2b-seed) | 1 979 | auto-glass.no (manuelt/B2B-avledet) | Delvis uavhengig (per-kjøretøy-spesifikk) | **C/D** | Behandles som autoritativ fasit (L1, conf 0.85) | Delvis (proveniens ikke sporbar) |
| `glass_catalog` | 33 215 | Pilkington-dump | Autoritativ for PRODUKT-eksistens/attributter | **B/D** | L2 kandidater (conf 0.7) | Lav (men `oem_numbers` er `[]` i 99,55 %) |
| `glass_prisliste` | 29 627 | auto-glass.no prisliste | Katalog/kommersiell | **D** | pris-oppslag (`prisKandidat`) | Lav |
| `oe_eurocode_mapping` | 341 | b2b-pilkington | Potensielt uavhengig (OE↔eurocode) | **B (pot.)** | **INGEN kode leser den** | — (ubrukt) |
| `glass_catalog.oem_numbers` | ~149 reelle | Pilkington | Potensielt uavhengig | **B (pot.)** | **INGEN kode leser den** | — (ubrukt + forurenset) |
| `vin_glass_overrides` | **0** | (manuell fasit) | Potensielt uavhengig | **A (pot.)** | L0 (conf 0.95) — **tom i prod** | — |
| `vin_ktype_map` | **0** | (TecDoc) | Potensielt uavhengig | **B (pot.)** | L3T (conf 0.9) — **tom i prod** | — |
| `ktype_registry` | 833 | TecDoc | Potensielt uavhengig | **B (pot.)** | L3 — **ubrukelig** (`glass_catalog.ktype` = NULL) | — |
| `data/fasit-glass.json` | 2 | Tom-verifisert | Menneskeautoritet, ikke maskin-evidens | **A (pot.)** | SSoT for manuell fasit | Kun 2 fixturer |

**Hvorfor gt-auto-prisliste IKKE kvalifiserer som autoritativ GT-gate (VERIFIED):** Den er generert *fra* `glass_prisliste` og brukes deretter til å validere PINPOINT mot *den samme* prislisten. Det er selvrefererende: en kandidat kan ikke få "uavhengig bekreftelse" fra data som selv er avledet fra kandidatens egen kilde. Den er kandidat-enumeration, ikke sannhet.

## 4. Ground-truth source statistics (VERIFIED)
- `ground_truth`: **36 180** rader = `gt-auto-prisliste` **34 201 (94,5 %)** + `b2b-seed` **1 979 (5,5 %)**.
- `verified_by`: `auto-glass.no` = 1 979; `gt-auto-prisliste` = 34 201 (dvs. "verified_by" for de autogenerte radene er generatornavnet, ikke en menneskelig kilde).
- Unike kjøretøy (make|model|year): **21 585**. Med >1 DISTINCT `frontrute_eurocode` (flervariant/VERIFY-klasse): **8 116 (37,6 %)**.
- `b2b-seed`-dekning: **1 907** kjøretøy (1 847 pinpoint / 60 verify); `gt-auto-only`: **19 678**; overlapp: **353**.

## 5. Circularity analysis (VERIFIED)
- gt-auto-prisliste er generert fra prislisten og brukes som GT-gate → sirkulær.
- `glass_catalog.oem_numbers`: 33 066/33 215 rader = bokstavelig `[]` (tom JSON-array). Kun ~149 rader har reelle OE-numre, og disse er forurenset med konkatenert `"...GlavistaNumber:100650\\\""`-tekst.
- `oe_eurocode_mapping`: 0 VW T5 (8579*/7H0*) rader — OE-data for testkjøretøyet finnes ikke.
- **Konflikt b2b-seed vs gt-auto-prisliste (353 overlapp-kjøretøy, systematisk):** eks. AUDI A3 2003 → b2b `2524GYM` vs gt-auto `2524GY`; AUDI A4 2001 → b2b `2324GYM` vs gt-auto `2324CSGY`; BMW 3 SERIE 1983 → b2b `1276GB` vs gt-auto `1276BZ,1276C`. b2b-seed er et spesifikt valg, gt-auto er supersettet — de er ikke enige, men begge behandles som "truth".

## 6. Known fixture inventory (VERIFIED)
- `data/fasit-glass.json` (SSoT): **2** fixturer — `SU18018` (2525GYA/8579AGSGYAVZ1B, kilde=Tom chat) og `AJ95429` (forventet VERIFY, ingen varenr/eurokode).
- `data/fasit-live.json`: **119** "maskinverifiserte L1-PINPOINT" — disse er **CURRENT-BASELINE** (gt-auto-prisliste-avledet), IKKE golden truth.
- `scripts/test-fasit.mjs`: 2 harde krav — `SU18018 → PINPOINT 8579AGSGYAVZ1B` (INKONSISTENT, se §7) og `AJ95429 → VERIFY`.
- `tests/fasit-live.test.mjs`: 119 fasiter, nettavhengig, ekskludert fra `npm test`.

## 7. SU18018 independent evidence trace

**Bilidentitet — VERIFIED (to uavhengige kilder enige):**
- SVV: merke VOLKSWAGEN, handelsbetegnelse TRANSPORTER, VIN `WV1ZZZ7HZ5H060934`, farge Sølv, førstegangsreg. 2005-04-20.
- VIN-dekode (ISO 3779): WMI `WV1` = VW Commercial Vehicles (DE); pos 7–8 `7H` = T5 Transporter; pos 10 `5` = 2005; pos 11 `H` = Hannover.

**Glass-fitment — PROVISIONAL (én menneskelig kilde, ingen maskin-traceable uavhengig evidens):**
- "Riktig glass = 2525GYA / 8579AGSGYAVZ1B (INNK+ANT, IKKE coated)" har **nøyaktig én** kilde: Tom i chat 2026-08-16.
- Eneste mekanisme som ville pinne den: `data/vin-glass-overrides.sql` (`source='manual-fasit'`, `confidence=0.98`) — men `vin_glass_overrides` = **0 rader i prod** (aldri anvendt).
- `oe_eurocode_mapping`: **0** VW T5-rader. `glass_catalog.oem_numbers` for hele 8579*-familien: `[]`. `b2b-seed`: **0** VW TRANSPORTER T5-rader.
- Skillet coated (C) vs ikke-coated er utstyrsnivå som **SVV og VIN ikke kan bestemme** (SVV gir kun farge).

**Nåværende prod-adferd (VERIFIED, live-målt):** `/api/regnr` SU18018 → **VERIFY** («L1 (ground_truth): 6 varianter»). De 6 kandidatene kommer fra L1 `ground_truth`-rader med **data-kvalitets-artefakter**: `TRANSP+CARAV T5` (→2525CSGY, coated), `TRANSP+CARAVELLE` (→2525GY/2525GYAM/2525GYM), `TRANSP+CARAVELLE T5` (→2525GYA), `TRANSPORTE+MULTIVAN` (→8579GZPV2 = eurokode **`7H0877051`** = VW OE-nummer, uten utstyrsattributter). Alle `gt-auto-prisliste` (klasse D).

**Konklusjon (VERIFIED):** SU18018's glass er **PROVISIONAL**. Bilidentiteten er sikker, men glass-fitment kan ikke uavhengig verifiseres fra dagens data. Det gamle `test-fasit.mjs`-kravet `PINPOINT` er INKONSISTENT med både dagens data (VERIFY) og den nye doktrinen (1 kandidat ≠ sannhet, ingen uavhengig evidens).

## 8. AJ95429 evidence trace
- `data/fasit-glass.json`: `forventet_utfall=VERIFY`, `vin=null`, ingen varenr/eurokode, kilde="tvetydig datagrunnlag (1B/1T-varianter)". **AMBIGUOUS** (VERIFIED).
- Live-målt prod-adferd: SVV returnerer modell **«CLA 200 D 4MATIC»** (ikke «CLA»), VIN `WDD1179021N318527` → resolver finner ingen data → **FALLBACK (MANUAL_REVIEW)**. Dette er konservativt og trygt, men avslører et modell-granularitetsproblem: resolveren matcher «CLA», ikke «CLA 200 D 4MATIC».
- **Klassifikasjon: AMBIGUOUS.** Skal ALDRI tvinges til AUTO_MATCH uten at 1B/1T-tvetydigheten faktisk oppløses.

## 9. Current-vs-golden baseline (VERIFIED)

| Fixtur | CURRENT (prod) | GOLDEN (uavhengig evidens) | Samstemt? |
|---|---|---|---|
| SU18018 | NEEDS_CONFIRMATION (VERIFY, 6 kandidater) | NEEDS_CONFIRMATION (PROVISIONAL) | ✅ (men gammel test krevde AUTO_MATCH = feil) |
| AJ95429 | MANUAL_REVIEW (FALLBACK) | NEEDS_CONFIRMATION (AMBIGUOUS) | ⚠️ sikker drift (prod mer konservativ) |

Viktig: produksjonen returnerer i dag **ikke** AUTO_MATCH for noen av fasitene — det gamle `test-fasit.mjs` (PINPOINT-krav) er den inkonsistente komponenten.

## 10. Golden test lane (implementert)
- `data/fitment-golden.json` — golden sannhetsregister med verifikasjons-vokabular (VERIFIED/PROVISIONAL/AMBIGUOUS/UNVERIFIED/CONFLICTING) + beslutnings-vokabular (AUTO_MATCH/NEEDS_CONFIRMATION/MANUAL_REVIEW).
- `tests/fitment-golden.test.mjs` — deterministisk, **ingen nett/SVV/D1**. Håndhever doktrinen: `verificationState !== VERIFIED ⟹ decision !== AUTO_MATCH`; `AUTO_MATCH ⟹ independentEvidenceAvailable === true`; AMBIGUOUS/CONFLICTING ⟹ minst NEEDS_CONFIRMATION.
- `npm run test:fitment:golden` → **7/7 PASS** (se §17). Kan senere gjøres CI-blokkerende.

## 11. Live test lane (implementert)
- `scripts/test-fitment-live.mjs` — treffer prod `/api/regnr`, måler drift mot golden, skiller **FARLIG drift** (prod sikrere enn golden) fra **SIKKER drift** (prod mer konservativ). Exit-koder: 0 = OK, 1 = fitment-drift, 2 = infrastrukturfeil.
- `npm run test:fitment:live` → SU18018 OK; AJ95429 **SIKKER drift** (prod MANUAL_REVIEW vs golden NEEDS_CONFIRMATION).
- **Ikke** lagt inn i `npm test` (unit-gaten) — kjører eksplisitt.

## 12. Source-aware gating simulation (VERIFIED, read-only)
| Scenario | Autoritativ GT | Effekt |
|---|---|---|
| CURRENT | alle 36 180 rader | 21 585 kjøretøy; 8 116 (37,6 %) VERIFY, rest PINPOINT-kandidater |
| TRUSTED_GT (kun b2b-seed) | 1 979 rader (1 907 kjøretøy) | **19 678 gt-auto-only kjøretøy (91,2 %) demotes** fra autoritativ GT → mister GT-gate → L2/L3/fallback. Katastrofal dekningsreduksjon, men avdekker at dagens "dekning" er kandidat-enumeration, ikke sannhet. |
| NO_FALLBACK_PINPOINT | (matcher-endring) | `matchFrontrute` kan foreslå kandidater men aldri `pinpoint:true`/AUTO_MATCH alene. Ingen kjøretøy mister kandidater; kun falsk sikkerhet fjernes. |

**Konklusjon:** TRUSTED_GT alene er for drastisk som første steg — det ville kollapse dekningen. Riktig sekvens er: (1) merke gt-auto-prisliste som klasse-D (ikke-autoritativ) i stedet for å slette, (2) stenge fallback-PINPOINT, (3) deretter bygge opp ekte klasse-A/B-evidens (OE/VIN/ktype).

## 13. Proposed evidence contract (design, ikke koblet inn)
```
decision: AUTO_MATCH | NEEDS_CONFIRMATION | MANUAL_REVIEW
selectedCandidate: Candidate | null
candidates: Candidate[]
evidence: Evidence[]          // { source, sourceClass(A-E), type, value, independent, strength, supports[], excludes[], provenance }
conflicts: Conflict[]         // motstridende evidens, uløst
questions: Question[]         // skillende utstyrs-/variantspørsmål
reasonCodes: string[]         // maskinlesbare årsaker (f.eks. OE_MATCH, GT_ONLY, NO_INDEPENDENT, EQUIPMENT_AMBIGUOUS)
auditId: string
```
`confidence` nedgraderes til sekundær diagnostikk (ikke selve sannheten). Hvert evidens-element peker på primærkilde (rad-id, OE-nummer, VIN-byggdata) så kjeden er sporbar.

## 14. Proposed decision rules (design, ikke implementert)
- **AUTO_MATCH** krever: ≥1 klasse-A/B-evidens som peker på én kandidat, OG ingen uløst materiell konflikt, OG ingen uløst skillende utstyrsattributt. **1 kandidat etter filtrering er IKKE tilstrekkelig.**
- **Én kandidat med sterk uavhengig evidens (OE/VIN→ktype):** AUTO_MATCH (hvis ingen konflikt).
- **Én kandidat nådd kun via heuristikk (tekstmatcher/gt-auto):** NEEDS_CONFIRMATION.
- **Flere kandidater skilt av utstyr:** NEEDS_CONFIRMATION med skillende spørsmål; AUTO_MATCH kun når kundens svar + evidens entydig.
- **Motstridende autoritativ evidens:** MANUAL_REVIEW (CONFLICTING).
- **OE-treff uten feature-sikkerhet:** NEEDS_CONFIRMATION (OE-nummer uten variant-suffiks beviser ikke utstyr).
- **VIN/kType-treff:** NEEDS_CONFIRMATION (kType beskriver variant, ikke komplett fabrikkutstyr).
- **Ingen uavhengig evidens:** minst NEEDS_CONFIRMATION, aldri AUTO_MATCH.

## 15. Risks
- **P0 — falsk sikkerhet via manuell override:** `data/vin-glass-overrides.sql` vil, hvis anvendt, pinne SU18018 → PINPOINT/AUTO_MATCH utelukkende fra Toms påstand, uten maskin-evidens. Dette er nøyaktig mekanismen som ga 3 døgn feil glass i prod.
- **P0 — sirkulær GT-gate:** gt-auto-prisliste validerer data avledet fra seg selv.
- **P0 — data-kvalitet i GT-modellnavn:** `TRANSPORTE+MULTIVAN`, `TRANSP+CARAVELLE` (raw prisliste-strenger) gjør matching skjør og serie-avhengig.
- **P1 — OE-data fraværende:** oe_eurocode_mapping (0 T5) og oem_numbers (`[]`) gjør OE-resolusjon umulig i dag.
- **P1 — canonical-master aldri migrert:** 17 tabeller i prod; migrasjonene 0004/0006/0007/0008 (glass_master, glass_evidence, resolution_audit, ktype_matches, tecdoc_import_runs, image_intake) finnes IKKE i prod.
- **P2 — test-fasit.mjs er i konflikt med doktrinen** (krever PINPOINT for en PROVISIONAL-fasit).

## 16. Files created/modified (kun på branch, ingen resolver-endring)
- `data/fitment-golden.json` (NY — golden sannhetsregister)
- `tests/fitment-golden.test.mjs` (NY — deterministisk golden-lane)
- `scripts/test-fitment-live.mjs` (NY — live drift-lane)
- `scripts/fitment-baseline-analysis.mjs` (NY — read-only kilde/kontaminasjonsanalyse)
- `package.json` (endret — 2 nye scripts: `test:fitment:golden`, `test:fitment:live`)
- De 15 ubeslektede `public/bilmerker/*.svg` er **bevart urørt**.

## 17. Tests executed
- `npm run test:fitment:golden` → **7/7 PASS** (deterministisk, 0 nett).
- `npm run test:fitment:live` → SU18018 **OK**; AJ95429 **SIKKER drift** (exit 1, drift). Ingen infrafeil (exit 2 ikke utløst).
- `npx tsc --noEmit` → (kjørt av eksisterende `npm test`-kjede; ikke endret av denne fasen — ingen ny TS-kode).

## 18. Exact recommended next architecture step
**Frys fasiten og steng falsk sikkerhet uten å røre dekningen:**
1. Merk `gt-auto-prisliste` som klasse-D (ikke-autoritativ) i GT-gaten — i stedet for å slette den, slik at den kan *foreslå* kandidater men ikke *bevise* AUTO_MATCH.
2. Endre `utfraKandidater`/`matchFrontrute` slik at heuristisk teksttreff aldri alene gir `pinpoint:true`/AUTO_MATCH.
3. Fjern/korriger `test-fasit.mjs` sitt `SU18018 → PINPOINT`-krav (erstatt med golden-registerets NEEDS_CONFIRMATION).
4. **STOPP** — vent på Tom/arkitekt-godkjenning før OE-resolusjon eller VIN/kType bringes inn.

---
Alle hovedpåstander er merket VERIFIED (målt mot prod D1/live API/SVV/kode) eller PROVISIONAL/AMBIGUOUS (fasit uten uavhengig evidens). Ingen INFERRED-påstander er brukt som sannhet.
