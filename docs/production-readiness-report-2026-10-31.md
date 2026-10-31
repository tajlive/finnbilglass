# Production Readiness Report — FinnBilGlass

**Dato:** 2026-10-31
**Baseline:** `origin/main = fa8ab8f` · arbeidsbranch `33b8ce8`
**Status:** P1 ferdig. P2 plan klar. P3 ikke påbegynt (krever Tom per operasjon).

---

## 1. P1 — Ferdigstill PR #6

| # | Krav | Status | Bevis |
|---|---|---|---|
| 1 | Actions på Draft PR-er | **OK** | `.github/workflows/pr-verify.yml`, trigget og grønn |
| 2 | Eksakt-commit verifisering | **OK** | GitHub-run 41159325431 på `33b8ce8`: **success** |
| 3 | Regresjon Apify/pris/kø/matching/kundereise | **OK** | 313 tester · 306 pass · 0 fail + live staging |
| 4 | Sikkerhets-/scope-gjennomgang | **OK** | 0 hemmeligheter, 3 nye pakker, 1 ubrukt |
| 5 | PR #2/#3/#4/#5 mot ny main | **OK** | se 1.4 |
| 6 | Testresultater dokumentert | **OK** | denne rapporten |

### 1.1 CI på pull requests

```
name: PR Verification
on: pull_request [opened, synchronize, reopened, ready_for_review] + dispatch
jobs.verify: checkout → npm ci → tsc --noEmit → npm test → hemmelighetsfil-sjekk
```

Bevisst **uten** `environment:` og **uten** `secrets` — en PR kan ikke nå Cloudflare.
Første kjøring: `41159325431` → **success**.

### 1.2 Testresultater (eksakt commit `33b8ce8`)

| Kjøring | Tester | Pass | Fail |
|---|---|---|---|
| GitHub Actions (PR) | 313 | 306 | **0** |
| Lokalt, ren checkout | 313 | 306 | **0** |

Økningen fra 306 → 313 er `tests/p1-verify.test.ts` som nå er i kjeden (`test:p1-verify`).

### 1.3 Live regresjon mot staging

| Flate | Resultat |
|---|---|
| Kundereise (regnr → bil → glass → pris → henvendelse) | **4/4 steg**, inquiry 65 |
| Apify-katalog | 50 produkter · 49 med EUR-pris · 50 med URL |
| NOK-prising | kundePris 5 490 · `BEKREFTET` · mva 1 098 |
| `/api/glass` | HTTP 200 |

### 1.4 Sikkerhets- og scope-gjennomgang av PR #6

**Hemmeligheter:** `gitleaks` over 11 commits med allowlist → **0 funn**.

**Nye avhengigheter:**

| Pakke | Versjon | Vurdering |
|---|---|---|
| `apify` | ^3.7.2 | nødvendig — Actor-runtime |
| `apify-cli` | ^1.11.0 | devDependency, kun CLI |
| `crawlee` | ^3.18.2 | **ubrukt** — ingen import finnes |
| `tsx` | ^4.23.12 | flyttet til dependencies — nødvendig i Actor-containeren |

**Scope:** 29 filer, +12 034/−976. Alt innenfor Apify-katalog, NOK-prising, CI og dokumentasjon. `src/index.ts` er +31 linjer (ruting) — resten av index-endringene ligger allerede i main.

**Anbefaling:** fjern `crawlee` (ubrukt, stor). Egen liten commit, endrer ikke funksjonalitet.

### 1.5 PR #2, #3, #4, #5 mot ny `main`

| PR | Branch | Foran main | Bak main | Unike filer |
|---|---|---|---|---|
| #2 | `safety/sync-20261029-203324` | 19 | 5 | 195 |
| #3 | `release/release-a-p05-20261030` | 20 | 5 | 196 |
| #4 | `feature/fbg-v1.0.14-full-catalogue-pipeline` | 21 | 5 | 200 |
| #5 | `feature/fbg-v1.0.14-p1-isolated` | **1** | 10 | **4** |

**#5 er i praksis ferdig** — 1 commit, 4 filer foran main. Bør gjennomgås og lukkes/merges.

**#2/#3/#4 bærer 11 migrasjonsfiler som `main` mangler** — se 2.1. Det er den viktigste avhengigheten.

---

## 2. P2 — Produksjonsberedskap

### 2.1 Kritisk funn: `main` mangler 11 migrasjonsfiler som er anvendt i prod

```
Kun på søsterbrancher (#2/#3/#4), IKKE på main:
0019_oem_probe_queue      0028_inquiry_commercial    0032_glass_prisliste_lookup_indexes
0020_oem_probe_queue_fix  0029_voice_lab             0033_inquiry_reply_history
0031_glass_reference      0030_voice_lab_tuning      0034_glass_catalog_multi
                          0035_inquiry_glass_request 0036_glass_search_snapshots
```

Ti av disse er **allerede anvendt i produksjon** (`d1_migrations` har 0035 og 0036;
0028–0033 finnes i skjemaet uten ledger-rad). `main` kan derfor ikke bygge
produksjonsskjemaet — og en fremtidig `migrations apply` fra `main` vil mangle
SQL for tabeller koden allerede bruker.

**Dette må løses før rekonsiliering**, ellers reparerer vi prod mot et ufullstendig repo.

### 2.2 De 14 ledger-avvikene — mapping med bevis

Hver rad er koblet til konkrete objekter som beviser skjemaeffekten.

| Migrasjon | Bevis i prod-skjema |
|---|---|
| `0018_beta_inquiries_ops` | `beta_inquiries.{status,assigned_to,updated_at,vehicle_json}` + tabell `beta_inquiry_events` + 2 indekser |
| `0019_inquiry_rate_limit` | tabell `inquiry_rate_limits(ip, window_start, count)` |
| `0021_manual_review_overrides` | tabell + `idx_mro_make_model`, `idx_mro_vin` |
| `0022_glass_marking_and_sku_decisions` | `evidence_case_images_old` finnes (RENAME-sekvens) + `case_sku_decisions` + `'glass_marking'` i CHECK |
| `0023_glass_sku_attributes` | tabell + `idx_gsa_eurocode` |
| `0024_opplaering_thumbnail` | `opplaering_bilde.thumb_r2_key` |
| `0025_ai_observasjon_review` | tabell + `idx_aor_bilde`, `idx_aor_created` |
| `0026_evidence_thumbnail` | `evidence_case_images.thumb_r2_key` |
| `0027_quality_events_fk_fix` | `evidence_case_image_quality_events_old` finnes + FK peker på `evidence_case_images` |
| `0028_inquiry_commercial` | `inquiry_commercial_events` |
| `0029_voice_lab` | `voice_sessions`, `voice_drafts` |
| `0030_voice_lab_tuning` | kolonner i `voice_sessions`/`voice_drafts` |
| `0031_glass_reference` | tabell `glass_reference` |
| `0033_inquiry_reply_history` | `beta_inquiry_events.event_type` CHECK inneholder `'reply'` |

### 2.3 Særskilt: `0019_oem_probe_queue` (delvis)

Tabellen finnes. **Tre indekser mangler:** `idx_oem_probe_portal`,
`idx_oem_probe_status`, `idx_oem_probe_vin_hash`.

Prod har i stedet `idx_oem_probe_probe_id` og `idx_oem_probe_vin` — men de ligger på
**`oem_probe_queue_old`**, ikke på den aktive tabellen. Aktive `oem_probe_queue`
har bare autoindex fra `probe_id UNIQUE`.

**Reparasjon (forslag, ikke kjørt):**
```sql
CREATE INDEX IF NOT EXISTS idx_oem_probe_portal   ON oem_probe_queue(portal);
CREATE INDEX IF NOT EXISTS idx_oem_probe_status   ON oem_probe_queue(status);
CREATE INDEX IF NOT EXISTS idx_oem_probe_vin_hash ON oem_probe_queue(vin_hash);
```
Ikke-destruktivt, men skjemaendring i prod → krever egen godkjenning.

### 2.4 Særskilt: `0020_oem_probe_queue_fix`

Migrasjonen lager `oem_probe_queue_v2`, som **ikke** finnes. Men prod har alle
v2-kolonnene (`cost_eur`, `latency_ms`, `vilkar_lagring_ok`, `status`, `queried_at`,
`decision`, `notes`, `created_at`) på **`oem_probe_queue`**.

Effekten er oppnådd under et annet tabellnavn. **Ingen handling anbefalt** utover en
kommentar-migrasjon som dokumenterer avviket. Å kjøre 0020 ville laget en duplikat­tabell.

### 2.5 `0034_glass_catalog_multi` — ikke anvendt

To tabeller mangler: `glass_catalog_items`, `glass_vehicle_applications` (+3 indekser).

Verifisert på isolert kopi av reprodusert prod-skjema:
```
påført  : 2 tabeller + 3 indekser
integritet: ok
schema-diff: kun de to tabellene, ingen utilsiktede slettinger
rollback : gjenoppretting fra uberørt kilde gir 0 spor
```
Ikke-destruktivt (kun CREATE), men skjemaendring → egen godkjenning.

### 2.6 `0037` — forslag for ikke-migrert drift

Fil: `migrations/proposed/0037_schema_drift_reconcile.sql.proposed`
(bevisst `.proposed` + egen mappe, så `migrations apply` ikke plukker den opp).

Innhold: 10 kolonner + 7 indekser som finnes i prod men ikke i repoet.
`idx_ordre_*` er utelatt til `ordre` er avklart.

### 2.7 Avhengighetssjekk før sletting

Søkt i hele kodebasen (`src/`, `scripts/`, `tests/`, `migrations/`):

| Tabell | Kode-referanser | Rader | Anbefaling |
|---|---|---|---|
| `ordre` | **0** | 0 | Ikke slett. Ukjent opphav — formaliser eller la stå |
| `evidence_image_deletions` | **0** | 0 | Ikke slett. Navnet tilsier **revisjonsspor for bildesletting** (personvern). Selv tom er den en kapabilitet |
| `montorer` | **0** | 2 | Ikke slett. Har data og er nevnt i `/ops`-copy som «kommer i neste fase» |
| `beta_inquiry_events_old` | 0 | 14 | Backup fra manuell rebuild — behold til 0018-beviset er formelt |

**Ingen sletting anbefales i denne runden.** Tom hadde rett: 0 rader ≠ ubrukt.

### 2.8 Backup og restore — testet

Kjørt på **staging**, ikke prod:

```
wrangler d1 export finnbilglass-db-staging --remote
  → 150 MB · 36 s · 53 CREATE TABLE · 566 456 INSERT

gjenoppretting i isolert sqlite3:
  → 55 tabeller · PRAGMA integrity_check = ok
  → glass_prisliste 29 629 rader · apify_catalog_products 50 rader
```

Prosedyren virker. For prod brukes samme kommando mot `finnbilglass-db` pluss
`wrangler d1 time-travel info` som bokmerke.

### 2.9 Deployplan med godkjenningsporter

```
1. [Tom] Godkjenn hver D1-operasjon separat (ingen samle-godkjenning)
2. [Tom] `d1 export` + time-travel-bokmerke tas og verifiseres
3. [Tom] Ledger-backfill (14 rader) ELLER 0037 — én operasjon om gangen
4. [Tom] 0034 + 0019-indeksene
5. CI: alle gater grønne på main
6. [Tom] Deploy via workflow_dispatch → manuell godkjenning i environment `production`
7. Verifiser: /health, /api/frontrute, /api/inquiry, ingen nye feil i logg
8. Rollback klar: `wrangler rollback` (Worker) + `time-travel restore` (D1)
```

Ingen av stegene kjøres automatisk.

---

## 3. Produksjonsrisiko

| Risiko | Nivå | Merknad |
|---|---|---|
| Deploy av `main` feiler på `glass_catalog_items` (0034) | **Høy** | Tabellen finnes ikke i prod |
| `migrations apply` fra `main` feiler | **Høy** | 14 allerede anvendt + 11 filer mangler |
| `crawlee` blåser opp CI-install | Lav | Ubrukt pakke |
| Drift-tabeller uten migrasjon | Middels | Reproduserbarhet, ikke runtime |
| Prod svarer 200 og er uendret | — | Ingen aktiv hendelse |

---

## 4. Rollback

| Lag | Kommando | Rekkevidde |
|---|---|---|
| Worker | `npx wrangler rollback` | forrige versjon, uten Git |
| D1 skjema | `wrangler d1 time-travel restore <bookmark>` | database til bokmerke |
| D1 manuell | gjenopprett fra `d1 export`-fil | full kontroll |
| Git main | `git revert --no-commit fa8ab8f..<tip>` | historikkbevarende |
| Git main (nød) | force mot `safety/origin-main-20261031` | krever at branch protection fjernes |

`DROP TABLE` er blokkert av agent-policy — destruktive operasjoner må kjøres av Tom.

---

## 5. Handlinger som krever Tom — hver for seg

| # | Handling | Risiko | Krever |
|---|---|---|---|
| 1 | Importere de 11 manglende migrasjonsfilene til `main` | lav (kun filer) | godkjenning |
| 2 | Fjerne ubrukt `crawlee` fra package.json | lav | godkjenning |
| 3 | Backfill av 14 ledger-rader | middels | **egen godkjenning** |
| 4 | Kjøre `0034` + `0019`-indeksene | middels | **egen godkjenning** |
| 5 | Kjøre `0037` (drift-kolonner/indekser) | middels | **egen godkjenning** |
| 6 | Sletting av drift-tabeller | høy | **egen godkjenning + risikovurdering** (anbefales ikke) |
| 7 | Produksjonsmigrering av `0017`–`0027` | høy | **egen godkjenning** |
| 8 | Produksjonsdeploy | høy | **egen godkjenning** |
| 9 | Full katalogimport (4 621 URL-er) | høy | **egen godkjenning** |
| 10 | Pilot100/1000 | høy | **egen godkjenning** |

**Ingen samle-godkjenning.** Ingen av disse er utført.
