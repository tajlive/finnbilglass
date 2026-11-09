# FinnBilGlass — fast-track produksjonsplan (9. november 2026)

> **Beslutning:** Én isolert produksjonskandidat og kun én GO/NO-GO. Prioritet er manuelt salg i Operations Center med betalingslenke sendt til kunden. Ingen automatisk web-checkout og ingen uavklarte pengebevegelser.

## Status per kontrollert GitHub-commit

| Port | Status | Bevis / neste handling |
| --- | --- | --- |
| A. Main-basert kode | **KLAR FOR REVIEW** | [PR #49](https://github.com/tajlive/finnbilglass/pull/49), integrert fra `main c6e219f3` og Kustom-kandidat. Beholdt nyere forside, privacy `lookupOnly`/VIN-validering, blokkerende Gitleaks |
| B. Rolle-/sesjonsretting | **KODE KLAR** | PR #41 portert til PR #49; ekte SQLite med FK, atomisk D1 rolle + session-revoke |
| C. CI/typecheck/sikkerhet | **GRØNN SISTE GODKJENTE QA** | 686 pass, 0 fail, 7 skip på `2e9a85f8`; begge Gitleaks-kontroller ingen funn. Re-run etter nye commits |
| D. Staging/produksjons-bundle dry-run | **TEST UNDER UTVIKLING** | PR #49 pakker begge miljøene i CI uten Cloudflare-credentials; ikke en deploy |
| E. Staging-D1 schema og backup | **IKKE VERIFISERT** | Read-only SQL nedenfor, migrasjonsledger, Time Travel bookmark; ingen migrasjoner før gjennomgang |
| F. Operations Center E2E | **IKKE VERIFISERT** | Access/MFA, tilbud, betalingslenke, callback, status i samme sak, e-post |
| G. Vipps i Kustom prod | **BEKREFTET AV PROSJEKTEIER** | KYC OK, én vellykket Vipps-produksjonsbetaling. Intern D1/OPS-korrelasjon ikke verifisert |
| H. Rollback og alerting | **IKKE VERIFISERT** | Identifiser deployed Worker-versjon, prøv staging rollback, varsling og ansvarlig |

## Utfør disse trinnene i rekkefølge

### 1. Fullfør PR #49 (kode og test) — uten produksjon
- `npm ci && npm run qa`, TypeScript, to Gitleaks-skanninger (historikk + helt tre) og offline `wrangler deploy --dry-run` for staging og produksjon skal være grønne på **samme commit**.
- Ikke merge fra opprinnelige draft PR #29 eller #30 direkte til `main`. PR #49 er nå den eneste samlede kandidaten.
- Hold produksjonsflaggene for Kustom og pengebevegelser av, og staging-cron flagget eksplisitt `false`.

### 2. Staging D1 – bare lesing, ingen endring
Bekreft Cloudflare-konto, staging-databasens binding `FINNBILGLASS_STAGING_AUTH` og fysisk database før noen kommandokjøring.

```sh
npx wrangler d1 info finnbilglass-staging-auth --env staging --json
npx wrangler d1 migrations list finnbilglass-staging-auth --env staging --remote
npx wrangler d1 time-travel info finnbilglass-staging-auth --env staging --json
npx wrangler d1 execute finnbilglass-staging-auth --env staging --remote --file=scripts/sql/staging-kustom-readonly-preflight.sql
```

- SQL-filen inneholder kun `SELECT` og `PRAGMA table_info` og skriver ingen D1-rader.
- Undersøk at tabellene for `quote_payment_orders`, `kustom_payment_events`, `kustom_money_operations`, `kustom_reconcile_attempts`, `auth_users` og `auth_sessions` finnes, og at Kustom 0059/0060/0061 ikke anvendes dobbelt.
- Registrer Time Travel bookmark og demonstrer **staging** restore-plan med en kontrollert testkopi. Ikke kjør `time-travel restore` på aktiv produksjonsdatabase.

### 3. Staging-syntetisk E2E – Ops først
- Sjekk korrekt Cloudflare Access `AUD`, MFA, admin/ansatt-roller og at kunder ikke kan nå `/api/ops`.
- Manuelt opprett tilbud i riktig sak. Godkjenn tilbudet med sporbar samtykke/aksept. Lagre ett entydig `requestId`.
- Staging: test sikker opprettelse av en Kustom Playground-betalingslenke og at **samme** tilbud/ordre vises i Ops. Ingen ny ekte Vipps-betaling.
- Spill av syntetiske statusvarianter (ugyldig token, duplikat callback, autorisert uten capture, full capture, refund-review, feilbeløp, D1-feil og gjenforsøk) mot isolert staging, og verifiser at `PAID` kun oppstår ved faktisk capture.
- Aktiver `KUSTOM_RECONCILIATION_ENABLED` bare i staging etter migrasjon 0061. Kontroller 15-min cron, maksimalt fem ordre, retry/cooldown, og ingen POST til Kustom fra poller.

### 4. Eksisterende produksjonsbetaling – read-only
- Bruk den **eksisterende** vellykkede Vipps-betalingen fra prosjekteier. Les miljø/MID, ordre-ID, beløp, valuta, Kustom captured/refunded/authorized og kobling til intern D1-ordre og sak.
- Ikke skap en ny transaksjon som test, og ikke gjør capture, refund eller acknowledge fra kontrollskript. Hvis intern ordre ikke kan kobles sikkert til leverandørordren, behandle det som manuell verifisering, ikke automatisk `PAID`.

### 5. Produksjonsrelease — kun etter GO
- Dokumenter aktiv produksjons-Worker SHA og rollback-versjon. Ta D1 Time Travel bookmark/snapshot og test rollback i staging.
- Merge **én** revidert releasekandidat etter grønn CI, sikkerhet, Ops/E2E og eksplisitt GO fra ansvarlig.
- Innfør de minst nødvendige produksjonsflaggene først. Real money-movement og automatisk capture/refund forblir separat deaktivert.
- Gjennomfør read-only smoke på apex og www, login/admin, én syntetisk tilbudsprosess uten ordreutsendelse, og verifiser korrekt prod-Worker-versjon.

## Stoppkriterier (NO-GO)
En hvilken som helst manglende D1-tabell/migrasjonsbevis, feil Access-rolle, falsk `PAID`, risiko for dobbel capture/refund, manglende logg av idempotens, brutt e-posthistorikk, rød CI/Gitleaks eller ukjent rollback-versjon stopper ny automatisk produksjonsfunksjonalitet.

**Merk:** Kustom er allerede bekreftet brukt i produksjon av prosjekteier, men dette er ikke bevis for at ny FinnBilGlass-integrasjonskode er i produksjon. Fortsett eksisterende dokumentert manuell betalingsrutine inntil det er GO for Ops-integrasjonen.
