# Apify-katalog → staging D1: verifiserte resultater

**Dato:** 2026-10-31
**Omfang:** staging only. Ingen produksjonsdeploy, ingen produksjons-D1-skriving,
ingen full katalog-crawl, ingen Pilot100/1000.

---

## Bunnlinje

| Akseptansekriterium | Status | Bevis |
|---|---|---|
| 50/50 verifiserte produkter i Apify Cloud | **PASS** | 50 items, 50 unike `varenr`/`eurokode`/`url` |
| 50/50 produkter i staging D1 | **PASS** | `apify_catalog_products` = 50 rader, 50 unike eurokoder |
| Idempotent import (ingen duplikater) | **PASS** | Re-import: `inserted=0, updated=50` |
| Ingen fabrikkerte priser | **PASS** | `pris` (NOK) = NULL på alle 50; EUR-kilde i egne felt |
| Ingen secrets i kode/logger | **PASS** | Token kun i `.dev.vars` (gitignored) + Worker secret |
| Auth på admin-endepunkt | **PASS** | Uten Bearer → HTTP 401 |

---

## Hva var faktisk galt (og ble fikset)

Den første 50-kjøringen ga **46/50** produkter og ubrukelige prisdata. Tre reelle feil:

1. **HTTP 504 fra Glavista ble ikke retryet.** 4 av 50 URL-er falt ut stille
   (`2732ACCMVW2P`, `8648AGACMVZ1L`, `8409AGACMZ1L`, `8409AGAACMZ1L`).
   → `fetchWithRetry()`: 4 forsøk, eksponentiell backoff (2/4/8 s), 30 s timeout,
   retry kun på 408/425/429/5xx. Alle fire kom inn i neste kjøring.
2. **`pris` var hardkodet `0`** med kommentaren «Not available without login».
   Glavista *publiserer* en veil. utsalgspris i EUR — den ble bare aldri parset.
   → `parsePrice()` håndterer `486.25 €`, `1,487.38 €`, `1.487,38 €` og `525 €`.
3. **`url` var hardkodet `''`.** → URL sendes inn i `extractGlavistaProduct($, url)`.

I tillegg: oppsummeringen leste `dataset.getInfo().itemCount` som lå etter
(`itemCount: 48` mot reelt 50) → bruker nå `saved`-telleren som autoritativ og
logger avvik eksplisitt i stedet for å skjule det.

---

## Prspolicy — hvorfor `pris` er NULL

Glavistas pris er **veiledende utsalgspris i EUR**, ikke en norsk salgspris.
Å skrive 486,25 inn i et NOK-felt ville vært et fabrikkert tall.

| Kolonne | Innhold | Eksempel |
|---|---|---|
| `pris` | NOK **kun** når kilden er NOK | `NULL` (alle 50) |
| `pris_eur` | beløp nøyaktig som publisert | `486.25` |
| `pris_valuta` | valutaen i kilden | `EUR` |
| `pris_kilde` | opphav | `glavista_suggested_retail` |

49 av 50 sider publiserer en pris. `DW01835GBY` (Chevrolet Cruze USA) gjør det
ikke — den har verken pris eller OE-nummer på siden. `pris_eur = NULL` der er
korrekt gjengivelse av kilden, ikke en parsefeil.

## Identitetspolicy — hvorfor `vin_hash` er tom

Et katalogprodukt er ikke knyttet til et kjøretøy. Tidligere ble
`vin_hash = 'staging-' || eurokode` — en verdi som *ser ut som* en VIN-hash uten
å være det. Nå er `vin_hash = ''` for alle katalograder, og `eurocode` er nøkkelen.
Det er testet (`tests/apify-catalog-adapter.test.mjs`).

---

## Arkitektur: Apify-nøkkelen ligger ikke i Cloudflare

Apify CLI er autentisert med **OAuth**, det finnes ingen statisk API-token å
legge i en Worker-secret. I stedet for å be om en ny nøkkel er flyten snudd:

```
lokal:  apify datasets get-items <id>  →  items.json
lokal:  node scripts/apify-sync-to-staging.mjs items.json
              ↓ POST (Bearer APIFY_SYNC_TOKEN, chunk 20)
staging Worker: /api/admin/apify-catalog/sync → normaliser → upsert i D1
```

Worker-en har derfor **ingen Apify-legitimasjon**. `APIFY_TOKEN`-stien finnes
fortsatt i koden (for senere automasjon), men er ikke aktivert og svaret er en
eksplisitt 503 hvis den brukes uten nøkkel.

---

## Verifiserte tall

**Apify Cloud** — run `kq3I6uBayiSCiXbzF`, build `0.2.10`, datasett `2ylqNlnyocB33CgIx`:

```
items: 50   unique varenr: 50   unique eurokode: 50   unique url: 50
pris (NOK) satt: 0      pris_eur satt: 49      url satt: 50
EUR-spenn: 181.22 – 1487.38
```

**Staging D1** — `finnbilglass-db-staging` / `apify_catalog_products`:

```
rader: 50   unike_eurokoder: 50   pris_null: 50   tom_vin_hash: 50
min_eur: 181.22   max_eur: 1487.38
```

**Status-endepunkt** (`GET /api/admin/apify-catalog/status`):

```json
{"ok": true, "environment": "staging",
 "probes": [{"probe_id": "apify-catalog-50", "antall": 50,
             "med_eur_pris": 49, "med_url": 50}]}
```

**Idempotens** — samme 50 items sendt to ganger:

```
1. kjøring: inserted=50 updated=0  errors=0
2. kjøring: inserted=0  updated=50 errors=0
```

**Auth** — uten Bearer-token: `HTTP 401`.

**Testsuite** — `npm test`: 286 tester på 29 filer, **279 pass / 0 fail**
(7 skippet), inkludert 8 nye adapter-tester og `tsc --noEmit`.

---

## Reproduksjon

```bash
# 1. Kjør Actor (50 produkter)
npx apify call h0olts5L1xabAmLvO --input='{"limit":50}'

# 2. Hent datasettet
npx apify datasets get-items <DATASET_ID> --format json > /tmp/items.json

# 3. Send til staging
APIFY_SYNC_TOKEN=... node scripts/apify-sync-to-staging.mjs /tmp/items.json

# 4. Verifiser
curl -H "Authorization: Bearer $APIFY_SYNC_TOKEN" \
  https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev/api/admin/apify-catalog/status
```

---

## Endrede filer

| Fil | Endring |
|---|---|
| `actor-catalog.mjs` | retry, prisfelter, url, teller-fiks, 90 %-suksessgate |
| `.actor/actor.json` | `resume`-input (checkpoint) |
| `migrations/staging/0002_apify_catalog_products.sql` | `pris_eur`/`pris_valuta`/`pris_kilde`, brand-indeks |
| `scripts/apify-catalog-adapter.ts` | pris-/identitetspolicy, dedupe, ekte insert/update-tall |
| `scripts/apify-sync-to-staging.mjs` | ny: chunket klient for import-endepunktet |
| `src/routes/apify-catalog-sync.ts` | ny: admin-endepunkt (auth + items/dataset-modus) |
| `src/index.ts`, `src/types.ts` | ruting + env-typer |
| `tests/apify-catalog-adapter.test.mjs` | ny: 8 tester for policyene over |

---

## Separat funn: rød test på branchen (fikset)

`npm test` var rød før noen av Apify-endringene: `tests/kundetekster-p03.test.mjs`
test 8 krevde `EVIDENCE_STATUS_CHANGE_ENABLED = "false"` også i prod, men flagget
ble satt til `"true"` av Tom i `08b75a6` (sakslisten viste evidenssaker som NEW
etter REJECTED). Testen var altså utdatert, ikke koden.

Rettet til å matche faktisk, godkjent tilstand: prod = `"true"`, staging = `"false"`.
Ingen konfigurasjon ble endret — kun testen.

---

## Gjenstår (krever eksplisitt Tom-godkjenning)

- Merge til `main` / produksjonsdeploy
- Skriving til produksjons-D1
- Full katalog-crawl (4 621 URL-er i sitemapen — kun 50 er kjørt)
- Pilot100 / Pilot1000
- NOK-prising: `pris_eur` er ikke en salgspris. Krever valutakurs med dato
  eller prisfil, ikke en gjetning.
