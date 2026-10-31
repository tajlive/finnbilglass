# Git fast-forward: forberedelse og sign-off-grunnlag

**Dato:** 2026-10-31
**Beslutning:** A — bevar eksisterende Git-historikk
**Status:** forberedt. `main` er **ikke** endret. Ingenting er pushet til `main`.

---

## Bunnlinje — de ni stegene

| # | Steg | Status |
|---|---|---|
| 1 | Verifiser at origin/main er ancestor av lokal main | **FEILET — og det er selve funnet** |
| 2 | Sikkerhetsreferanse til dagens origin/main | **OK** — tag pushet |
| 3 | Review-branch, ikke main | **OK** — to brancher pushet |
| 4 | Samlet oversikt over de 72 commitene | **OK** — under |
| 5 | Push til main utløser ikke prod-deploy / D1-skriving | **OK** — verifisert |
| 6 | Diff + fast-forward-prosedyre til sign-off | **OK** — under |
| 7 | Utfør fast-forward etter Tom-godkjenning | **VENTER** |
| 8 | Oppdater PR #6 | **VENTER** (avhenger av 7) |
| 9 | Behold PR #2/#4/#5 | **OK** — urørt |

---

## 1. Ancestry feilet: historikken forgrenet seg

```
origin/main  b773695  ← ikke ancestor av lokal main
lokal main   d4c0cc1
merge-base   e209bb3  «fix: keep evidence upload disabled in production»
```

`git merge-base --is-ancestor origin/main main` → **exit 1**.

**Årsak:** etter `e209bb3` (2026-08-19) fikk `origin/main` 5 commits som den
lokale linjen aldri fikk. Den lokale linjen fortsatte i stedet med 72 commits som
løste de samme tingene på nytt.

De 5 som bare finnes på remote:

| Commit | Emne |
|---|---|
| `a344ef1` | Forside: ny h1, badge og undertittel |
| `5a25511` | gt-fixtures: komplett ground_truth-dump + terskel |
| `1c4d361` | prod: rydd UI — fjern «Ikke min bil» |
| `ac361f4` | CI: full deploy pipeline + defensiv L3T + i18n-audit |
| `b773695` | CI: gitleaks-config + SVV_API_KEY-håndtering |

**Konsekvens:** en rå `git push origin main` ville vært en **ikke-fast-forward** og
blitt avvist (eller krevd force push). En force push ville **slettet** disse 5
commitene og filene `.gitleaks.toml` og `scripts/i18n-keys-audit.mjs`, som ikke
finnes i den lokale linjen.

Derfor er prosedyren endret fra «fast-forward direkte» til «merge inn de 5, så
fast-forward». Historikken bevares i begge tilfeller, og ingen force push trengs.

---

## 2. Sikkerhetsreferanse

```
tag: safety/origin-main-20261031 → b77369593e5ef3ad865200404134d3941628b66d
```
Pushet til GitHub. Dagens `origin/main` kan alltid gjenopprettes derfra.

---

## 3. Brancher pushet (ingen main-endring)

| Branch | Innhold | SHA |
|---|---|---|
| `review/produktlinje-20261031` | rå produktlinje (lokal main, uten merge) | `d4c0cc1` |
| `review/produktlinje-merge-20261031` | produktlinjen + de 5 remote-commitene, konflikter løst | *tip (se over)* |

Den andre er den som kan fast-forwardes til `main`. Eksakt tip-SHA leses med
`git rev-parse origin/review/produktlinje-merge-20261031` — den står ikke her fordi
dokumentet selv endrer tip-en når det committes.

### Konfliktløsning (4 filer)

| Fil | Valg | Grunn |
|---|---|---|
| `public/app.js` | lokal | skiltnummer-terminologi (nyere) |
| `public/index.html` | lokal | «Ikke min bil» fjernet på begge sider, h1 identisk |
| `public/styles.css` | lokal | lokal har `.eller`-separator, remote har ingenting |
| `.github/workflows/deploy.yml` | lokal + gitleaks-steg | se under |

**deploy.yml — viktig:** remote-varianten har staging+prod-deploy, smoke og
auto-rollback, men **ingen `[deploy]`-port**. Den ville deployet til produksjon
ved *hver* push til main. Den er derfor ikke tatt i bruk. Lokal pipeline med
porten er beholdt, og gitleaks-steget fra remote er lagt inn i `security-check`
(ikke-blokkerende til allowlisten er verifisert).

Auto-rollback og staging-deploy fra remote-varianten er **ikke** tatt med. Det er
en reell forbedring som bør portes i egen commit bak samme port — foreslått som
oppfølgingsoppgave, ikke gjort implisitt her.

---

## 4. De 72 commitene

**Periode:** 2026-08-18 → 2026-08-20. **68 ikke-merges + 4 merges.**

| Type | Antall |
|---|---|
| `feat` | 29 |
| `fix` | 27 |
| `test` | 4 |
| `docs` | 4 |
| `chore` | 2 |
| `ci` | 1 |
| Logo-QA (uten prefiks) | 1 |

Temaer: ops/saksbehandling (23), evidence-flyt (7), SKU/approval (6),
UI/forside (8), selftest/betatest (5), migrasjoner (2), øvrig (21).

Alle er FinnBilGlass-produktutvikling. **Ingen fremmede prosjekter, ingen
eksperimenter, ingen WIP-commits** i listen.

### Migrasjoner (10 prod + 1 staging)

```
0017_beta_inquiries.sql
0018_beta_inquiries_ops.sql
0019_inquiry_rate_limit.sql
0021_manual_review_overrides.sql
0022_glass_marking_and_sku_decisions.sql
0023_glass_sku_attributes.sql
0024_opplaering_thumbnail.sql
0025_ai_observasjon_review.sql
0026_evidence_thumbnail.sql
0027_quality_events_fk_fix.sql
staging/0001_restore_catalogue_compatibility.sql
```

**Ingen av disse kjøres automatisk.** Se punkt 5.

### Produksjonspåvirkning (`wrangler.toml`)

| Endring | Effekt |
|---|---|
| `account_id = "80d5b1d5…"` | låser riktig konto — hindrer deploy til feil konto |
| `EVIDENCE_UPLOAD_ENABLED = "true"` | kundevendt bildeopplasting **på** i prod |
| `EVIDENCE_REVIEW_ENABLED = "false"` | review av |
| `EVIDENCE_STATUS_CHANGE_ENABLED = "true"` | statusendring på (Tom-godkjent i `08b75a6`) |
| `[observability.logs]` | lagring av, invocation_logs på |
| `run_worker_first` + `"/"` | **alle** rotforespørsler går gjennom Worker (ikke bare statisk asset) |

`bb7a4a4` («åpne prod-skrive-API») er token-beskyttet ops-skriving, 11 linjer —
ikke fitment-autoritet.

### Secrets

`gitleaks` over alle 68 commitene: **1 treff, 0 ekte.**

| Funn | Fil | Vurdering |
|---|---|---|
| `generic-api-key`, entropi 3,52, 14 tegn | `scripts/selftest-rydd.mjs:60` | **falsk positiv** — treffet er tabellnavnet `evidence_cases` i en SQL-streng |

Ingen nøkler, tokens eller passord i historikken. `.gitleaks.toml` (allowlist)
kommer nå med fra remote.

### CI/CD

- Eneste workflow på push til `main`: `deploy.yml`
- `sync-b2b.yml` = manuell + ukentlig cron, ikke push
- `deploy`-jobben krever `[deploy]` i **tip-commitens** melding eller manuell dispatch

---

## 5. Verifisert: push til main utløser ikke produksjon

| Sjekk | Resultat |
|---|---|
| CI kjører D1-kommandoer? | **Nei** — `grep` over `.github/` gir null treff på `wrangler d1`, `d1 execute`, `migrations apply` |
| Auto-deploy på push? | **Nei** — `if: … contains(head_commit.message, '[deploy]')` |
| Tip-commit ved push | `<tip-SHA>` «fix(scripts): seed-glass-sku-attributter …» — **ingen** `[deploy]`-markør |
| Kan prod-D1 skrives av CI? | **Nei** — ingen D1-kommandoer finnes i CI |

**Merk:** `environment: production` i `deploy.yml` gir **ingen** beskyttelse —
repoet har `total_count: 0` environments, altså null protection rules og ingen
required reviewers. `[deploy]`-markøren er eneste port. Anbefalt oppfølging:
legg på required reviewers på `production`-environmentet.

Én commit i rekken (`665bc02`) har `[deploy]` i meldingen, men GitHub vurderer
bare tip-commit ved push, så den utløser ingenting.

---

## 6. Diff som vil lande på main

```
95 filer endret, 6 236 innslag, 282 slettinger
```

| Katalog | Filer |
|---|---|
| `tests/` | 28 |
| `scripts/` | 21 |
| `src/` | 13 |
| `migrations/` | 11 |
| `docs/` | 7 |
| `public/` | 6 |
| `data/` | 5 |
| rot | 4 |
| `.github/` | 1 |

Største enkeltposter: `src/index.ts` (+610/−), `public/app.js` (+492/−),
`data/fixtures/self-test-50-cars.json` (+408), `src/fitment-v1/glass-sku.ts` (+296).

`data/glass-skus.json` (39 MB, 1,45 M linjer) er fjernet fra git i denne
forberedelsen — den var generert og regenereres byte-identisk.

---

## 7. Fast-forward-prosedyre (til sign-off)

Forutsetning: `review/produktlinje-merge-20261031` = `<tip-SHA>`, ancestry verifisert.

```bash
# 0. Sikkerhetsnett (allerede gjort, men verifiseres før kjøring)
git rev-parse origin/main                    # skal være b773695
git rev-parse safety/origin-main-20261031    # skal være samme

# 1. Hent review-branchen og verifiser ancestry
git fetch origin review/produktlinje-merge-20261031
git merge-base --is-ancestor origin/main origin/review/produktlinje-merge-20261031
echo "ancestor ok: $?"                        # skal være 0

# 2. Fast-forward main — uten force
git push origin origin/review/produktlinje-merge-20261031:refs/heads/main

# 3. Verifiser
git fetch origin main
git rev-parse origin/main                     # skal være 1ab8431
git log --oneline -3 origin/main
```

Ingen `--force`, ingen `--force-with-lease`. Pushen er en ren fast-forward fordi
`origin/main` er ancestor.

**Etterpå:**
- Actions: `deploy`-jobben skal være **skipped** (ingen `[deploy]` i tip)
- `origin/main` = `<tip-SHA>`
- PR #6 vil automatisk vise bare feature-committene (Apify + prising/E2E)

### Rollback hvis noe er galt

```bash
git push origin safety/origin-main-20261031:refs/heads/main
```
(Dette er den eneste situasjonen der en ikke-fast-forward kan bli nødvendig, og
den krever din godkjenning.)

---

## 8. Etter fast-forward — PR-opprydding

| PR | Branch | Plan |
|---|---|---|
| #6 | `feature/fbg-v1.0.14-p1-draft` | **behold** — blir de 4 tilsiktede feature-committene |
| #2 | `safety/sync-20261029-203324` | **behold** til innhold er sammenlignet |
| #4 | `feature/fbg-v1.0.14-full-catalogue-pipeline` | **behold** til sammenlignet |
| #5 | `feature/fbg-v1.0.14-p1-isolated` | **behold** til sammenlignet |

Ingen lukkes automatisk.

---

## 9. Anbefalte oppfølgingsoppgaver (ikke gjort)

1. Port staging-deploy + smoke + auto-rollback fra remote-varianten, **bak samme
   `[deploy]`-port**
2. Required reviewers på GitHub-environment `production`
3. Gjør gitleaks blokkerende etter at allowlisten er verifisert mot kjente
   falske treff
4. Sammenlign innholdet i PR #2/#4/#5 mot ny `main` før eventuell lukking
