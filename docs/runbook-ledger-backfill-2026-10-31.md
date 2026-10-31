# Kjøreplan — Handling B: ledger-backfill

**Status:** forberedt og testet. **Ikke kjørt mot produksjon.**
**Krever:** eksplisitt Tom-godkjenning per kjøring.

---

## Hva dette gjør

Produksjonen har 18 rader i `d1_migrations`, men **15 migrasjoner er anvendt i
skjemaet uten å stå i ledgeren**. Det gjør `wrangler d1 migrations apply`
ubrukelig som sannhetskilde — den vil prøve å kjøre migrasjoner som allerede er
kjørt.

Handling B registrerer de 15 radene. **Ingen skjemaendring. Ingen datapåvirkning
utenom `d1_migrations`.**

## De 15

```
0018_beta_inquiries_ops.sql              0025_ai_observasjon_review.sql
0019_inquiry_rate_limit.sql              0026_evidence_thumbnail.sql
0021_manual_review_overrides.sql         0027_quality_events_fk_fix.sql
0022_glass_marking_and_sku_decisions.sql 0028_inquiry_commercial.sql
0023_glass_sku_attributes.sql            0029_voice_lab.sql
0024_opplaering_thumbnail.sql            0030_voice_lab_tuning.sql
                                         0031_glass_reference.sql
                                         0032_glass_prisliste_lookup_indexes.sql
                                         0033_inquiry_reply_history.sql
```

**Aldri registreres:**

| Migrasjon | Grunn |
|---|---|
| `0019_oem_probe_queue` | delvis anvendt — tabell finnes, 3 indekser mangler |
| `0020_oem_probe_queue_fix` | `BLOCKED_DESTRUCTIVE` — sletter tabellen |
| `0034_glass_catalog_multi` | `PENDING` — ikke anvendt |

---

## Viktig: ingen BEGIN/COMMIT

Cloudflare D1 støtter ikke eksplisitt transaksjonsstyring gjennom
`wrangler d1 execute`. `--file` sender hele filen som **én batch**, som D1 gjør
atomisk selv. Skriptet har derfor ingen `BEGIN`/`COMMIT`, og en test feiler hvis
noen legger det inn.

## Idempotens — og hvorfor scriptet likevel nekter re-kjøring

`INSERT OR IGNORE` mot `UNIQUE(name)` gjør selve SQL-en idempotent. Men
`preflight` **avviser** kjøring hvis noen av de 15 allerede står i ledgeren.

Det er bevisst: en stille no-op ville skjult at ledgeren er endret siden
godkjenningen. Scriptet skal feile, ikke gjette.

---

## Prosedyre

### 1. Bevis og sikkerhetsnett (skrivebeskyttet)

```bash
npx wrangler d1 export finnbilglass-db --remote --output backup-$(date +%F-%H%M).sql
npx wrangler d1 time-travel info finnbilglass-db
```

Noter bokmerket. Uten dette ingen kjøring.

### 2. Preflight — fail-closed

```bash
node scripts/maintenance/ledger-backfill.mjs preflight \
  --database finnbilglass-db --expect-commit <godkjent-sha>
```

Sjekker og **avbryter** ved avvik:

- databasenavn mangler eller er feil
- tabellcount ≠ 60
- skjema-fingerprint ≠ `dfeb735a28690108…`
  (`_cf_KV` er D1s systemtabell og holdes utenfor)
- ledger ≠ 18 rader
- baseline-rad mangler, eller det finnes uventede rader
- noen av de 15 er allerede registrert
- noen av de 3 forbudte finnes i ledgeren
- git HEAD ≠ forventet commit

### 3. Kjøring — krever to bekreftelser

```bash
LEDGER_BACKFILL_APPROVED=1 node scripts/maintenance/ledger-backfill.mjs apply \
  --database finnbilglass-db --confirm finnbilglass-db --expect-commit <sha>
```

Produksjonsmålet krever **både** `--confirm finnbilglass-db` **og**
`LEDGER_BACKFILL_APPROVED=1`. Uten begge avvises kjøringen før noe sendes.
`apply` kjører alltid preflight på nytt først.

### 4. Etterkontroll

```bash
node scripts/maintenance/ledger-backfill.mjs verify --database finnbilglass-db
```

Forventet sluttilstand:

| Kontroll | Krav |
|---|---|
| `d1_migrations` | **33 rader** |
| Duplikater | **0** |
| De 15 | alle til stede |
| De 3 forbudte | **0** |
| Tabellcount | 60 — uendret |
| Skjema-fingerprint | uendret |
| Gjenstående for wrangler | kun `0019_oem_probe_queue.sql` |

---

## Rollback

| Nivå | Kommando | Rekkevidde |
|---|---|---|
| Ledger (målrettet) | `DELETE FROM d1_migrations WHERE name IN (…15…);` | kun de 15 radene |
| Database | `wrangler d1 time-travel restore <bokmerke>` | hele DB til bokmerke |
| Full | gjenopprett fra `d1 export`-filen | siste utvei |

Den målrettede slettingen er reversibel og rører ingen andre rader. Den krever
samme godkjenning som kjøringen.

---

## Verifisert på isolert D1 (2026-10-31)

Testet mot en ekte D1-database med produksjonens skjema og ledger, men **uten
kundedata**:

```
opprettet    : finnbilglass-ledger-test-041103
lastet inn   : 60 tabeller · 77 indekser · 18 ledger-rader
preflight    : OK (fingerprint dfeb735a28690108… matchet)
apply        : OK — gjennom wrangler d1 execute --remote, uten BEGIN/COMMIT
etterkontroll: 33 rader · 33 unike · 15 nye · 0 forbudte
wrangler     : kun 0019_oem_probe_queue.sql gjenstår
tabeller     : 60 — uendret
```

**Testdatabasen må slettes manuelt** (agent-policy blokkerer DB-sletting):

```bash
npx wrangler d1 delete finnbilglass-ledger-test-041103 --skip-confirmation
```

---

## CI

`tests/ledger-backfill.test.mjs` er **helt statisk** — leser SQL-filen og
konstantene, ingen nettverkskall. CI kan derfor aldri skrive til D1. Den
verifiserer:

- eksakt de 15 navnene, ingen flere
- ingen `BEGIN`/`COMMIT`
- `INSERT OR IGNORE`, ingen vanlig `INSERT`
- de 3 forbudte er ikke i filen
- databasevakten avviser produksjon uten begge bekreftelser
