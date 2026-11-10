# FinnBilGlass — fast stagingløyfe og første salg (10.11.2026)

## Faktisk status / grenser

- Kode og QA finnes på draft PR #57, fra `staging/first-sale-20261110`; ikke slå sammen før portene nedenfor er bestått.
- GitHub Actions `.github/workflows/staging-ops.yml` ligger på `main` med *kun* manuell `workflow_dispatch`. Den krever PR #57s eksakte SHA, `STAGING-ONLY`, en separat `staging`-environment og eksplisitte brytere for D1 og deploy. Ingen vanlig PR/commit kan automatisk deploye staging.
- Dette er en **manuell** salgsprosess: tilbud → dokumentert kundeaksept → én ordre → Kustom-lenke opprettet og registrert av ansatt. Ingen automatisk checkout, capture, refund, faktura eller betaling.
- Ingen produksjonsendring, ekte pengeoperasjon eller kundesending er autorisert av denne runbooken.

## Engangsoppsett uten ny wrangler-login per økt

1. Opprett GitHub Repository Settings → Environments → **staging**. Begrens godkjenning/reviewers og tillatte deployment branches til `main`. Legg til *environment secrets* `CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID`; konto-ID skal være `80d5b1d56a3e907150ba7348b6182894`. API-token skal ha kun nødvendige staging-rettigheter: Workers Scripts Edit og D1 Edit, **ingen Zone/DNS-edit**. Dokumenter tokenrotasjon. Ikke bruk brukerens personlige globale API-nøkkel.
2. Cloudflare Access beskytter riktig staging-host. Kontroller appens host, Access team-domain og AUD og koblingen til `finnbilglass-frontrute-staging`. Legg til to ansatte i Access-allow-policys Google/OTP-flyt. `ops_staff_memberships` er en separat rolle-/invitasjonsliste, men ingen skal måtte angi et lokalt Operations-passord. Login-JWT må faktisk verifiseres mot Access JWKS.
3. Installer **Worker-secrets bare på staging-Worker**, ikke i repository: `OPS_ACCESS_TEAM_DOMAIN`, `OPS_ACCESS_AUD`, `RESEND_API_KEY` (og eksisterende staging-secrets som trengs). GitHub workflow krever disse tre navnene før deploy. Å sette Worker-secrets kan utløse en ny Worker-versjon; gjør det i et planlagt stagingvindu. Ikke lim tokens i PR/Actions-logger.
4. Identifiser faktisk **Google Workspace-postkasse** for `post@finnbilglass.no`. Aliaset alene er ikke en mailbox. Postkasseeier gir Gmail `gmail.readonly` via OAuth 2.0 med offline access. Lagre `GMAIL_REFRESH_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` som staging Worker-secrets. Sett `OPS_INBOUND_ADDRESS` til riktig firmaadresse og aktiver `GMAIL_SYNC_ENABLED=true` **først etter** vellykket separat lesetest. ChatGPTs tilkobling til en privat Gmail-konto er ikke overførbar til Worker og skal ikke brukes som refresh-token.
5. Staging-kandidaten forventer alle 0040–0044 migrasjoner, inklusive `ops_offer_outbox`. Les faktisk schema og behold D1 Time Travel-bookmark (30 dager) før migrasjon. Ingen ukontrollert kjøring av hele `migrations/`-mappen.

## GitHub Actions-kjøring

Åpne Actions → **Staging OPS - manual release gate** → Run workflow på `main`.
Oppgi eksakt 40-tegn SHA fra PR #57, `authorization=STAGING-ONLY`. Først en kjøring med `apply_migrations=false`, `deploy=false` for verifikasjon; deretter migrasjon/deploy når schema, OAuth, Access og secrets er bekreftet. Workflowen stopper ved feil identitet, feil D1 UUID, feil Worker, manglende Time Travel, migrasjoner eller manglende Worker-secrets.

D1 Time Travel gjenoppretter *hele databasen* og kan overskrive andre skriveoperasjoner. Bruk gjenoppretting kun etter driftsbeslutning og konsekvenskontroll, ikke automatisk i en workflow.

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
