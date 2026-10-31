# PRODUCTION GO / NO-GO — FinnBilGlass

**Dato:** 31. oktober 2026
**Baseline main:** `ddd78d1`
**Release-kandidat:** `c0b96b4` (PR #6)

---

## 1. Eksakt release-SHA

| | |
|---|---|
| Kandidat | **`c0b96b4`** — `fix(discovery): bruk normalisert merke ogsaa i seed-soket` |
| Base | `ddd78d1` |
| CI på eksakt commit | **success** |
| Staging-deploy fra eksakt commit | **`1b0858d6-fac3-4831-8e9f-8b537b631e78`** (ren `git worktree` på `c0b96b4`, ingen lokale endringer) |
| Diff | 32 filer, +9 307 / −228 |

Staging-versjonen er deployet fra en ren checkout av `c0b96b4`, ikke fra en arbeidskopi. Commit og deployert versjon er dermed sporbar.

---

## 2. PR-status

| PR | Head | Status | Vurdering |
|---|---|---|---|
| **#6** | `c0b96b4` | Draft, CI grønn, MERGEABLE | **Release-kandidat** — klar for sign-off |
| #7 | `76213be` | Merget | — |
| #8 | `5e007a9` | Merget → `e2d1564` | — |
| #9 | `723c2eb` | Merget → `94b3ca5` | — |
| #10 | `c98d043` | Merget → `ddd78d1` | — |
| #2, #3, #4, #5 | — | Åpne | **Erstattet** — se punkt 12 |

---

## 3. Testresultater og stagingbevis

### `npm run qa` på eksakt `c0b96b4` (ren worktree)
```
tests 344 · pass 337 · fail 0 · exit 0
```
7 skippet er bevisst (krever Cloudflare-tilgang eller eksterne nøkler).

### Staging-E2E (`https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev`)
```
1. regnr-oppslag      ✔ VW TRANSPORTER 2005 · VIN WV1ZZZ7H…
2. bil → glass        ✔ PINPOINT (vin_glass_overrides: 1 kandidat) → 2525GYA
3. glass → pris       ✔ kundePris 5490 kr · listepris 9980 kr
4. kundehenvendelse   ✔ inquiryId 69 (HTTP 201)
Resultat: 4/4 steg OK
```

### `/api/glass` — merkealiaser
| Input | Kandidater |
|---|---|
| `VW`, `Volkswagen`, `vw` | 20 / 20 / 20 |
| `Mercedes`, `Mercedes-Benz` | 20 / 20 |
| `Toyota`, `TOYOTA` | 20 / 20 |

### `/api/glass` — determinisme
Tre identiske kall ga identisk `sha256 = f749bdc9d9249479`. Ingen syntetiske `firstSeenAt`/`lastSeenAt` i responsen. Kandidatfelt: `canonicalUrl`, `eurokode`, `skuFingerprint`, `varenavn`, `varenr`.

### NOK-prising og MVA
`GET /api/admin/pris-estimat?listepris=9980`:
```
sikkerhet     : BEKREFTET
grunnlag      : PRISTLISTE_NOK
kundePris     : 5490     (9980 × 0,60 = 5988 → nærmeste trinn 5490)
mva           : 1098     (25 % av 5490)
prisEksMva    : 4392
```

### Rate limit på kundehenvendelser
Fire POST ga `201`, femte ga `429` — grensen er 5 per IP per 10 minutter.

### Apify
| | |
|---|---|
| Actor | `finnbilglass-catalog` build **0.2.11** |
| Katalogadapter-tester | 8/8 pass |
| Produkter i staging-D1 | 50 (50 unike eurokoder) |

---

## 4. Katalogstatus

- **50** verifiserte produkter i staging (`apify_catalog_products`), idempotent import (re-import: 0 nye, 50 oppdatert).
- Full katalog = **4 621** URL-er fra `sitemap-guardian-en-products.xml`.
- 4 621 URL-er er **ikke** 4 621 unike SKU-er — dedupe skjer på `eurokode` + `varenr`.
- Skaleringsgater: 250 → 1 000 → 4 621. Hver gate krever godkjenning.
- EUR holdes i egne felt (`pris_eur`, `pris_valuta`); `pris` (NOK) er `NULL` for katalogprodukter uten bekreftet NOK-grunnlag.

---

## 5. Matchingsikkerhet

- `PINPOINT` brukes kun ved entydig treff (én kandidat) eller dokumentert override.
- Ukjente attributter forblir `UNKNOWN` — systemet gjetter aldri.
- HUD settes aldri fra katalogdata, eurokode eller kundebilde (kun kundesvar).
- Kameramodul, regnsensor og varmetråder krever kundebekreftelse eller OE-evidens.

---

## 6. Pris- og ordrestatus

| | |
|---|---|
| NOK-grunnlag | `prisliste` (BEKREFTET) og `faktura + påslag` (BEKREFTET) |
| Glavista EUR | **brukes ikke** i prismodellen |
| Fabrikkerte NOK-priser | ingen — `pris` er `NULL` der grunnlag mangler |
| Ordre | ingen automatisk ordreopprettelse; kundehenvendelse er slutten på flyten |

### ⚠️ Åpent funn: kundehenvendelser er ikke idempotente
Fire identiske POST til `/api/inquiry` ga fire rader i `beta_inquiries`. Beskyttelsen er kun per-IP rate limit (5/10 min). En dobbeltklikk eller nettverksretry lager dermed to saker i `/ops`.

**Anbefaling:** idempotency-nøkkel eller dedupe på `(regnr, kontakt, melding)` innenfor et tidsvindu. Krever Toms beslutning fordi det endrer kundevendt oppførsel.

---

## 7. D1-rekonsilieringsplan

Produksjon `finnbilglass-db`: **61 tabeller · 77 indekser · 18 ledger-rader**.

| Operasjon | Verktøy | Status |
|---|---|---|
| Ledger-backfill, 15 rader → 33 | `scripts/maintenance/ledger-backfill.mjs` | Testet på isolert D1. **Ikke kjørt i prod.** |
| 0019-indeksene (3 stk) | `scripts/maintenance/handling-c.mjs` | Testet: 60→62 tabeller, 77→83 indekser, rollback OK |
| 0034 `glass_catalog_multi` | samme | Testet. Ligger i `migrations/pending/` |
| 0020 `oem_probe_queue_fix` | — | **Blokkert som destruktiv** |
| 0037 | — | **Skal ikke kjøres** — kolonnene finnes allerede |

Verifisert: `integrity_check ok`, `foreign_key_check` 0 avvik på eksport.

### 0033 i staging — undersøkt
0033 oppretter **ingen** `inquiry_reply_history`-tabell. Den bygger `beta_inquiry_events` på nytt slik at `event_type` også tillater `'reply'`.

Staging har allerede effekten:
```
CHECK (event_type IN ('created','status','note','assignment','reply'))   ✓
idx_beta_inquiry_events_inquiry                                          ✓
```
**Ingen staging-reparasjon nødvendig.** Kun ledger-raden mangler (out-of-band-mønsteret).

---

## 8. Produksjonsdeployplan

1. Merge PR #6 til main med vanlig merge-commit
2. Verifiser at `[deploy]`-markør **ikke** finnes i commit → ingen automatisk deploy
3. Governed deploy via GitHub Actions `production`-environment med required reviewer
4. Post-deploy: `/health` 200, kundereise i prod, `deploy`-jobb ikke skipped
5. Rollback: `wrangler rollback` til forrige versjon

---

## 9. Pilotplan og stoppekriterier

**Omfang:** 10–20 inviterte kunder. Ikke åpen trafikk.

**Forutsetninger:**
- Sikre glassmatcher (`PINPOINT` eller manuell verifisering)
- Korrekt NOK-pris fra bekreftet grunnlag
- Fungerende kundehenvendelse → `/ops`
- Manuell verifisering ved `VERIFY`/`UNKNOWN`

**Stoppekriterier:**
| Signal | Handling |
|---|---|
| Feilbestilling oppdaget | Stopp pilot, varsle Tom |
| `WRONG_GLASS`-flagg i ledger | Stopp, gjennomgå |
| >5 % henvendelser uten gyldig pris | Stopp, gjennomgå prismodell |
| API-feil >1 % over 15 min | Rull tilbake |
| Kill switch aktivert | Pilot av |

---

## 10. Kostnad og overvåking

| Tjeneste | Kostnad |
|---|---|
| Cloudflare Workers/D1/R2 | inneværende plan |
| Apify Actor | per compute-unit — 50-kjøring er innenfor gratisnivå; 4 621 må kostnadsberegnes **før** godkjenning |
| LLM (vision/resolver) | gratisnivå (Gemini-lite, NVIDIA NIM) |

Overvåking: `/health`, Cloudflare Analytics, `beta_inquiry_events`, QA-feil per batch.

---

## 11. Rollback

| Nivå | Metode |
|---|---|
| Kode | `wrangler rollback` (Cloudflare beholder N versjoner) |
| Git | `git revert <merge-commit>` — branch protection blokkerer force-push |
| D1 skjema | `handling-c-rollback.sql` — verifisert 60 tabeller / 80 indekser |
| D1 data | D1 Time Travel + eksport tatt før hver operasjon |

---

## 12. Eksplisitte godkjenningspunkter

| # | Handling | Status |
|---|---|---|
| 1 | Merge PR #6 til main | ⏸ **Avventer Tom** |
| 2 | Backfill produksjons-D1 (15 → 33 ledger-rader) | ⏸ Avventer |
| 3 | Opprette 0019-indeksene i prod | ⏸ Avventer |
| 4 | Kjøre 0034 i prod | ⏸ Avventer |
| 5 | Produksjonsdeploy | ⏸ Avventer |
| 6 | Full Apify-crawl (4 621) | ⏸ Avventer |
| 7 | Starte begrenset kundepilot (10–20) | ⏸ Avventer |
| 8 | Pilot100 / Pilot1000 | ⏸ Egne senere godkjenninger |

### PR #2–#5 — anbefaling

Alle fire har merge-base `b773695` (20. august) og representerer en parallell arkitekturlinje main aldri adopterte. Main har **0 referanser** til `glass-selection`, `inquiry-commercial`, `customer-price-gate`, `voice-lab`, `glass-search`, `supplier-sku-evidence`, `email-ingest`.

| PR | Unikt innhold | Anbefaling |
|---|---|---|
| #2 | ~60 filer parallell arkitektur + 39 MB generert data | Lukk |
| #3 | `0003_catalogue_variant_identity.sql`, `release-a-public-contract` | Se under |
| #4 | Samme linje + P1-filer som er i #6 | Lukk |
| #5 | 4 filer, alle i #6 | Lukk |

**To elementer fra #3 krever din avgjørelse før lukking:**

1. **`0003_catalogue_variant_identity.sql`** — legger `UNIQUE(varenr, varenavn, eurokode, rad_type)` på `glass_prisliste` via DROP + RENAME. Direkte relevant for «ingen dupliserte SKU-identiteter», men destruktiv og vil feile hvis duplikater finnes i dag.

2. **`release-a-public-contract-2026-10-30.md`** — beskriver en **bevisst annen produktbeslutning**: offentlig søk skal returnere `MANUAL_REVIEW` med tomme kandidater, ingen eurokoder og ingen priser. Dette **strider mot** dagens `/api/glass`, som returnerer kandidater, eurokoder og NOK-pris til offentlig klient.

Punkt 2 er ikke en kodeendring — det er et produktvalg om hva som skal være synlig offentlig. Det må avklares før PR #3 kan lukkes som «erstattet».
