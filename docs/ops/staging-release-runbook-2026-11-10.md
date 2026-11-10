# FinnBilGlass — fast stagingløyfe og første salg (10.11.2026)

## Faktisk status / grenser

- Kode og QA finnes på draft PR #57, fra `staging/first-sale-20261110`; ikke slå sammen før portene nedenfor er bestått.
- GitHub Actions `.github/workflows/staging-ops.yml` ligger på `main`. Endringer i workflow-filen utløser automatisk **nøkkelfri QA og Wrangler dry-run**; faktiske D1-migrasjoner og stagingdeploy skjer bare via eksplisitt `workflow_dispatch`, etter verifisering av PR #57, `STAGING-ONLY`, GitHub Environment `staging` og dedikert staging-token. Commit-SHA hentes automatisk. Ingen vanlig PR/commit kan automatisk deploye staging.
- Dette er en **manuell** salgsprosess: tilbud → dokumentert kundeaksept → én ordre → Kustom-lenke opprettet og registrert av ansatt. Ingen automatisk checkout, capture, refund, faktura eller betaling.
- Ingen produksjonsendring, ekte pengeoperasjon eller kundesending er autorisert av denne runbooken.

## Engangsoppsett uten ny wrangler-login per økt

1. Opprett GitHub Repository Settings → Environments → **staging**. Begrens godkjenning/reviewers og tillatte deployment branches til `main`. Legg til **kun** *environment secret* `STAGING_CLOUDFLARE_API_TOKEN` (dedikert til staging). Konto-ID `80d5b1d56a3e907150ba7348b6182894` er en ikke-hemmelig, eksplisitt verdi i den låste staging-workflowen. **Ikke bruk** eksisterende repository-/produksjonssecret `CLOUDFLARE_API_TOKEN`. API-token skal ha kun nødvendige staging-rettigheter: Workers Scripts Edit og D1 Edit, **ingen Zone/DNS-edit**. Dokumenter tokenrotasjon. Ikke bruk brukerens personlige globale API-nøkkel.
2. Cloudflare Access beskytter riktig staging-host. Kontroller appens host, Access team-domain og AUD og koblingen til `finnbilglass-frontrute-staging`. Legg til to ansatte i Access-allow-policys Google/OTP-flyt. `ops_staff_memberships` er en separat rolle-/invitasjonsliste, men ingen skal måtte angi et lokalt Operations-passord. Login-JWT må faktisk verifiseres mot Access JWKS.
3. Installer **Worker-secrets bare på staging-Worker**, ikke i repository: `OPS_ACCESS_TEAM_DOMAIN`, `OPS_ACCESS_AUD`, `RESEND_API_KEY` (og eksisterende staging-secrets som trengs). GitHub workflow krever disse tre navnene før deploy. Å sette Worker-secrets kan utløse en ny Worker-versjon; gjør det i et planlagt stagingvindu. Ikke lim tokens i PR/Actions-logger.
4. Identifiser faktisk **Google Workspace-postkasse** for `post@finnbilglass.no`. Aliaset alene er ikke en mailbox. Postkasseeier gir Gmail `gmail.readonly` via OAuth 2.0 med offline access. Lagre `GMAIL_REFRESH_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` som staging Worker-secrets. Sett `OPS_INBOUND_ADDRESS` til riktig firmaadresse og aktiver `GMAIL_SYNC_ENABLED=true` **først etter** vellykket separat lesetest. ChatGPTs tilkobling til en privat Gmail-konto er ikke overførbar til Worker og skal ikke brukes som refresh-token.
5. Staging-kandidaten forventer alle 0040–0044 migrasjoner, inklusive `ops_offer_outbox`. Les faktisk schema og behold D1 Time Travel-bookmark (30 dager) før migrasjon. Ingen ukontrollert kjøring av hele `migrations/`-mappen.

## Automatisering som er aktiv

- Endring av `.github/workflows/staging-ops.yml` på `main` starter automatisk en **nøkkelfri QA-preflight**. Kjøring [42881392683](https://github.com/tajlive/finnbilglass/actions/runs/42881392683) bestod. Denne triggeren har ingen Cloudflare-secrets og kan ikke kjøre migrasjon/deploy.
- PR #57 har i tillegg automatisk `PR Verification` for hver kodeendring. Ikke dupliser testarbeid manuelt uten grunn.
- Staging-migrasjon og deploy er fortsatt en eksplisitt engangsgodkjent handling, beskyttet av GitHub-miljøet `staging` og `STAGING_CLOUDFLARE_API_TOKEN`. Egen staging-API-token må legges inn én gang; ingen lokal `wrangler login` eller separat ansattpassord skal være nødvendig.
- Den tidligere brukte repository-secreten `CLOUDFLARE_API_TOKEN` for produksjon **kan ikke** brukes av staging-jobben. Konto-ID er allerede satt i workflowen, og skal ikke tastes inn på nytt.

## Kontinuerlig QA og leverandøroppdateringer

- `.github/workflows/nightly-quality.yml` kjører på `main` via GitHub Actions hver dag kl. **04:23 UTC**, og kan også startes manuelt. Den tester både `main` og **gjeldende HEAD fra draft PR #57** så lenge denne fortsatt er aktiv og eies av repoet. Den kjører `npm ci`, full `npm run qa` (TypeScript og tester) og `wrangler deploy --dry-run` for staging-bunten. Ingen Cloudflare-token, D1-skriving, Worker-deploy, e-post eller betaling. Scheduled jobs kan bli forsinket av GitHub.
- Første [nightly QA-kjøring #42882989348](https://github.com/tajlive/finnbilglass/actions/runs/42882989348) bestod **begge jobbene**, inkludert Worker-dry-run, 10.11.2026. Dette er **ikke** et bevis for fullført staginghandel.
- Den allerede aktive ChatGPT-automatiseringen «FinnBilGlass – produksjonsledelse og utviklingskontroll» sjekker GitHub/staging/CI med eksisterende seks-timers intervall og rapporterer nye avvik; den er oppdatert til å følge denne workflowen og PR #57.
- Den eksisterende fredagsrapporten «AI-agenter: ukentlig kortliste» inkluderer nå **praktisk leverandør- og sikkerhetskontroll for Cloudflare, Wrangler, GitHub Actions, Resend og Gmail**. Undersøk nyheten mot dokumentasjon, kode og QA før den tas i bruk. Ingen automatisk produksjonsutrulling på grunnlag av foruminnlegg eller changelog.
- Ved rød nattlig CI: lokaliser failing step/test i workflow-logs, klassifiser avhengighetsproblem/flaky/regresjon, lag sporbar fix på kandidatgren/PR, kontroller ny full QA og dry-run. Ikke slå av sjekker for å få grønt resultat. Hvis D1/Access/Workspace-secrets mangler, be om **en** autorisert engangsgodkjenning; ikke be om lokal `wrangler login` i hver chat.

## GitHub Actions-kjøring

Åpne Actions → **Staging OPS - manual release gate** → Run workflow på `main`.
La `candidate_sha` stå **tomt** (workflowen henter og låser gjeldende PR #57 HEAD automatisk), `authorization=STAGING-ONLY`.

1. **Ingen nøkler nødvendig:** `inspect_staging=false`, `apply_migrations=false`, `deploy=false` gir full QA, lokal test av alle fem D1-migrasjoner og Wrangler-dry-run, uten Cloudflare-tilgang.
2. **Første ekte driftskontroll (skrivebeskyttet):** Etter at dedikert token er lagt i GitHub Environment `staging`, sett `inspect_staging=true`, la migrasjon/deploy stå `false`. Da kontrolleres Cloudflare-konto, staging-D1 UUID og tabelloversikt uten skriving.
3. **Første stagingmigrasjon:** Kjør `apply_migrations=true`, `deploy=false`, eventuelt sett `bootstrap_admin_email` til e-postadressen for første administrator. Denne initieringen krever at arbeidsflyten startes av repo-eier `tajlive`. E-postvalget er valgfritt og benyttes **kun** under denne stagingmigrasjonen. `INSERT OR IGNORE` oppretter bare manglende invitasjon og overskriver aldri eksisterende ansattrolle.
4. **Stagingdeploy:** Etter verifisert SQL, Cloudflare Access AUD og staging Worker-secrets, sett `deploy=true`. Workflowen kontrollerer nødvendige tabeller og Worker-secret-navn før den deployer. Bruk **kun staging**.

Workflowen stopper ved feil identitet, feil D1 UUID, feil Worker, manglende Time Travel, migrasjoner eller Worker-secrets. Google/Access JWT fra invitert administrator aktiverer invitasjonen ved første innlogging – uten et nytt lokalt app-passord.

D1 Time Travel gjenoppretter *hele databasen* og kan overskrive andre skriveoperasjoner. Cloudflares retensjon er **7 dager på Free eller 30 dager på Workers Paid**; bruk ikke et fast 30-dagersløfte uten abonnementskontroll. Bruk gjenoppretting kun etter driftsbeslutning og konsekvenskontroll, ikke automatisk i en workflow.

## Tilbudskø og duplikatbeskyttelse

`ops_offer_outbox` opprettes med unik `offer_id` og permanent `request_id`, frosset mottaker, emne og payload før nettverkskallet. Bare `QUEUED` kan reserveres til `SENDING` med atomisk oppdatering. Andre klikk returnerer gjeldende tilstand, aldri en parallell sending. Resend-suksess lagrer `SENT`, tilbudstatus, journalhendelse og ansattaudit i én D1-batch.

Ukjent resultat (timeout/5xx/manglende provider-ID) merkes `REVIEW`. **Aldri automatisk retry**: Resends idempotency-key har bare 24 timers levetid. Admin finner faktisk Resend message-ID og avstemmer via `POST /api/ops/manual/offers/{offerId}/reconcile` med `providerMessageId`; serveren gjør en autentisert **GET** til Resend og kontrollerer ID, mottaker og emne, uten en ny send. Uavklart melding forblir blokkert. Ops-saksbildet viser køtilstand og avstemmingsknapp.

## Staginghandel — obligatorisk GO/NO-GO-protokoll

Bruk syntetisk sak og avtalt testpostkasse. Ikke bruk virkelig kunde eller opprett en ekte betaling.

| Verifikasjon | Krav |
| --- | --- |
| Identitet | To inviterte ansatte logger inn via Access, roller og MFA/OTP følger policy. Ingen ekstra app-passord. |
| Utsending | Én tilbudsversjon med dokumentert SKU, frakt og totalpris. Maks én Resend-melding ved dobbeltklikk, samtidige klikk og repetisjon senere. |
| Gjenoppretting | Simulert usikkert sendresultat gir `REVIEW`; ingen ny sending før ekstern Resend-verifikasjon. |
| Workspace | Testpost vises én gang i riktig sak etter `Synk nå`; tvetydige treff havner i `Må fordeles`. |
| Aksept | Dokumentert kundesvar med e-post-/hendelses-ID. Ingen ordre uten `SENT` + etterprøvbart akseptbevis. |
| Ordre | Én og bare én manuell ordre ved gjentatt ordreklikk. |
| Kustom | Ansatt oppretter **manuelt** Playground/Portal-lenke og registrerer referanse i Ops. Ingen capture/refund/automatikk. |
| Sporbarhet | Hvert viktig trinn, inkl. innlogging, tilbud, aksept og ordre, skal være synlig for admin; ingen duplikatjournal. |
| Sikkerhet | Uinnlogget, ikke-invitert og `REVIEWER` kan ikke sende eller lage ordre. Ingen cross-origin POST. |
| Drift | Commit, workflow-run, D1-bookmark og tester dokumentert. Nødprosedyre for å stoppe ny tilbudssending verifisert. |

**GO først når alle radene er dokumentert bestått av faktiske staging-kall.** Lokal QA/grønn PR-CI alene gir ikke GO.

## Åpne eksterne avhengigheter

- GitHub environments og hemmelige variabler kan ikke opprettes fra den tilkoblede GitHub-kode-API-tilgangen her.
- Cloudflare Worker-secrets og Access-host krever tilgang til konto-API eller godkjent browser/Work-økt.
- Workspace OAuth-grant krever mailbox-eierens interaktive samtykke (engangs), og e-postlevering/alias må verifiseres i Workspace/DNS.
- Full staginghandel må gjennomføres av inviterte ansatte via riktig Access-beskyttet staging-host. Ingen påstand om utført E2E før tilhørende run-/audit-bevis finnes.
