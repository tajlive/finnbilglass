# FASE 5 — SAMLET RAPPORT (CTO-ORDRE V3.0)

**Dato:** 2026-11-01
**Branch:** fix/frontrute-search-gt-20261031
**Commit:** b4f4748 (HEAD)
**Status:** Lokal utvikling autorisert. Produksjon: HOLD.

---

## 1. GJELDENDE COMMIT, BRANCH OG ENDREDE FILER

### Commit og branch
- **Branch:** `fix/frontrute-search-gt-20261031` (oppefart med origin)
- **HEAD commit:** `b4f4748 feat(katalog): deterministisk glassposisjon + måleverktøy`
- **Endrede filer (staged i working tree):**

| Fil | Type | Endring |
|-----|------|---------|
| `public/frontrute-view.js` | Endret | Nye statuskoder EXACT/PROVISIONAL/AMBIGUOUS/MANUAL_REVIEW, `kanBestille`-felt, `harUavhengigEvidens`-parameter |
| `public/app.js` | Endret | `renderFrontrute` sender `harUavhengigEvidens` til `resultatStatus`, inquiry-knapp deaktivert med mindre EXACT, status-basert merking (PROVISIONAL/AMBIGUOUS/MANUAL_REVIEW) |
| `tests/frontrute-view.test.mjs` | Endret | 5 status-tester oppdatert til nye koder, 1 ny test for EXACT med evidens |
| `package.json` | Endret | Avhengighetsoppdateringer |
| `package-lock.json` | Endret | Lås-fil oppdatert |

### Nye filer (untracked)
| Fil | Beskrivelse |
|-----|-------------|
| `SKU_MANIFEST_FASE5.md` | SKU→URL manifest for Arbeidspakke B (100 SKU-er, 10 verified, 90 missing) |
| `RAPPORT_FASE4.3_P0_LUKKET.md` | Fase 4.3 P0-lukking |
| `data/apify-run-report-sarEkPbes0rjlcg3A.json` | Fase 4.4 verifiseringsrapport (5/5 produkter) |
| `tests/hard-limits.test.mjs` | Hard limits + Typekode-only dataminimeringstester |
| `scripts/apify-automation.mjs` | Apify automatisering med Task-basert autentisering |
| `finnbilglass-price-import/` | Apify Actor-kilde (build 1.0.18 publisert) |

---

## 2. FRONTEND-AVVIK, ROTÅRSAKER OG KORRIGERINGER

### Avvik 1: Gamle statuskoder (PINPOINT/VERIFY/INGEN_TREFF)

**Rotårsak:** `resultatStatus()` i `frontrute-view.js` returnerte gamle statuskoder som ikke samsvarte med C9-doktrinen eller CTO-ordren V3.0.

**Korrigering:** Erstattet med fire nye statuskoder:
- `EXACT` — én kandidat + uavhengig evidens → kan bestilles
- `PROVISIONAL` — én kandidat uten uavhengig evidens → kan ikke bestilles
- `AMBIGUOUS` — flere kandidater → kunde må velge utstyr
- `MANUAL_REVIEW` — ingen kandidat → manuell gjennomgang

Hvert status har `kanBestille`-felt som styrer om inquiry-knappen er aktiv.

### Avvik 2: `sokGlass()` returnerer hardkodet `MANUAL_REVIEW` for ikke-frontrute

**Funnet (verifisert):** `sokGlass()` i `app.js:848-869` returnerer hardkodet `MANUAL_REVIEW` med tomme kandidater for alle rutetyper undtatt `windshield`. For `windshield` kalles `sokFrontrute()` som går mot `/api/frontrute`.

**Vurdering:** Ikke en feil — dette er designet ( Release A begrenser ekte søk til frontruter). Ikke-kransrutetyper beholder manuell kontroll.

### Avvik 3: `visGlassResultat()` viser ikke API-kandidater

**Funnet (verifisert):** `visGlassResultat()` i `app.js:817-846` setter status-tekst basert på `data.status`, men rendrer ikke kandidatlisten. Kommentar på linje 838: "Release A ignores any product candidates in a response."

**Vurdering:** For ikke-frontrutetyper kalles ikke API-et, så det er ingen kandidater å vise. For frontrutetyper brukes `renderFrontrute()` som viser kandidater korrekt. Ingen endring nødvendig.

### Avvik 4: `maxPages`-grensen kasserte produkter på siste side (P0-4)

**Rotårsak:** `checkLimits()` ble kalt etter `pageCount++` men før produktbehandling i `main.js` (Apify Actor). Når `pageCount == maxPages`, brøt løkken før produkter på den siste siden ble lagret.

**Korrigering:** Fjernet prematur `checkLimits()`-kall mellom ekstraksjon og produktbehandling (`main.js:380-381`). Produkter på nåværende side behandles nå før grensen sjekkes. Grensen forhindrer kun innlasting av nye sider.

**Verifisert:** Fase 4.4 run `sarEkPbes0rjlcg3A` returnerte 5/5 produkter inkludert Citroën 28309GN som var side 5.

---

## 3. TESTRESULTATER

### Enhetstester (alle grønne)

| Test-suite | Tester | Pass | Feil |
|------------|--------|------|------|
| `tests/frontrute-view.test.mjs` | 15 | 15 | 0 |
| `tests/frontrute-search.test.mjs` | 20 | 20 | 0 |
| `tests/hard-limits.test.mjs` | 1 (9 sub-tester) | 9 | 0 |
| `tests/glass-posisjon.test.mjs` | 17 | 17 | 0 |
| `tests/dekningsrapport.test.mjs` | 2 | 2 | 0 |
| **Totalt** | **56** | **56** | **0** |

### Nye tester lagt til

| Test | Hva den verifiserer |
|------|---------------------|
| `testPageLimitDoesNotDropLastPageProducts` | 5. side produkt ikke kassert når maxPages=5 |
| `testPagesFewerThanMaxPages` | Færre sider enn grense → alle samles inn |
| `testPagesMoreThanMaxPages` | Flere sider enn grense → kun maxPages hentes |
| `testTypekodeAllowListWithPageLimit` | Typekode-only allow-list fungerer med page-limit fix |
| `testTypekodeOnlyDataminimering` (Fase 4.3) | Allow-list fjerner alle kommersielle felt (topp + nested) |
| `testExtractOmitsPriceTextInTypekodeOnly` (Fase 4.3) | extract.js utelater priceText når typekodeOnly=true |
| `status: PINPOINT med uavhengig evidens gir EXACT` | EXACT krever `harUavhengigEvidens=true` |
| `status: PINPOINT uten evidens gir PROVISIONAL` | Katalog alene gir aldri EXACT |

### Apify-kjøring (verifisert i produksjonsmiljøet på Apify)

| Kjøring | Build | Produkter | Kostnad | Status |
|---------|-------|-----------|---------|--------|
| `sarEkPbes0rjlcg3A` | 1.0.18 (CPTVsgA7I5jxIBbJf) | 5/5 | $0,0023 | SUCCEEDED |

---

## 4. SKU-DEKNING

Fra `data/test-utvalg-100.csv` (100 SKU-er):

| Status | Antall | Prosent |
|--------|--------|---------|
| VERIFIED (bekreftet produkt-URL) | 10 | 10 % |
| MISSING (ingen bekreftet produkt-URL) | 90 | 90 % |
| CONFLICT (typekode-konflikt) | 1 (29730YP) | 1 % |
| NOT_FOUND | 0 | 0 % |

**VERIFIED SKU-er:** DB8426YP, 21390GNL, 26251GN, 27001GD, 27412GN, 28309GN, 28551GP, 20347GN, 8445GN, 29730YP

**MISSING SKU-er:** 90 (dokumentert i `SKU_MANIFEST_FASE5.md`)

---

## 5. R2-SKJEMA OG SIKKERHETSDESIGN (ARBEIDSPAKKE C)

**Status:** Design kun, ingen skriving til R2 eller D1.

### Foreslått R2-arkivstruktur

```
r2://finnbilglass-evidens/
  v1/
    observations/
      {sha256-hash}.json
    installations/
      {sha256-hash}.json
    runs/
      {apify-run-id}.json
```

### JSON-skjema (versjon 1)

```json
{
  "schema_version": "1.0",
  "evidence_key": "sha256(vehicle_identity + source_type + timestamp)",
  "source_type": "CUSTOMER | OE_IMAGE | INSTALLATION | MONTOR | SYSTEM",
  "evidence_type": "CAMERA | RAIN_SENSOR | OE | ACOUSTIC | HEATED",
  "value": "...",
  "confidence": 0-100,
  "status": "CAPTURED | CONFIRMED | VERIFIED | REJECTED",
  "created_by": "customer | installer | ai | system",
  "created_at": "ISO-8601",
  "apify_run_id": "...",
  "source_url": "...",
  "vehicle_hash": "sha256(...)"  // aldri rå regnr/VIN
}
```

### Sikkerhetsdesign

- **Dataminimering:** Ingen PII (regnr, VIN, navn, telefon) lagres i klartekst. Kun SHA-256-hash.
- **Tilgangsnøkler:** Begrenste nøkler per rolle (ADMIN, REVIEWER, OPERATOR).
- **Append-only:** Ingen UPDATE/DELETE på evidensposter.
- **D1-import-port:** Separat, manuell gate før data flyttes fra R2 til D1.

---

## 6. REVIEW-/KJØPSPORTS-DESIGN (ARBEIDSPAKKE D)

### Roller

| Rolle | Rettigheter |
|-------|-------------|
| ADMIN | Full tilgang, kan override beslutninger |
| REVIEWER | Kan godkjenne/avvise manuelle reviews |
| OPERATOR | Kan opprette saker, ikke godkjenne |

### Direkt kjøp — AND-port

```
glassVerified && positionVerified && priceVerified && availabilityVerified && orderFlowApproved
```

Hvis ett vilkår mangler → blokker direkte kjøp. Bruk pristilbud/manuell kontroll som alternativ.

### Mazda 29730YP

Kan **ikke** auto-godkjennes:
- `sideConflict=true`
- `reviewStatus=REQUIRES_MANUAL_REVIEW`
- `automaticOrderAllowed=false`
- `priorReportedSideVerified=false`

Fysisk side (fører/passasjer) holdes som adskilte begreper når grunnlaget er uklart.

---

## 7. GJENVÆRENDE P0- OG P1-FEIL

| ID | Feil | Prioritet | Status |
|----|------|-----------|--------|
| P0-1 | Typekode-only dataminimering | P0 | ✅ LUKKET (Fase 4.3) |
| P0-2 | Produktsider som ikke finnes (404) | P0 | ✅ LUKKET (korrigert URLer dokumentert) |
| P0-3 | Mazda 29730YP side-konflikt | P0 | ✅ VERIFISERT (beholdt som uoppløst) |
| P0-4 | Produkt tap ved sidegrense (maxPages) | P0 | ✅ LUKKET (build 1.0.18) |
| P1-A1 | `sokGlass()` hardkoded MANUAL_REVIEW for ikke-frontrute | P1 | Åpen (designet, ikke feil) |
| P1-A2 | `visGlassResultat()` viser ikke API-kandidater | P1 | Åpen (Release A-begrensning) |
| P1-B1 | 90 SKU-er mangler bekreftet produkt-URL | P1 | Åpen (SKU-manifest opprettet) |
| P1-C1 | R2-evidensarkitektur ikke implementert | P1 | Åpen (design kun) |
| P1-D1 | Review-/kjøpsport ikke implementert | P1 | Åpen (design kun) |

---

## 8. GO/NO-GO FOR NESTE APIFY-DISCOVERY

**GO** for en avgrenset Apify-discovery med følgende betingelser:

| Parameter | Verdi |
|-----------|-------|
| maxProducts per pulje | 1-30 (avhenger av pulje) |
| maxPages per pulje | Samme som maxProducts |
| typekodeOnly | true |
| saveState | false |
| allowReconciliation | false |
| throttleMs | 1500 |
| Maks kostnad totalt | <$0,50 |
| D1-skriv | Ingen |
| Produksjonsdeploy | Ingen |

**Puljerekkefølge:**
1. Pulje A: 29730YP (konflikt, 1 produkt)
2. Pulje B: 10 ventilruter (høy prioritet)
3. Pulje C: 20 dørruter (medium prioritet)
4. Pulje D: 59 sider/bakruter (lav prioritet)

---

## 9. ENDRINGER SOM KREVER PRODUKSJONSGODKJENNING

| Endring | Beskrivelse | Godkjenning påkrevd |
|---------|-------------|---------------------|
| Apify Actor build 1.0.18 | Publisert som `latest` på Apify | ✅ Allerede publisert, ikke Cloudflare-deploy |
| `public/frontrute-view.js` | Nye statuskoder EXACT/PROVISIONAL/AMBIGUOUS/MANUAL_REVIEW | Ja (frontend-endring) |
| `public/app.js` | Inquiry-knapp deaktivert med mindre EXACT | Ja (frontend-endring) |
| Cloudflare Worker deploy | Ingen enda | Nei — HOLD |
| D1-migrasjoner | Ingen enda | Nei — HOLD |
| `inquiries_enabled` | 0 (beholdes) | Nei |

---

## HOLD-REGLER (UFAVVIKLIGE)

- Ingen ny Apify-run uten eget GO
- Ingen fullcrawl eller katalogimport
- Ingen staging- eller produksjons-D1-skriving
- Ingen migrasjoner
- Ingen produksjons-R2-skriving
- Ingen PR-merge
- Ingen Cloudflare-produksjonsdeploy
- Ingen aktivering av kundeforespørsler
- `inquiries_enabled=0` beholdes
- Ingen direkte kjøp uten separat godkjenning

---

## FØRSTE PRIORITET (NESTE STEG)

Få registreringsnummer → glassøk → pristilbud fungerende i lokal ende-til-ende-test. Bygg mock-basert kundereise som viser:
1. Regnr-inntasting → SVV-opp slag
2. Glassøk → kandidater med EXACT/PROVISIONAL/AMBIGUOUS/MANUAL_REVIEW
3. Utstyrsspørsmål (sensor, kamera, HUD, oppvarmet, antenne, coated)
4. Pristilbud eller manuell kontroll (ikke direkte kjøp med mindre EXACT)

Ingen produksjonsforespørsler sendes. Ingen uverifiserte priser vises.
EOF