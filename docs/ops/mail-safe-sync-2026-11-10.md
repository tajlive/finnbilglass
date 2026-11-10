# FinnBilGlass – trygg Gmail-synk og saksfordeling (10.11.2026)

Status: **Kode i draft PR #56**, basert på release/complete-20261106.
**Ingen staging- eller produksjonsdeploy, D1-migrasjon, ekte utsending eller Gmail-aktivering er gjennomført.**
GMAIL_SYNC_ENABLED skal forbli AV til staging-gatene under er oppfylt.

## Hvor data går

1. **Resend inbound:** Signert email.received → Resend Received Email API → ops_messages og ops_mail_details. email.sent skal aldri behandles som innkommende.
2. **Gmail:** Kun med eksplisitt flagg og konfigurert OPS_INBOUND_ADDRESS. Read-only Gmail OAuth → alle history.list-sider eller fullscan av INBOX+SENT → ops_messages og ops_mail_details.
3. **Sak:** Auto-kobling krever entydig [FBG-N]/sak N eller In-Reply-To til kjent melding, **pluss eksakt samsvar med kundens e-post på den saken**. To forespørsler fra samme kunde må fortsatt identifiseres med hver sin referanse.
4. **Ingen trygg kobling:** inquiry_id=NULL, vises i **Må fordeles**. Ansatt velger riktig sak, oppgir begrunnelse; server krever samsvar i kundeadresse og legger en append-only beta_inquiry_events-notatoppføring.
5. **Saksvisning:** GET /api/ops/inquiries/:id/epost og /api/ops/epost/historikk/:id viser beta_inquiry_events og ops_messages for samme inquiry-ID. Deduplisering på provider-meldings-ID når den finnes.

## Sikkerhet, personvern og feil

- Alle OPS-endepunkter krever admin-/Access-autentisering. Liste og fordeling har i tillegg OPS_WORKBENCH_ENABLED=true som gate.
- Verifiser fysisk Cloudflare Access og D1-roller fra PR #54. Support-tokenfallback må erstattes med identifisert ansatt for optimal revisjon.
- Kun eksplisitt oppgitte OPS_INBOUND_ADDRESS, SUPPORT_EPOST eller SUPPORT_FROM_EMAIL kan trigge lagring fra Gmail. Ikke bruk privat Gmail-konto som OPS-postkasse.
- Flermottaker-e-post til support lagres **ufordelt**, ikke automatisk til en sak.
- Gmail cursor (history_id) oppdateres kun etter alle sider/meldinger er hentet og varig registrert. Feil betyr ingen cursor-oppdatering. Samtidige jobber kan ikke overskrive nyere cursor.
- Utløpt Gmail-historikk (404) utløser fullscan med **start**-cursor fra Gmail-profil. Nye endringer under fullscan tas på neste pass.
- GMAIL_PAGE_LIMIT og GMAIL_BATCH_LIMIT er fail-closed-grenser. Overstiges volumet må tryggere batch-import bygges; aldri erklær fullført synk.
- Gmail Pub/Sub skal ikke eksponeres som offentlig usignert endepunkt. For produksjonsnær push kreves validert autentisering, daglig watch-fornyelse og periodisk avstemming.
- Ingen e-postinnhold i observability-logger. Egen tilgangskontroll for vedlegg. Personvern og oppbevaring avklares før produksjon.
- Utgående Resend fra PR #55 krever fortsatt persistent outbox/idempotent avstemming ved nettverksbrudd etter provider-aksept, før man kan garantere ingen dobbelsending.

## Lokal QA (uten ekte API-kall)

- npm run typecheck
- npm run test:gmail-safe-sync
- npm run qa
- Gitleaks i eksisterende CI

Testene kontrollerer history-paginering, 404/fullscan, manglende melding, delvis DB-feil og cursor, krysskobling, dobbeltimport, flermottaker-e-post, privat postkassefiltrering, saksvisning og tildeling på SQLite.

## Staging E2E – GO/NO-GO

1. **Les D1-skjema i riktig miljø:** ops_messages, ops_mail_details, ops_mail_sync_state, beta_inquiries og beta_inquiry_events. Sjekk fysisk staging-binding; ingen prod-DB eller migrering uten separat godkjenning.
2. **Google Workspace:** Bekreft firmakonto og supportalias, verifisert Resend-avsender, OAuth refresh-token i staging secrets (aldri i repo) og Gmail readonly-tilgang. Syntetisk postkasse først; aldri privat.
3. **Resend receive:** Gyldig Svix-signatur gir én melding, ugyldig signatur 401/ingen skriv, gjentatt levering én melding, API-feil gir 5xx og retry. email.sent er ikke IN.
4. **To saker for samme syntetiske kunde:** Eksakt referanse knyttes riktig. Uten/motstridende referanse eller ukjent kunde → Må fordeles. Ingen data fra annen sak.
5. **Gmail INBOX/SENT:** Flere sider, retry, duplicate Message-ID, feil midt i lagring, utløpt history, fullscan, samtidighet. Tell meldinger og cursor før/etter.
6. **Manuell tildeling:** Feil adresse 409; riktig adresse + begrunnelse gir én revisjonshendelse; dobbel tilordning 409; rett ansattrolle kreves.
7. **Chrome-kontroll:** XSS-escaping, synlig historikk, ufordelt-kø, kilde og vedlegg.
8. **GO:** QA+Gitleaks på eksakt SHA, Access fra PR #54, staging D1, syntetisk E2E og rollback. Ingen produksjon før GO.

## Releaseavgrensning

PR #56 ligger på gammel releasegren og kan ikke flettes direkte til main før selektiv integrasjon mot oppdatert main, PR #54 (autentisering/OPS) og PR #55 (Resend). Kustom og faktura er utenfor.
