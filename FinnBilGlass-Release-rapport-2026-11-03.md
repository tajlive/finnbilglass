# FinnBilGlass — Release-rapport V6.6.0-F2

**Dato:** 2026-11-03
**Erstatter:** §12 (GO/NO-GO) i `FinnBilGlass-Fase2-QA-og-utviklingsrapport.md`
**Produksjon (uendret):** Worker `ed4b58f3-f022-4181-887e-2a01d62529d6`, commit `03bb58cb`
**Staging (denne releasen):** Worker `7d70eb89-6220-4305-8675-5e4f4dac2563`
**Rollback-versjon:** `ae5bb623-cfc9-4a5b-bce0-df8eec6db017` (urørt)

> **Korrigering av forrige rapport.** Den la til grunn at feature-branchen var «produksjon + 59
> commits fra main». Det er feil. Produksjon kjører `4e72391` **+ én commit** (`03bb58cb`) som
> fjernet kandidatvisning i kundeflaten og gjorde `/api/glass/kandidater` til en MANUAL_REVIEW-pilot.
> Feature-branchen mangler den commiten og ville **reversert** piloten ved deploy. Derfor er det
> laget en egen, isolert release-branch fra `03bb58cb`. Se §5.

---

## 1. Eksakte commits og endrede filer

### Release-branch: `release/v6.6.0-fase2` (PR #25 → `fix/v660-d3-readiness`)
| Commit | Melding |
|---|---|
| `e45e5fe` | all-glass kandidater bak flagg + eurokode ut av offentlig svar |
| `bea12ed` | F6: fjern pen.dev fileToken fra sporad designfil + gitleaks-regel |
| `b62cca1` | flat glassklasse skal filtrere likt som selection + release-E2E |
| `d037f9c` | denne rapporten |

Base: `03bb58cb` — produksjonscommit, nå også publisert som `fix/v660-d3-readiness` (den fantes
**ikke** på GitHub før; produksjonskoden var altså ikke hentbar fra repoet).

| Fil | Endring |
|---|---|
| `src/fitment-v1/catalogue-candidates.ts` | +522/−84: posisjon via `klassifiserGlass`, ordavgrensede familie-regexer, generasjonsbevisst årsmatching, intern metadata |
| `src/index.ts` | +147: `handleAllGlassKandidater()` bak `ALL_GLASS_KANDIDATER_ENABLED`, hviteliste, validering i begge moduser |
| `src/glass-posisjon.ts` | +15/−3: `erListeRad()` eksportert og gjenbrukt |
| `src/types.ts` | +6: `ALL_GLASS_KANDIDATER_ENABLED` |
| `public/app.js` | +42/−11: rendrer kandidater **kun** når API-et gir dem |
| `wrangler.staging.toml`, `wrangler.toml` | +3/+1: flagget satt **kun** i staging |
| `.gitleaks.toml` | +9: regel `pen-file-token` |
| `design/ops-admin-2026.pen` | `fileToken` fjernet |
| `tests/all-glass-kandidater.test.mjs` | +278: 17 tester |
| `scripts/e2e-release-chrome.mjs` | +222: Chrome E2E |

Totalt **12 filer, +1157 / −98**. Ingen endring i auth, migrasjoner (ingen nye), priser,
`/ops`-tilgangskontroll eller CI-oppsett.

### Søsterbrancher
| Branch | Innhold |
|---|---|
| `fix/v6-6-0-fase2-all-glass` (PR #24) | Samme kandidatarbeid, men **basert på `4e72391`** — mangler pilot-commit `03bb58cb`. Beholdes som referanse; **skal ikke deployes**. |
| `d60eae6` | F6-fiksen er cherry-picket dit slik at begge brancher er renset. |

---

## 2. F6 — pen.dev `fileToken`: status og sikkerhetsbevis

| Spørsmål | Svar |
|---|---|
| Hvilken fil? | `design/ops-admin-2026.pen` |
| Hvilken commit? | `24996cf5` (2026-11-02 05:00, «feat(admin): Access-basert identitet i /ops …»), uendret siden |
| Hva er verdien? | Et `fileToken`-felt på toppnivå i `.pen`-JSON-en (36 tegn, UUID-format). Verdien gjengis **ikke** her. |
| Hva slags token er det? | pen.dev-CLI-ens eget skjema viser at `fileToken` er **filens identifikator** i eierens workspace, brukt når man oppretter en delelenke: «fileToken is required when creating a new share link», og `{shareId \| fileToken}` er gjensidig utelukkende. Det er **ikke** en bearer-credential — tilgang krever sesjon/CLI-nøkkel i workspace. |
| Er det eksponert? | Ja. Repoet er **public** (`gh repo view … visibility=PUBLIC`), og verdien har ligget der siden 2026-11-02. |
| Er det aktivt? | **Ikke verifiserbart utenfra.** Fire sonderte pen.dev-endepunkter svarte 404 (endepunktene finnes ikke offentlig); å avgjøre «aktiv/tilbakekalt» krever eiers innloggede pen.dev-økt. Det er heller ikke nødvendig for konklusjonen: eksponeringen alene er nok til at verdien må regnes som kompromittert. |
| Tiltak gjort nå | Feltet er **fjernet** fra den sporede filen (`bea12ed`, cherry-picket til feature-branchen). Ny gitleaks-regel `pen-file-token` fanger en ny verdi før commit. |
| Ny skanning | `gitleaks detect --config=.gitleaks.toml` (hele historikken, 342 commits): **5 funn** — 4× `ACCESS_AUD` i `wrangler.toml` (falsk positiv: JWT-audience-claim som sendes i klartekst) og **1× `pen-file-token` i commit `24996cf`**. |
| Arbeidsstre-skanning | 22 funn, alle i **utrackede, gitignorerte** filer: 14 i `.worktrees/*`-kopier (stale agent-worktrees med samme `.pen`-fil og `wrangler.toml`) og 2 i `.dev.vars` (lokale hemmeligheter, ikke sporet). Ingen av dem er publisert. |
| Gjenstår | Historikken er **ikke** skrevet om. Verdien ligger fortsatt i `24996cf`. To veier: (a) aksepter eksponeringen — den er en filidentifikator, ikke en nøkkel, og krever workspace-tilgang for å brukes; (b) purge med `git filter-repo` + force-push. (b) er destruktivt på et public repo og krever eiers godkjenning. |
| Rotasjon | Kan bare gjøres av eier i pen.dev (ny `fileToken` genereres når dokumentet lagres på nytt / ny deling opprettes). Tokenet er ikke en API-nøkkel og kan ikke tilbakekalles via CLI. |

**F6 markeres ikke som løst.** Mitigeringen er verifisert; selve eksponeringen i historikken står
åpen til eier velger (a) eller (b).

---

## 3. Migrasjon 0047 — kun isolert staging

### Før: backup og tilstand
```
backup: ~/.hermes/backups/staging-catalog-20261103-161043.sql (91 054 251 byte, 332 245 linjer)
DB:     finnbilglass-staging-catalog (79d63481-…), prod-D1 ble aldri berørt
```
| Måling | Før | Etter |
|---|---|---|
| tabeller / views | 65 / 1 | 65 / 1 |
| `glass_prisliste` | 29 627 | 29 627 |
| `glass_typekode` | 20 601 | 20 601 |
| typekoder med beskrivelse | 20 601 | 20 601 |
| `glass_reference` | 1 324 | 1 324 |
| view-sample (`typekode IS NOT NULL LIMIT 3`) | 3 rader | 3 rader |
| **/ops-katalogsøk** (eksakt spørring fra `src/routes/admin-katalog.ts`) | `26493GNL → DFF «Dørrute fremre førerside»` | identisk |
| **/ops EXACT-gate** (`JOIN glass_typekode` på varenr) | `DFF` | identisk |

### Kjøring
```
npx wrangler d1 execute finnbilglass-staging-catalog --remote --file=migrations/0047_glass_typekode.sql
→ ok (2,1 s). Ingen radtall endret. Ingen eksisterende tabell berørt (additiv, IF NOT EXISTS).
```
Staging hadde objektene fra før (importert utenfor ledgeren), så kjøringen er en **idempotens-test**
på ekte data: samme resultat, ingen endring. `d1_migrations` i staging er tom (0 rader) — ledgeren
brukes ikke der; det er dokumentert, ikke «fikset» i denne omgangen.

### Integritet
`PRAGMA integrity_check` nektes av D1-API-et (`SQLITE_AUTH code 7500`). Den ble derfor kjørt på
**eksporten lokalt**: 64 tabeller importert, `integrity_check = ok`, `foreign_key_check = 0`.

### Rollback (prøvd)
| Trinn | Resultat |
|---|---|
| `DROP VIEW IF EXISTS v_glass_med_typekode` | ✅ kjørt på kopi av staging-eksporten; view borte, `glass_prisliste` fortsatt 29 627, `integrity_check = ok` |
| Re-apply `0047` etter rollback | ✅ tabell + view gjenopprettet, 20 601 typekoder intakte, ingen radtap |
| `/ops`-spørringen uten typekodetabell (fallback-grenen i `admin-katalog.ts`) | ✅ returnerer raden med `typekode = NULL`, ingen krasj |
| `DROP TABLE IF EXISTS glass_typekode` | ⚠️ **ikke kjørt** — blokkert av agentens deny-regel (`*DROP TABLE*`). Må kjøres av eier hvis tabellen noensinne skal fjernes. Setningen er:`DROP VIEW IF EXISTS v_glass_med_typekode;` deretter `DROP TABLE IF EXISTS glass_typekode;`. Ingen FK peker på tabellen; den er additiv og dataimporten (20 601 rader) er et eget steg som kan kjøres/angres uavhengig. |

### /ops etter migreringen
- `https://ops-staging.finnbilglass.no/api/ops/whoami` → **302** (Cloudflare Access). DNS finnes.
- `https://finnbilglass.no/api/ops/whoami` → **302**; `…/api/ops/saker` → **302**.
- `workers.dev`-vert for staging → **403** (hostname isolation).
- **HTTP-verifisering av /ops-UI krever Access-JWT (eiers MFA) og er ikke utført.** Det som *er*
  målt, er den eksakte SQL-spørringen katalogsiden bruker (§3-tabellen) og den fail-closed gaten.

---

## 4. Chrome E2E — komplett rapport

**Miljø:** staging `7d70eb89` (release-branchen, `ALL_GLASS_KANDIDATER_ENABLED=true`).
**Verktøy:** ekte Google Chrome via Playwright (`channel: 'chrome'`), `scripts/e2e-release-chrome.mjs`.
**Biler:** SU18018 (SVV: VW Transporter 2005 — katalogdekning) og JD79487 (VW Caddy 2017 — ingen familie, null treff).

```
OPPSUMMERING: 23 brukerreiser · 0 FEIL · 0 advarsler
FRONTRUTE-REGRESJON: h2="Vi har funnet flere mulige frontruter til bilen din"
                     kort=260 tegn · sporsmaal=3 · pris-elementer=2
```

| Bil | Glasstype | Mobil | Desktop | Forventet |
|---|---|---|---|---|
| Transporter | Frontrute | VERIFY, 5 kandidater + 3 spørsmål | samme | ✅ |
| Transporter | Dørrute | 3 kort «Mulige glass til bilen» | 3 kort | ✅ |
| Transporter | Siderute | 3 kort | 3 kort | ✅ |
| Transporter | Bakrute | 3 kort | 3 kort | ✅ |
| Transporter | Vet ikke | 3 kort | 3 kort | ✅ |
| Transporter | Ventilrute | MANUAL_REVIEW + tilbudsskjema | samme | ✅ (ingen ventilrad for T5) |
| Transporter | Takglass | MANUAL_REVIEW + tilbudsskjema | samme | ✅ (ingen takrad for T5) |
| Caddy | alle 7 | MANUAL_REVIEW + tilbudsskjema | dør + front | ✅ (dekning, ikke feil) |

Kontrollert per reise (innhold, ikke bare HTTP):
- **API-et ble faktisk kalt** (`waitForResponse`), status 200.
- **Kandidater faktisk rendret**: 3 rader med `data-varenr` i `#resultat-kort`, og teksten «Krever kontroll før bestilling» finnes.
- **Ingen eurokode i kundeflaten**: regex for eurokode-format (`\d{4}[ABLR][A-Z0-9]{3,}`) = 0 treff.
- **Ingen intern diagnostikk**: `CLASS_D_CATALOGUE_CANDIDATE`, `GT_AUTO_PRISLISTE`, `matchReason`, `listepris`, `undefined`, `NaN` = 0 treff.
- **Null treff gir trygg vei**: h2 = «Vi kontrollerer ruten manuelt», kundetekst finnes, «ingen glass finnes» forekommer ikke, og «Be om pristilbud» er **aktiv**.
- **Skjema**: åpner, tomt skjema avvises av valideringen, ingen forespørsel sendt.
- **Mobil 393 px**: ingen horisontal overflyt. **Desktop 1280 px**: samme flyt.
- **Ingen JS-feil** (forventet 401 på `/api/auth/session` er filtrert bort).
- Skjermbilder: `/Users/taj/.hermes/cache/scratch/fbg-fase2/e2e-release/` (24 PNG + `e2e-rapport.json`).

### API-kontrakt (samme miljø, målt direkte)
| Bil | front | dør | side | ventil | bak | tak | vet ikke |
|---|---|---|---|---|---|---|---|
| SU18018 Transporter 2005 | 5 | 20 | 18 | 0 | 11 | 0 | 25 |
| AJ95429 Mercedes CLA 2016 | 5 | 11 | 11 | 0 | 2 | 0 | 18 |
| XD84921 BMW 320d 2014 | 0 | 25 | 25 | 0 | 6 | 0 | 25 |
| JD79487 VW Caddy 2017 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Kandidatnøkler målt: **`attributter, posisjon, varenavn, varenr`** — eurokode, pris,
`klassifisering`, `matchReason` og `source` er borte. Feilkoder: ugyldig/ufullstendig/motstridende
valg → 400; ukjent `kind` → 200 uten klassefilter.

---

## 5. Release-diff mot produksjon

| Referanse | SHA | Forhold |
|---|---|---|
| Produksjon | `03bb58cb` | baseline, nå publisert som `fix/v660-d3-readiness` |
| Release-branch | `b62cca1` | `03bb58cb` + 3 commits, **12 filer, +1157/−98** |
| `origin/main` | `73f7871` | 61 commits bak feature-branchen; **ikke** produksjonslinjen |
| Feature-branch (PR #24) | `d60eae6` | basert på `4e72391` — mangler pilot-commit `03bb58cb` |

### Hva produksjonscommit `03bb58cb` gjorde (og hvorfor den avgjør releasen)
- fjernet kandidatvisning i `public/app.js` → alle klasser viser «Vi kontrollerer ruten manuelt»
- innførte `src/glass-selection-contract.ts` med streng validering (`ventil.placement`, ikke `ventil`)
- gjorde `/api/glass/kandidater` til en pilot som **ikke spør katalogen i det hele tatt**
- strammet EXACT-gaten (`candidateCount === 1`) og la til `test:readiness`

### Hva releasen legger til — og hva den ikke gjør
| Endring | Kundesynlig i produksjon? |
|---|---|
| Kandidatgenerator rettet (F1–F3) | **Nei** — bak flagg som ikke finnes i prod-config |
| `handleAllGlassKandidater()` | **Nei** — samme flagg |
| `app.js` rendrer kandidater når API gir dem | **Nei** — piloten returnerer tom liste, så kundeflaten er identisk |
| Hviteliste uten eurokode | **Ja, forbedring** — gjelder bare når flagget er på; i dag lekker ingenting fordi ingen kandidater vises |
| F6-opprydding | Nei (repo-hygiene) |

**Dette er en «readiness»-release, ikke en produktendring.** Den gjør det trygt å slå på
all-glass-kandidater med én miljøvariabel når eier bestemmer det, og den fjerner en kjent felle
(eurokode/leverandørdata) før den kan nå en kunde.

### Urelatert arbeid som **ikke** følger med
Auth/OAuth, `glass-selection-contract`-endringer, D1-skjema, `/ops`-tilgang, prise-modell,
CI-oppsett. Ingen av V6.4.x–V6.5-linjens 59 commits fra `main` er med.

---

## 6. Backup- og rollbackplan

| Objekt | Backup | Rollback |
|---|---|---|
| Staging-D1 | `~/.hermes/backups/staging-catalog-20261103-161043.sql` (91 MB, eksportert før 0047) | import av dumpen, eller `DROP VIEW`/`DROP TABLE` (§3) |
| Produksjons-Worker | — (ikke endret) | `ae5bb623-cfc9-4a5b-bce0-df8eec6db017` |
| Prod-D1 | — (ikke endret) | ikke relevant |
| Release-branch | — | revert av 3 commits; flagget er av by default, så en revert gir ingen kundeeffekt |

Re-import av staging-dumpen (om nødvendig):
```bash
npx wrangler d1 execute finnbilglass-staging-catalog --remote --file=<dump.sql>
```
Ved en eventuell produksjonsutrulling senere: `wrangler rollback --name finnbilglass-frontrute` til
`ae5bb623…`, eller `--message`-versjonering. Migreringen er **ikke** nødvendig for kundeflyten —
0047 trengs bare for `/ops`-katalogen, og den er ikke kjørt i produksjon.

---

## 7. Samlet GO/NO-GO

### Release-branchen (kode + staging) — **GO**
| Gate | Bevis |
|---|---|
| TypeScript | `tsc --noEmit` = 0 feil |
| Tester | **497 tester / 490 PASS / 0 FAIL / 7 skipped** (GT-fixture mangler i arbeidskopien) |
| Chrome E2E | 23/23 brukerreiser, 0 feil, mobil + desktop |
| Frontrute-regresjon | VERIFY, 5 kandidater, 3 spørsmål, pris — uendret |
| Offentlig kontrakt | kun `varenr, varenavn, posisjon, attributter`; ingen eurokode/pris/intern kode |
| Null treff | MANUAL_REVIEW + tilbudsskjema (Transporter ventil/tak, alle Caddy-klasser) |
| 0047 | kjørt på isolert staging etter backup; tilstand identisk; rollback prøvd |
| F6 | mitigert (felt fjernet + regel); historikken står åpen |

### Produksjon — **NO-GO nå**
- Ingen produksjonsdeploy, ingen produksjonsmigrering, ingen merge er utført. Krever eiers
  eksplisitte godkjenning.
- Ved en eventuell utrulling bør eier ta stilling til om flagget skal stå **av** (anbefalt,
  kundeflaten uendret) eller **på** (kandidater vises — det er en produktendring som krever eget ja).

### Blokkeringer før en produksjonsrelease
1. **Eier-avgjørelse:** er `03bb58cb`-pilotens adferd (ingen kandidater) fortsatt ønsket, eller skal
   releasen også slå på `ALL_GLASS_KANDIDATER_ENABLED` i produksjon? Releasen er trygg i begge modi.
2. **F6 i historikken:** aksepter eksponeringen eller purg historikken (destruktivt).
3. **`main`-linjen:** produksjon er ikke på `main`. En fremtidig `main`-release må lages som egen
   release-branch fra produksjonscommit (denne branchen er malen), ellers publiseres 60 urelaterte commits.
4. **0047 i produksjon:** ikke nødvendig for kundeflyten, påkrevd for `/ops`-katalogen. Separat sak.
5. **Dekningsgap (ærlige, ikke feil):** VW Caddy mangler familie; ventil/tak har ingen rader for
   testbilene. Kunden får MANUAL_REVIEW med tilbud — ikke blindvei.

---

## Vedlegg — reproduksjon

```bash
# Tester og typer
npm run qa

# Chrome E2E mot staging (alle klasser, to biler, to viewports)
FBG_BASE=https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev node scripts/e2e-release-chrome.mjs

# API-kontrakt (regnr × selection)
python3 ~/.hermes/cache/scratch/fbg-fase2/release-matrix.py

# Sikkerhet
gitleaks detect --config=.gitleaks.toml
```
