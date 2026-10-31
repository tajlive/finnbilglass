# Main-integrasjon: sikkerhetsgate — verifisert

**Dato:** 2026-10-31
**Kandidat:** `review/produktlinje-merge-20261031` = **`fa8ab8f`**
**Status:** HOLD — `main` er ikke endret. Sign-off venter.

---

## 0. Kandidaten måtte endres: `a3c800b` feilet CI

Verifiseringen fant at forrige kandidat `a3c800b` **ville feilet test-gaten i CI**.

Testen `kundetekster-p03` test 8 krevde `EVIDENCE_STATUS_CHANGE_ENABLED = "false"`
i prod, mens flagget har vært `"true"` siden `08b75a6` (Tom-godkjent). Fiksen lå
bare i arbeidstreet, aldri i commiten — så den lokale testkjøringen var grønn mens
den pushes-klare commiten var rød.

Bevist ved å kjøre testen fra en ren checkout av `a3c800b`:

```
✔ 9. resolver uendret …
ℹ pass 8
ℹ fail 1
✖ 8. feature-flags uendret (review/status forblir av)
```

Rettet i egen commit `fa8ab8f` på toppen. Full kjede fra `fa8ab8f`:

```
278 tester · 271 pass · 0 fail · 7 skip
```

Dette er grunnen til at gaten finnes: en grønn lokal kjøring er ikke det samme som
en grønn commit.

---

## Status per punkt

| # | Krav | Status | Funn |
|---|---|---|---|
| 1 | Begge remote-only filer bevart og fungerende | **DELVIS** | `.gitleaks.toml` virker (1→0). `i18n-keys-audit.mjs` kjører, men sjekker ingenting |
| 2 | Forklar 278 vs 306 tester | **OK** | 28 = 8 Apify + 20 prising — ikke P1. **Men:** 7 P1-tester kjører aldri |
| 3 | Deploy-triggere, kandidaten kan ikke deploye | **OK** | Kun `[deploy]`-markør eller dispatch; tip har ingen markør |
| 4 | Produksjonsbeskyttelse | **OK** | Environment `production`: required reviewer, self-review blokkert, admin-bypass av |
| 5 | `origin/main` = `b773695` | **OK** | Verifisert før gjennomføring |
| 6 | Eksplisitt sign-off | **VENTER** | Kandidat `fa8ab8f` |
| 7 | Fast-forward uten force | **VENTER** | — |
| 8 | Actions + `/health` + ingen migrasjoner | **VENTER** | — |
| 9 | PR #6 oppdatert | **VENTER** | — |

---

## 1. De to remote-only filene

### `.gitleaks.toml` — bevart og fungerende

```
uten allowlist : 1 funn  (generic-api-key i scripts/selftest-rydd.mjs:60)
med allowlist  : 0 funn
```

Treffet var tabellnavnet `evidence_cases` (14 tegn) i en SQL-streng — falsk
positiv. Allowlisten fra remote fjerner det korrekt.

### `scripts/i18n-keys-audit.mjs` — bevart, men inert

```
$ node scripts/i18n-keys-audit.mjs
🔍 i18n-keys audit starter...
Fant 50 unike t()-nøkler i 70 kildefiler
⚠️  Ingen språkfiler funnet i locales/ — hopper over nøkkel-sjekk
EXIT=0
```

- Repoet har **ingen** `locales/`-mappe og **ingen** i18n-bibliotek
- Skriptet refereres **kun av seg selv** — ingenting kaller det
- Det finnes `t()`-kall i koden, men ingen språkfiler å verifisere mot

Skriptet er bevart og kjørbart, men utfører **ingen reell sjekk** i denne
arkitekturen. Det ble opprinnelig kalt fra remotes `smoke`-jobb, som ikke er tatt i
bruk. Bevar som dokumentasjon eller fjern — ikke en del av denne godkjenningen.

---

## 2. Hvorfor 278 vs 306 tester

| Branch | Tester | Pass | Skip |
|---|---|---|---|
| `review/produktlinje-merge-20261031` (`fa8ab8f`) | 278 | 271 | 7 |
| `feature/fbg-v1.0.14-p1-draft` | 306 | 299 | 7 |

Differansen er **nøyaktig 28**, fra to filer laget i denne økten:

| Fil | Tester | Hører til |
|---|---|---|
| `tests/apify-catalog-adapter.test.mjs` | 8 | PR #6 — Apify-katalogen |
| `tests/nok-prising.test.ts` | 20 | PR #6 — NOK-prising |

**Ikke senere P1-endringer.** De tilhører PR #6. Testfil-diff mellom branchene
bekrefter at ingen andre filer avviker.

### Separat funn: 7 P1-tester kjører aldri

`tests/p1-verify.test.ts` finnes på feature-branchen med 7 tester som **alle
passerer** ved manuell kjøring, men filen er ikke i `npm test`-kjeden:

```
✔ P1: Discovery returns deterministic pagination with cursor
✔ P1: Kandidat interface has all required fields
✔ P1: checkStopRules halts on errorCount > 50
✔ P1: checkStopRules halts on consecutive429s > 10
✔ P1: checkStopRules halts on qualityPassRate < 0.5
✔ P1: checkStopRules returns no halt when all checks pass
✔ P1: StopRuleResult includes errorTrigger field
ℹ tests 7 · pass 7 · fail 0
```

Reell, grønn dekning som aldri beskyttes av CI. P1-arbeid → **egen PR**, som du ba om.

---

## 3. Deploy-triggere på kandidaten

Workflows i treet: `deploy.yml` og `sync-b2b.yml` — ingen andre.

```
deploy.yml
  on: push → branches: [main]   +  workflow_dispatch
  deploy-jobb:
    if: workflow_dispatch || contains(head_commit.message, '[deploy]')
    environment: production        ← med required reviewer
```

| Sjekk | Resultat |
|---|---|
| Tip-commit | `fa8ab8f` «fix(test): kundetekster-p03 test 8 …» |
| `[deploy]` i tip | **Nei** |
| D1-kommandoer i CI | **Ingen** (`wrangler d1`, `migrations apply` = 0 treff) |
| `sync-b2b.yml` | dispatch + ukentlig cron, `D1_DATABASE: finnbilglass-db-staging` — staging |
| Produksjonsmigrasjoner | Kjøres aldri av CI |

**Pushen kan ikke utløse produksjonsdeploy eller prod-D1-skriving.**

Én commit i rekken (`665bc02`) har `[deploy]` i meldingen, men GitHub vurderer bare
tip-commit ved push.

---

## 4. Produksjonsbeskyttelse — konfigurert

Repoet er **public**, så required reviewers er tilgjengelig på gratis-planen.

```
environment: production
  protection rule     : required_reviewers
  reviewer            : tajlive
  prevent_self_review : true
  can_admins_bypass   : false
```

Produksjonsdeploy krever nå **både** `[deploy]`-markør/dispatch **og** manuell
godkjenning fra deg i GitHub. Admin-bypass er av.

### To funn du bør kjenne til

**Repoet er public** (`visibility: public`). Fast-forwarden publiserer hele
produktlinjen offentlig. `main` er allerede public i dag, men 72 commits med
produktkode blir synlige. Skal repoet lukkes, må det gjøres **før** pushen.

**`main` er ikke branch-protected** (`protected: false`). Nød-rollbacken er derfor
teknisk mulig, men det betyr også at en force-push mot main ikke stoppes av GitHub.
Anbefalt oppfølging: branch protection etter fast-forwarden.

---

## 5. `origin/main` før gjennomføring

```
origin/main = b77369593e5ef3ad865200404134d3941628b66d   ← MATCH, uendret
```

---

## Revert- og rollback-prosedyre

En sikkerhetsbranch lar deg **gjenfinne** gammel kode, men en tilbakestilling av
`main` er ikke nødvendigvis en fast-forward. Fire reelle veier:

### A. Én commit viser seg feil (mest sannsynlig)

```bash
git revert <sha>           # ny commit som opphever endringen
git push origin HEAD:main  # vanlig fast-forward
```
Historikken bevares, ingen force. Default-valget.

### B. Hele produktlinjen skal bort

**B1 — historikkbevarende revert (anbefalt):**
```bash
git revert --no-commit b773695..fa8ab8f
git commit -m "revert: rull tilbake produktlinjen til b773695"
git push origin HEAD:main
```
Konfliktrisiko i filer endret mange ganger. Koden ser ut som `b773695` igjen, men
historikken viser både innføringen og reverseringen.

**B2 — force-with-lease mot sikkerhets-tag (raskest, bryter historikken):**
```bash
git push --force-with-lease=main:fa8ab8f \
  origin safety/origin-main-20261031:refs/heads/main
```
**Ikke** en fast-forward. Krever din eksplisitte godkjenning. Alle som har hentet
`main` får divergens. Går teknisk fordi `main` ikke er beskyttet.

### C. Bare merge-operasjonen var problemet

```bash
git revert -m 1 8cd1290
```
`-m 1` = behold «vår» side. Angrer **de 5 remote-commitene** som kom inn via
mergen — ikke de 72 lokale. Riktig bare hvis det er de 5 som er feil.

### D. Uhell med deploy (ikke Git)

`npx wrangler rollback` ruller Worker-en til forrige versjon uten å røre Git.
Eget lag, uavhengig av A–C.

---

## Sign-off

Kandidat: **`fa8ab8f`** på `review/produktlinje-merge-20261031`.

```bash
git fetch origin review/produktlinje-merge-20261031
git rev-parse origin/review/produktlinje-merge-20261031                  # skal gi fa8ab8f…
git merge-base --is-ancestor origin/main origin/review/produktlinje-merge-20261031  # skal gi 0
git push origin origin/review/produktlinje-merge-20261031:refs/heads/main
```

Ingen `--force`. Etter push verifiseres: Actions (`deploy` skal være **skipped**),
`https://www.finnbilglass.no/health`, ingen nye migrasjoner, og PR #6 sin nye diff.

**Åpne spørsmål før gjennomføring:**

1. Repoet er public — tilsiktet, eller skal det lukkes først?
2. `0017`–`0027` er ikke kjørt mot prod-D1. De må kjøres manuelt i riktig
   rekkefølge før koden som trenger dem tas i bruk — utenfor denne godkjenningen.
