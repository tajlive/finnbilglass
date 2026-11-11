# OPS – nøyaktig, sikker staging-Worker-release (ingen D1-skriving)

**Status:** Kjørbare, lokalt validerbare instruksjoner. Dette dokumentet deployer ingenting. Bruk eierautentisert Work/CLI, ikke GitHub Environment D1 Edit.

## Bekreftede forutsetninger per 11.11.2026

- Draft [PR #57](https://github.com/tajlive/finnbilglass/pull/57) er releasekandidat. Hent **fersk SHA** fra GitHub ved gjennomføringen; ikke bruk gammel SHA etter merge av en ny endring.
- EU-staging-D1 `finnbilglass-db-staging`, UUID `78842e17-ab0b-47c1-acde-244044073466`, har [0046 PASS](https://github.com/tajlive/finnbilglass/actions/runs/43017420588). **Ingen nye migrasjoner.**
- Cloudflare Worker `finnbilglass-frontrute-staging`, konto `80d5b1d56a3e907150ba7348b6182894`, R2 `finnbilglass-opplaering-staging`.
- Sist uavhengig observerte Worker-versjon: `21266eb9-dd0c-4f2a-a623-9a69654fc995`; mulig tidligere versjon `890cee22-cb40-4164-9ffa-9bdc1c2f44d3`. Begge må sjekkes på nytt i Cloudflare rett før deploy. Eldre Worker-versjoner er ikke automatisk testet rollback.
- I delt Cloudflare-konto gir D1 Edit konto-bred tilgang. **Ikke** opprett `STAGING_CLOUDFLARE_API_TOKEN` med D1 Edit i GitHub, og **ikke** start `staging-ops.yml` med migrasjon/deploy. Bruk eierens kontrollerte Cloudflare-økt.

## A. En eksakt og testet kandidat

Kjør dette på en **ren** arbeidskopi av FinnBilGlass i Work/terminal som kontoeieren godkjenner. Erstatt SHA med den nyeste, gjennomgåtte PR #57 HEAD (40 tegn) ved kjøring:

```bash
git fetch origin staging/first-sale-20261110
git switch --detach <PR57_SHA>
npm ci
node scripts/maintenance/ops-staging-preflight.mjs --expected-sha <PR57_SHA>
npm run qa
node scripts/maintenance/ops-staging-preflight.mjs --expected-sha <PR57_SHA> --dry-run
```

Preflight er **skrivbeskyttet**: den krever riktig, ren Git SHA, og stopper ved feil Cloudflare-konto, service, D1-ID, R2-bucket, produksjonsrute, ekstra D1-binding, Gmail-sync eller avskrudd OPS. `--dry-run` bygger staging-bunten via Wrangler, men deployer ikke.

Hvis en test genererer arbeidsfiler, undersøk `git status --porcelain` og rydd kontrollert; **ikke** omgå ren-arbeidskopi-sperren.

## B. Cloudflare og rollback før en eneste deploy

1. Bekreft konto, aktiv staging-Worker, aktiv versjons-ID, Access/JWT-AUD, og at nødvendig `RESEND_API_KEY` finnes på riktig staging-Worker. Les kun **secret-navn**, aldri verdier.
2. Verifiser at den eksisterende Worker-versjonen kan gjenopprettes med Cloudflares versjonshistorikk/deployments UI. Dokumenter **konkret versjons-ID og hvordan rollback utføres**. En tidligere versjons-ID er ikke i seg selv en bestått rollback-øvelse.
3. Bekreft at Worker-ruten er **kun** workers.dev-staging og ikke bruker `finnbilglass.no`, `www` eller produksjons-D1. Ikke modifiser DNS eller Access-regler.
4. Bekreft at Gmail-import er av (`GMAIL_SYNC_ENABLED=false`); ingen ekte e-post eller Kustom kan sendes under deployfasen.
5. **Stopp** hvis koden, rollbacken, Worker-identitet eller D1/R2-binding ikke stemmer, eller hvis Work-kontoen ber om bred tokenopprettelse.

## C. Kun etter A + B PASS – én staging Worker-deploy

Bruk den eksisterende eierautentiserte Cloudflare CLI-sesjonen på **samme eksakte, rene Git-commit**:

```bash
npx wrangler deploy --config wrangler.staging.toml
```

Dette er en **Worker-deploy**, ikke en D1-migrasjon. Kjør aldri `wrangler d1 execute`, `migrations apply` eller `npm run deploy` her. Ingen GitHub D1 Edit-token.

Etterpå kontroller aktiv Worker-versjon og at runtime faktisk tilsvarer bygget fra den godkjente SHA-en. Verifiser at `/health` fungerer i korrekt stagingmiljø og at uautentisert OPS er blokkert.

## D. Første-salg-E2E og produksjonsgrense

Kjør bare mot godkjent syntetisk kunde og testpostboks. To inviterte ansatte skal kunne håndtere forespørsel → dokumentert glassvalg → tilbud → kontrollert testutsending/svar → verifiserbar aksept → **én** ordre → manuell Kustom-lenkereferanse. Lenke gir `PAYMENT_LINK_SENT`, **ikke PAID**. Test Access rolle/revokasjon, CSRF, dobbeltklikk/race, legacy D1/R2 og kontrollert rollback.

Dokumenter aggregert PASS/NO-GO, aktiv og forrige versjons-ID, eksakt SHA og eventuelle blokkerende feil i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39) og [#52](https://github.com/tajlive/finnbilglass/issues/52). Ingen ekte kundeinnhold, hemmeligheter eller personlige e-poster i GitHub.

**Produksjon er NO-GO** inntil alle kontrollene er signert.
