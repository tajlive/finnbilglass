# FinnBilGlass – Google Workspace finnes allerede (varig beslutning)

Status oppdatert 2026-11-10. Beslutningen gjelder alle nye agenter, Codex-økter og releaseoppskrifter. Se også `AGENTS.md`.

## Autoritative beslutninger

1. **Google Workspace for `finnbilglass.no` er allerede opprettet.** Vi bruker eksisterende bedriftskonto/postkasse (`tomarne@finnbilglass.no` er bekreftet i Workspace-velkomstmelding), eksisterende Google OAuth-klient og Google Cloud-prosjekt dersom rettighetene tillater det. Vi oppretter ikke ny Workspace eller en parallell e-postleverandør.
2. **Resend** brukes fortsatt for utgående e-post, tilbud og manuelle svar. **Gmail API med `gmail.readonly`** brukes for speiling av innkommende, samt «Sent» skrevet manuelt i Workspace. Kundesvar journalføres, aldri sendt automatisk. All sending av tilbud forblir en kontrollert ansatthandling.
3. Innlogging for ansatte er **Google/Cloudflare Access → D1 invitation/role**, ett varig oppsett, uten lokale ekstra passord. OAuth-tilgang til Workspace-postkassen er en *separat* engangsgodkjenning med spesifisert scope.
4. Sikre at `OPS_INBOUND_ADDRESS` og eventuell `SUPPORT_FROM_EMAIL` viser **autoriserte aliaser i riktig Workspace-postkasse**, ikke personlig Gmail. Sikker automatisk sakskobling krever faktisk kunde-epost og entydig referanse; ellers «Må fordeles».
5. Gmail-token: aldrig commit/logg/ChatGPT. Godkjent refresh token må ligge som Cloudflare Worker secret eller kryptert i D1 med nøkkel utelukkende i Worker secret; koden må aldri hente token fra brukerens ChatGPT Gmail-plugin.
6. **Staging før produksjon:** Gmail-synk holdes AV til gjeldende eier har samtykket og konto er verifisert. Google Workspace-konfigurasjon, Workspace DNS/MX og alias bekreftes separat. Både opprinnelig import, inkrementell cursor, duplikatvern, «Må fordeles», interne utsendelser og ikke-tilgang til personlig Gmail må verifiseres i virkelig staging.
7. Ingen betaling/kundeaksept fabrikeres i staging. Kustom Portal-lenke er manuell, etter dokumentert aksept.

## Verifiserte tekniske forhold

- **Grønn:** staging-Worker har `GOOGLE_OAUTH_CLIENT_ID` og `GOOGLE_OAUTH_CLIENT_SECRET` som eksisterende hemmelige bindinger, samt `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `OPS_ACCESS_AUD` og `OPS_ACCESS_TEAM_DOMAIN`. Se [read-only inventory #42915165181](https://github.com/tajlive/finnbilglass/actions/runs/42915165181).
- **Mangler:** `GMAIL_REFRESH_TOKEN`, `OPS_INBOUND_ADDRESS` og `SUPPORT_FROM_EMAIL` som Worker secrets, mens `GMAIL_SYNC_ENABLED=false` i `wrangler.staging.toml`. `GMAIL_PUBSUB_TOPIC` ikke installert; push er valgfri, «Synk nå» kan testes først.
- **Første stagingtilbud:** syntetisk sak #1, versjon 1, `DRAFT`, NOK 1,00, ingen Resend-utsending eller ordre; [D1-bevis #42914272906](https://github.com/tajlive/finnbilglass/actions/runs/42914272906).
- ChatGPTs tilgjengelige Gmail-konto er `tomarnejensen@gmail.com` og er **ikke** Workspace-postkassen. Den kan ikke benyttes som OPS' Gmail refresh token uten en separat autorisasjon av Workspace.
- Google krever eksakt matchende registrert OAuth redirect URI for Web Server-flow, `access_type=offline` og `state` mot CSRF. Eventuelle eksisterende OAuth-klienter må bekreftes mot dette før tilkobling.

## Gjennomføring (uten ny Workspace)

1. Finn eksisterende Workspace-postkasses primæradresse og alias; velg `OPS_INBOUND_ADDRESS` bare etter bekreftelse. Bekreft at Googles Gmail API er tilgjengelig for eksisterende OAuth-klient og at consent-skjermen støtter `gmail.readonly`.
2. Tilby sikker engangstilkobling fra ADMIN-beskyttet Operations Center: state, PKCE, eksakt redirect URI, offline, tokenkryptering; feile lukket på avvikende mailbox og manglende refresh token. Ikke godkjenn eier via personlig Gmail-konto.
3. Verifiser read-only Gmail profile, mailbox-alias og tilgang. Sett `GMAIL_SYNC_ENABLED=true` **kun i staging** etter bevis. Første test bruker kontrollert post i eksisterende Workspace-postkasse.
4. Kjør full tilbud→utsending→kundeaksept→ordre-E2E med godkjent testpostkasse, to ansatte og idempotens; deretter GO/NO-GO. Ikke skap en ordre på syntetisk sak #1.

## Eksternt kontrollpunkt som ikke kan automatiseres uten samtykke

Bare **kontoens eier** kan gi den innloggede Workspace-postkassen Gmail `readonly` OAuth-rettigheter, og eksisterende OAuth-klient må ha riktig redirect URI i Google Cloud Console. Dette er ikke det samme som å opprette Google Workspace på nytt.
