# Apify — kjøreklar oppskrift (etter at Tom har logget inn)

**Blokkering nå:** `~/.apify/auth.json` har OAuth-profil `2mhzERe512CE7I1Br`
(`tomarnejensen`) med `expiresAt 2026-11-01T12:25Z`. Access-tokenet er utløpt,
refresh-tokenet er gyldig til 2026-12-31. API svarer `user-or-token-not-found`.

**Ett steg fra Tom:**

```bash
npx apify-cli login          # åpner nettleser, logger inn på tomarnejensen
```

Etter det kan alt under kjøres uten interaksjon.

---

## 1. Status kontroll (ingen kostnad)

```bash
TOK=$(security find-generic-password -s "com.apify.cli.token" -w)
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.apify.com/v2/acts/tomarnejensen~finnbilglass-price-import/runs?limit=5&desc=1" \
  | python3 -m json.tool | head -60
```

## 2. Kjøring (pilot, innenfor kostnadsrammen)

```bash
# Typekode-only pilot: 5 kategorisider, maks 10 produkter, hard limit i Actor
node scripts/apify-automation.mjs \
  --input-file=apify-typekode-only-input.json --wait
```

Skriptet poller til ferdig, validerer hard limits + typekode-only, estimerer
kostnad (CU → USD) og stopper på taket **$0,50**. Forrige 5-produkts kjørsel
kostet **$0,0023**.

## 3. Import til D1

`apify_catalog_products` finnes **ikke** i de kjørende basene. Migrasjonen
`migrations/staging/0002_apify_catalog_products.sql` må kjøres i **staging
først**, deretter:

```bash
node scripts/apify-sync-to-staging.mjs --dataset=<DATASET_ID>
```

Krav som allerede er innfridd i adapteren (`scripts/apify-catalog-adapter.ts`):
- full `eurokode` bevares (ingen prefiks-kutting), `variant_id` = `varenr:eurokode`
- `pris` (NOK) holdes `NULL` — Glavista EUR lagres i egne felt og brukes aldri som kundepris
- konflikter rapporteres, overskriver ikke bekreftede katalogdata

## 4. Kostnadsbilde

| Kjøring | Omfang | Målt kostnad |
|---|---|---|
| 5 produkter (build 1.0.18) | `apify-typekode-only-input.json` | **$0,0023** |
| 50 produkter (2026-10-31) | staging-verifisering | ikke målt i USD; kostnadstak $0,50 |
| Full 92-siders discovery | `apify-final-input.json` | **ikke kjørt** — må måles på pilot først |

Apify gratisplan dekker små kjøringer; ingen betalt utvidelse er nødvendig for
pilotene. Før full innsamling skal antall produkter, kostnadsanslag og mål
legges fram for Tom.
