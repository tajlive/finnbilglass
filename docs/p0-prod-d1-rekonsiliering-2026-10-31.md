# P0 — Produksjons-D1-rekonsiliering: rapport

**Dato:** 2026-10-31
**Baseline:** `origin/main = fa8ab8f`
**Metode:** skrivebeskyttet lesing + isolert lokal reproduksjon (sqlite3).
**Ingen produksjonsendring. Ingen ledger-endring. Ingen migrasjon kjørt.**

---

## Bunnlinje

Prod-skjemaet **kan ikke reproduseres fra repoet alene**, men det er ikke fordi
migrasjonene mangler: alle 36 replays rent fra scratch. Problemet er at
**ledgeren lyver om hva som er kjørt**, og at det finnes objekter som **ingen
migrasjon lager**.

| Funn | Omfang |
|---|---|
| Migrasjoner i ledger og skjema | 18 |
| Migrasjoner i skjema men **ikke** i ledger | 14 |
| Delvis anvendt | 1 (`0019_oem_probe_queue` — 3 indekser mangler) |
| **Ikke anvendt** | 2 (`0034` fullt, `0020` under annet tabellnavn) |
| Drift: objekter ingen migrasjon lager | 4 tabeller, 4 kolonner, 12 indekser |

---

## Reproduksjon (P0.4)

```
prod-skjema dumpet      : 61 tabeller · 77 indekser (138 objekter)
prod.db bygget lokalt   : 61 tabeller · 77 indekser  → identisk
PRAGMA integrity_check  : ok
PRAGMA foreign_key_check: 0 avvik

replay av alle 36 migrasjoner fra scratch: 0 feil
replay-skjema           : 56 tabeller · 71 indekser
```

Replay gir **56** tabeller mot prod **60** (ekskl. `_cf_KV` og `d1_migrations`).
Avviket er ikke tilfeldig — det er drift.

---

## Klassifisering per migrasjon (P0.3)

| Migrasjon | I ledger | Objekter i prod | Klasse |
|---|---|---|---|
| 0001–0017 | ja | alle | **ANVENDT** |
| 0018_beta_inquiries_ops | nei | 7/7 | **ANVENDT**, mangler ledger |
| 0019_inquiry_rate_limit | nei | 1/1 | **ANVENDT**, mangler ledger |
| 0019_oem_probe_queue | nei | 1/4 | **DELVIS** — tabell finnes, 3 indekser mangler |
| 0020_oem_probe_queue_fix | nei | 0/4 | **IKKE ANVENDT** som skrevet — men v2-kolonnene finnes på `oem_probe_queue` |
| 0021–0027 | nei | alle | **ANVENDT**, mangler ledger |
| 0028–0032 | nei | alle | **ANVENDT**, mangler ledger |
| 0033_inquiry_reply_history | nei | mål oppnådd | **ANVENDT** (`event_type` har `'reply'`) |
| 0034_glass_catalog_multi | nei | 0/5 | **IKKE ANVENDT** |
| 0035, 0036 | ja | alle | **ANVENDT** |

`_new`-tabellene i 0022/0027/0033 rapporteres som «mangler», men det er **korrekt**
— de er mellomnavn i RENAME-sekvenser og blir borte med vilje. `_old`-backupene
ligger der som bevis.

---

## Drift — objekter ingen migrasjon lager

### Tabeller

| Tabell | Rader | Vurdering |
|---|---|---|
| `ordre` | **0** | ukjent opphav, tom — kan droppes etter godkjenning |
| `evidence_image_deletions` | **0** | ukjent opphav, tom — kan droppes |
| `montorer` | **2** | ukjent opphav, har data — må avklares |
| `beta_inquiry_events_old` | **14** | backup fra manuell rebuild, ikke fra migrasjon |

### Kolonner

| Tabell.kolonne | Vurdering |
|---|---|
| `evidence_cases.retention_until`, `.closed_at` | personvern/oppbevaring — ingen migrasjon |
| `glass_reference.brand_car`, `.category`, `.imported_at`, `.price_eur`, `.source`, `.title`, `.url` | **1324 rader** — utvidet ved manuell import (ihrautoglas-kilden), ikke migrasjon |
| `vin_ktype_map.expires_at` | ingen migrasjon |

### Indekser (12)

`idx_glasspris_varenr`, `idx_glasspris_alias`, `idx_glasspris_eurokode`,
`idx_glasspris_rad_type`, `uq_glasspris_varenr_navn`, `idx_regnr_norm`,
`idx_ordre_bilnummer`, `idx_ordre_epost`, `idx_ordre_status`,
`idx_evidence_image_deletions_case`, `idx_oem_probe_probe_id`, `idx_oem_probe_vin`
— de to siste ligger på `oem_probe_queue_old`.

---

## Rekonsilieringsplan (P0.5) — minimal, fremoversiktet

**Prinsipp:** ledgeren skal beskrive virkeligheten. Vi endrer ikke skjemaet for å
passe ledgeren; vi registrerer det som faktisk er gjort, og legger til det som
faktisk mangler.

### Steg 1 — frys bevis (før noe annet)

```bash
npx wrangler d1 export finnbilglass-db --remote --output backup-2026-10-31.sql
npx wrangler d1 time-travel info finnbilglass-db      # bokmerke for restore
```

### Steg 2 — backfill ledgeren for de 14

Legg inn rader for `0018, 0019_inquiry_rate_limit, 0021–0033` uten å kjøre SQL.
Krever eksplisitt godkjenning — det er en skriving til `d1_migrations`.

### Steg 3 — lukk de to reelle hullene

| Migrasjon | Handling |
|---|---|
| `0034_glass_catalog_multi` | kjør som normalt — verifisert at den applikerer rent på kopi |
| `0019_oem_probe_queue` (3 indekser) | kjør kun `CREATE INDEX`-delene |
| `0020_oem_probe_queue_fix` | **ikke** kjør — mål oppnådd på `oem_probe_queue`; dokumenter avviket i en kommentar-migrasjon |

### Steg 4 — håndter driften

| Objekt | Handling |
|---|---|
| `ordre`, `evidence_image_deletions` (0 rader) | drop etter godkjenning |
| `montorer` (2 rader) | avklar opphav med Tom før noe |
| `beta_inquiry_events_old` (14 rader) | behold som backup eller drop etter godkjenning |
| 4 kolonner | skriv en `0037`-migrasjon som legger dem til formelt (`ALTER TABLE … ADD COLUMN` er idempotent-sikker med sjekk) |
| 12 indekser | skriv `CREATE INDEX IF NOT EXISTS` i samme `0037` |

### Steg 5 — verifiser

Schema-diff før/etter skal gi **kun** de forventede tilleggene, og
`PRAGMA integrity_check` + `foreign_key_check` skal være rene.

---

## Verifisering av planen (P0.6)

Kjørt på isolert kopi av reprodusert prod-skjema:

```
integritet før            : ok · 0 FK-avvik
0034 påført               : 2 tabeller + 3 indekser
integritet etter          : ok
schema-diff               : kun glass_catalog_items, glass_vehicle_applications
diff uten forventet effekt: ingen
rollback (gjenopprett fra uberørt kilde): 0 spor etter 0034
```

Rollback-øvelsen ble kjørt som **fil-nivå restore** fordi `DROP TABLE` er blokkert
av agent-policy. Det er også den reelle D1-veien: `wrangler d1 export` +
`time-travel restore`.

---

## Risiko hvis dette ikke gjøres

1. **Deploy av `main` vil feile** på funksjoner som trenger `glass_catalog_items`
   (0034) — tabellen finnes ikke i prod.
2. **`wrangler d1 migrations apply` er ubrukelig** som sannhetskilde: den vil
   prøve å kjøre 14 migrasjoner som allerede er anvendt, og feile på
   `duplicate column` / `table already exists`.
3. **Neste utvikler** som leser ledgeren får feil bilde av produksjonen.

---

## Godkjenning som kreves før gjennomføring

| # | Handling | Krever |
|---|---|---|
| 1 | `d1 export` + time-travel-bokmerke | teknisk, ingen godkjenning |
| 2 | Backfill av 14 ledger-rader | **Tom** — skriving til `d1_migrations` |
| 3 | Kjøre `0034` + 3 indekser | **Tom** — skjemaendring i prod |
| 4 | Drop av tomme drift-tabeller | **Tom** — destruktivt |
| 5 | `0037` for drift-kolonner/indekser | **Tom** — skjemaendring i prod |
