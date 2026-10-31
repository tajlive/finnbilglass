# Final main-integration gate — sikkerhetsporter oppfylt

**Dato:** 2026-10-31
**Kandidat:** `fa8ab8f` (`fa8ab8f2dca7cf36a4966d618e11f131086505d2`)
**Beslutning:** BETINGET GO — porter oppfylt, venter på Toms sign-off på selve main-oppdateringen.

---

## Porter

| # | Krav | Status | Bevis |
|---|---|---|---|
| 1 | `fa8ab8f` beholdes, `a3c800b` forkastes | **OK** | Kandidat uendret |
| 2 | GitHub-plan + effekt av private | **OK** | Plan ikke lesbar via token; GitHubs dokumentasjon er entydig — se under |
| 3 | Eksplisitt godkjenning også ved privat repo | **OK** | `[deploy]`-porten er planuavhengig |
| 4 | `prevent-self-review` låser ikke ute | **FIKSET** | Satt til `false` — ellers deadlock med én bruker |
| 5 | Branch protection mot force-push/sletting | **OK** | Begge av, gjelder også admins |
| 6 | CI på eksakt `fa8ab8f` | **OK** | tsc 0 + 278 tester / 271 pass / 0 fail fra ren checkout |
| 7 | `origin/main` = `b773695`, ancestor | **OK** | Verifisert |
| 8 | Tom sign-off på main-oppdateringen | **VENTER** | — |
| 9 | Fast-forward + Actions + `/health` | **VENTER** | — |
| 10 | Ingen prod-migrasjoner/deploy/Pilot | **OK** | Ingenting kjørt |

---

## 2. Private repo ville fjernet godkjenningsporten

GitHub-planen kan ikke leses med tokenet (`plan: null`). Men GitHubs egen
dokumentasjon er entydig, og bekrefter din advarsel:

> «If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers
> are only available for public repositories.»
>
> «Users with GitHub Free plans can only configure environments for public
> repositories. **If you convert a repository from public to private, any configured
> protection rules or environment secrets will be ignored**, and you will not be
> able to configure any environments.»
>
> — GitHub Docs, *Managing environments for deployment*

For private repo kreves **GitHub Enterprise** for required reviewers — ikke Pro,
ikke Team.

**Konsekvens:** å gjøre repoet privat nå ville **stille slått av** porten vi nettopp
satte opp. Deploy-jobben ville da gått videre uten godkjenning. Repoet er derfor
**ikke** endret — fortsatt `public`.

---

## 3. Hvorfor eksplisitt godkjenning overlever uansett synlighet

Deploy-jobben har to uavhengige porter:

| Port | Mekanisme | Planuavhengig? |
|---|---|---|
| **1. Workflow-port** | `if: workflow_dispatch \|\| contains(head_commit.message, '[deploy]')` | **Ja** — ren kode i repoet |
| **2. Environment-port** | `environment: production` + required reviewer | Nei — krever public eller Enterprise |

Port 1 betyr at ingen produksjonsdeploy kan skje uten at noen **bevisst** skriver
`[deploy]` i en commit eller klikker *Run workflow* manuelt. Det er en eksplisitt,
autorisert handling, og den virker uansett om repoet er public eller privat.

Port 2 er ekstra lag som bare virker mens repoet er public.

**Anbefaling:** bli public til du enten (a) går på Enterprise, eller (b) vi gjør
deploy-jobben dispatch-only. Det siste er en liten kodeendring som kan tas som egen
PR etter at main er oppdatert — den endrer ikke denne kandidaten.

---

## 4. Låseproblemet — funnet og fikset

Med `prevent_self_review: true` og bare én bruker (`tajlive`) ville en deploy
utløst av `tajlive` ikke kunne godkjennes av `tajlive`. Resultatet ville vært
deadlock på første forsøk.

```
før : prevent_self_review = true   → deadlock med én bruker
nå  : prevent_self_review = false  → godkjenning mulig
```

Trade-off: du kan godkjenne din egen utrullering. Men port 1 (`[deploy]`) krever
fortsatt en bevisst handling, og det finnes ingen annen administrator å bruke som
godkjenner. Admin-bypass er fortsatt av.

---

## 5. Branch protection på `main`

```
force-push tillatt  : false
sletting tillatt    : false
gjelder admins      : true
krever PR           : false
krever status-sjekk : false
```

Force-push og sletting er blokkert, også for administrator. PR-krav og
status-sjekk-krav er **bevisst** slått av, slik at den autoriserte
fast-forward-pushen fortsatt fungerer.

### Konsekvens for nød-rollback

Den dokumenterte B2-rollbacken (`--force-with-lease` mot sikkerhets-tagen) er nå
**blokkert av branch protection**. Ved en reell nødssituasjon må beskyttelsen
midlertidig fjernes først:

```bash
gh api --method DELETE repos/tajlive/finnbilglass/branches/main/protection
# … force-push …
gh api --method PUT  repos/tajlive/finnbilglass/branches/main/protection --input /tmp/bp.json
```

Det er en bevisst avveining: force-push mot `main` skal ikke kunne skje ved et
uhell. Alternativene A, B1 (revert) og D (wrangler rollback) er upåvirket og
fungerer uten å røre beskyttelsen.

---

## 6. CI på eksakt commit — ikke arbeidstreet

GitHub Actions kjører **bare på `main`** (`deploy.yml` trigges av push til main);
det finnes ingen CI på feature-brancher. Verifiseringen er derfor de samme
kommandoene kjørt fra en **ren checkout** av commiten:

```
HEAD (detached) : fa8ab8f2dca7cf36a4966d618e11f131086505d2
arbeidstre      : rent (kun node_modules-symlenke)
npx tsc --noEmit: exit 0
npm test        : 278 tester · 271 pass · 0 fail · 7 skip · exit 0
```

Dette er nøyaktig den feilen som ble avslørt på `a3c800b`: grønn arbeidskatalog,
rød commit. `fa8ab8f` er grønn også fra ren checkout.

**Begrensning, ærlig sagt:** dette er en lokal kjøring av CI-kommandoene, ikke
GitHub-runnere. Første faktiske Actions-kjørring på denne koden blir når `main`
oppdateres — og da skal `deploy`-jobben være **skipped**.

---

## 7. Tilstand før gjennomføring

```
origin/main : b773695   (uendret)
kandidat    : fa8ab8f
ancestry    : origin/main er ancestor → ren fast-forward
visibility  : public
```

---

## 8. Sign-off

Kommandoen som kjøres ved godkjenning:

```bash
git push origin origin/review/produktlinje-merge-20261031:refs/heads/main
```

Ingen `--force`. Deretter verifiseres:

1. Actions: `test-gate` og `security-check` grønne, `deploy` **skipped**
2. `https://www.finnbilglass.no/health` → 200
3. Ingen nye rader i prod-D1, ingen migrasjon kjørt
4. PR #6 viser ny diff (kun feature-commits)

Rollback finnes i fire varianter (revert / revert-alt / force med protection av /
`wrangler rollback`), dokumentert i `git-fast-forward-forberedelse-2026-10-31.md`.

---

## Utenfor denne godkjenningen

- Produksjonsmigrasjoner `0017`–`0027` — egen arbeidspakke med backup,
  rekkefølge, datavalidering, rollback-plan og egen godkjenning
- Produksjonsdeploy
- Pilot100 / Pilot1000
- Synlighet public → private (venter på planavklaring eller dispatch-only endring)
