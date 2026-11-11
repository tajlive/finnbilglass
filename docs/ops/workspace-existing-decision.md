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
- **Status etter oppsett:** `OPS_GMAIL_TOKEN_ENCRYPTION_KEY` finnes på staging Worker, og tre `ops_workspace_*`-tabeller er opprettet på eksakt EU-staging-D1. `OPS_WORKSPACE_OAUTH_ENABLED=true` lar en innlogget ADMIN gjennomføre engangssamtykke. **Ingen refresh token er samtykket eller lagret ennå.** `GMAIL_REFRESH_TOKEN` som manuelt Worker-secret er ikke lenger nødvendig i staging; den nye flyten lagrer tokenet AES-GCM-kryptert. `OPS_INBOUND_ADDRESS` og autoriserte alias er ikke ferdig kontrollert. `GMAIL_SYNC_ENABLED=false` inntil dette er verifisert. `GMAIL_PUBSUB_TOPIC` er valgfritt og ikke installert.
- **Første stagingtilbud:** syntetisk sak #1, versjon 1, `DRAFT`, NOK 1,00, ingen Resend-utsending eller ordre; [D1-bevis #42914272906](https://github.com/tajlive/finnbilglass/actions/runs/42914272906).
- ChatGPTs tilgjengelige Gmail-konto er `tomarnejensen@gmail.com` og er **ikke** Workspace-postkassen. Den kan ikke benyttes som OPS' Gmail refresh token uten en separat autorisasjon av Workspace.
- Google krever eksakt matchende registrert OAuth redirect URI for Web Server-flow, `access_type=offline` og `state` mot CSRF. Eventuelle eksisterende OAuth-klienter må bekreftes mot dette før tilkobling.

## Gjennomføring (uten ny Workspace)

1. Finn eksisterende Workspace-postkasses primæradresse og alias; velg `OPS_INBOUND_ADDRESS` bare etter bekreftelse. Bekreft at Googles Gmail API er tilgjengelig for eksisterende OAuth-klient og at consent-skjermen støtter `gmail.readonly`.
2. **Engangstilkoblingen er deployet i staging**: innlogget ADMIN åpner `https://ops-staging.finnbilglass.no/ops/ansatte`, velger «Godkjenn Gmail-lesetilgang én gang» og gir eksplisitt samtykke for **`tomarne@finnbilglass.no`**. OAuth bruker state, PKCE, eksakt callback `https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback`, offline tilgang og kryptert D1-lagring. Personlig Gmail blir avvist etter autentisert Gmail-profilkontroll. **Bekreft at callback URI allerede er registrert på den eksisterende Google OAuth-klienten i Google Cloud**; ikke lag ny Workspace eller Google-app før dette er kontrollert.
3. Verifiser read-only Gmail profile, mailbox-alias og tilgang. Sett `GMAIL_SYNC_ENABLED=true` **kun i staging** etter bevis. Første test bruker kontrollert post i eksisterende Workspace-postkasse.
4. Kjør full tilbud→utsending→kundeaksept→ordre-E2E med godkjent testpostkasse, to ansatte og idempotens; deretter GO/NO-GO. Ikke skap en ordre på syntetisk sak #1.

## Faktisk stagingbevis fra 10. november 2026

- [GitHub-kjøring #42918470764](https://github.com/tajlive/finnbilglass/actions/runs/42918470764) **SUCCESS**: 0045 SQL migrasjon ble først kjørt i SQLite QA og deretter installert på korrekt EU-staging-D1 etter Time Travel-bokmerke; de tre OAuth-tabellene finnes. En 256-bit AES-GCM-nøkkel ble generert med kryptografisk tilfeldig verdi og satt som **staging Worker-secret uten logg-/Git-eksponering**. Den privilegerte engangsjobben er fjernet.
- [GitHub-kjøring #42918847285](https://github.com/tajlive/finnbilglass/actions/runs/42918847285) **SUCCESS**: faktisk stagingdeploy av ADMIN-OAuth-samtykke med full QA og SQL-rehearsal; health HTTP **200**, uautentisert OAuth-status og start HTTP **401**. Staging `GMAIL_SYNC_ENABLED=false`. Midlertidig, privilegert deployjobb er fjernet.
- [GitHub PR-verifisering #42917859075](https://github.com/tajlive/finnbilglass/actions/runs/42917859075) **SUCCESS**: test av feil/privat Gmail-profil, gjenbrukt OAuth-state, manglende offline refresh token, kryptert lagring og rolle-gating.
- **Reell eiergodkjenning er fortsatt nødvendig**: knapp i staging `/ops/ansatte`; tilhørende Google OAuth-klient må ha eksakt godkjent redirect URI. Ikke utgi det for ferdig koblet til Gmail før faktisk samtykke og profilkontroll.
- **Google-policy:** `gmail.readonly` er et *restricted scope*. Oppsett i Google Cloud Console (Internal vs. External, OAuth-verifisering, samt testpubliseringens begrensede refresh token-levetid) må kontrolleres før vi lover permanent drift. Bruk den eksisterende Workspace-organisasjonen og minimer tilgangen.

## Blokkering 11.11.2026 – Google OAuth redirect_uri_mismatch

**Bekreftet i Googles faktiske feilmelding i Chrome**, etter at administrator trykket «Godkjenn Gmail-lesetilgang én gang»:

- Google returnerte `400 redirect_uri_mismatch` før samtykke/tilgang ble gitt.
- Eksisterende OAuth client ID, fra feilens `client_id`: `546660856812-hg0q0892674cqomekd4ibmt5ja4i0egg.apps.googleusercontent.com`. Dette er en offentlig klientidentifikator, **ikke** et klientpassord.
- Appens eksakte `redirect_uri` fra Google-feildetaljene:
  `https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback`
- Google viste `tomarnejensen@gmail.com` som forhåndsvalgt konto, men **det er ikke årsaken til redirect-feilen**. Ved neste forsøk velges den eksisterende Workspace-postkassen `tomarne@finnbilglass.no`. OAuth-flyten har uansett eksplisitt verifikasjon av Gmail-profilens adresse før kryptert token lagres.

**Løsning – endre eksisterende klient, ikke opprett ny:**

1. Åpne [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), velg prosjektet som eier klient-ID-en nevnt over, og åpne akkurat denne **Web application** OAuth-klienten.
2. Under **Authorized redirect URIs**: **Add URI** og legg inn den eksakte `https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback` (ingen etterfølgende `/`). Behold alle eksisterende URI-er. Lagre.
3. Google kan bruke noen minutter eller mer på oppdatering. Gå til `https://ops-staging.finnbilglass.no/ops/ansatte` og start Gmail-samtykket på nytt, med `tomarne@finnbilglass.no`. Hvert forsøk må få en **ny** CSRF-state og PKCE-verifier; gjenbruk aldri en tidligere Google OAuth-URL.
4. **Ikke kopier eller del** `GOOGLE_OAUTH_CLIENT_SECRET`, OAuth-kode eller Google refresh token. Hvis Web application-klienten ikke finnes i prosjektet, kontroller prosjekt/konto og klienttype før noen erstattes.
5. Verifiser status i ADMIN-siden og D1 (koblet Workspace-mailbox, én append-only samtykkehendelse). Aktiver først deretter `GMAIL_SYNC_ENABLED` og valider kontrollert inbox-synk.

**Status:** Klargjort OAuth-kode og tabeller på staging, men **ingen gyldig samtykke eller lagret Gmail-refresh-token er bekreftet**. Ikke hev at Workspace/Gmail er aktivert. Ikke endre produksjon.

Google-kilder: [OAuth Web Server – redirect_uri_mismatch](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors-redirect-uri-mismatch), [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257?hl=en).

## Oppdatering 11.11.2026 – redirect-adresse lagret i Google

Brukeren har oppdatert den **eksisterende** OAuth Web application-klienten «FinnBilGlass Access» i Google Cloud-prosjektet `gen-lang-client-0228405648` («Default Gemini Project»). Chrome-konteksten bekreftet at Google Cloud viser **«OAuth client saved»** og at autorisert redirect URI nr. 4 er nøyaktig `https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback`. Eksisterende Cloudflare Access- og offentlig OAuth-redirect ble beholdt.

**Neste kontroll:** Start en *ny* godkjenningsforespørsel fra `/ops/ansatte` etter eventuell Google-propagasjon. Velg bare `tomarne@finnbilglass.no`; ikke den private `tomarnejensen@gmail.com`. Verifiser at Google tillater samtykke, callback fullføres, riktig e-post blir lagret som kryptert autorisert Workspace-postkasse, og aktivert import fortsatt er `false` før sikker inbox-validering. Ved nytt `redirect_uri_mismatch`: bekreft klient-ID-en og vent på propagasjon, ikke opprett ny OAuth-app.

**Status:** Redirect er lagret; faktisk OAuth-godkjenning og Gmail-synk er **ennå ikke verifisert**. Ikke hev produksjons-GO.

## OAuth-status 11.11.2026 – Google Testing testbruker blokkert (403)

**Faktisk Google OAuth-feil etter at redirect URI ble lagret:** `403 access_denied` med meldingen «finnbilglass.no has not completed the Google verification process; app is currently being tested and can only be accessed by developer-approved testers». Brukeren valgte korrekt Workspace-konto `tomarne@finnbilglass.no` denne gangen. Google-signering er stoppet før consent, så det finnes **ikke en verifisert OAuth-grant eller et refresh token**.

**Løsning uten ny Workspace eller klient:** I [eksisterende Google Cloud-prosjekt → Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience?project=gen-lang-client-0228405648) hold `Publishing status=Testing`, klikk **Add users** under **Test users**, legg til `tomarne@finnbilglass.no`, lagre. Start deretter en **ny** engangskobling fra `https://ops-staging.finnbilglass.no/ops/ansatte`. Samtykke gis bare til eksisterende Workspace-konto, ikke privat Gmail.

**Viktig produksjonsforbehold:** Dette fjerner bare tilgangssperren under Testing. Ekstern OAuth-app i Testing med `gmail.readonly` gir normalt **7-dagers refresh-token-levetid**. Ikke markér Gmail som varig klart for produksjon på et slikt testtoken. Kontroller om eksisterende Google Cloud-prosjekt er/kan bli `Internal` under FinnBilGlass Workspace-organisasjon; hvis ikke, planlegg Google-verifisert External production-app / relevant Workspace-administrativ godkjenning. Ikke slå på `GMAIL_SYNC_ENABLED` før korrekt mailbox, scope, tokenlevetid og kontrollert testimport er verifisert. Unngå bredere OAuth-scope enn nødvendig.

Kilder: [Google Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en) og [Google OAuth token-expiration rules](https://developers.google.com/identity/protocols/oauth2).

## Staging callback-feil 11.11.2026 – **IKKE invitasjonsproblem**

- OPS-administrator er **`tomarnejensen@gmail.com`** med `ADMIN / ACTIVE` i D1. Dette er riktig **ansattidentitet i Cloudflare Access** og krever ingen ny invitasjon.
- Bedriftspostkassen er **`tomarne@finnbilglass.no`**. Denne skal godkjenne Googles `gmail.readonly` for *mailbox-tilkobling*, men skal **ikke** inviteres som en separat OPS-ansatt bare for OAuth-kobling.
- Google testbrukersperren (403) er passert, og brukeren har sett Gmail-tillatelsene. Google sendte callback til `/ops/ansatte?workspace=failed` etter forsøket. Uklart eksakt backend-feiltrinn før diagnostisk rettelse.
- [Skrivebeskyttet EU-staging-D1-diagnose #42935263831](https://github.com/tajlive/finnbilglass/actions/runs/42935263831): **5** OAuth-forsøk, **3** brukt/consumed, **2** ikke brukt, **0** lagrede krypterte grants, **0** OAuth-audithendelser. Må ikke tolkes som godkjent Gmail-tilkobling.
- [Ny sikker feildiagnostikk/stagingdeploy #42935961446](https://github.com/tajlive/finnbilglass/actions/runs/42935961446) **SUCCESS**: OAuth callback returnerer nå bare enum-klassifisert `reason` ved `workspace=failed` (eks. `token_http_400`, `token_incomplete`, `gmail_http_403`, `gmail_mailbox`, `database_save`), og administrasjonssiden viser forklaring som **ikke overskrives av session-meldingen**. Ingen Google auth-kode, refresh token eller provider-feiltekst logges/vises. Full QA og schema-rehearsal bestått, health 200, uautentisert OAuth start/status 401. Gmail-synk fortsatt AV. Engangsworkflow fjernet.
- **Neste kontroll:** En ny OAuth-godkjenning må startes fra `https://ops-staging.finnbilglass.no/ops/ansatte` siden forrige engangskode ble brukt. Velg *bedriftspostkassen* i Google, men behold OPS ADMIN-innlogget som den eksisterende brukeren. Les eventuelt `reason=...` på retursiden eller det norske feilsammendraget; utbedre først identifisert trinn. Del aldri `code`, `state` eller auth/token-URL.
- **Ingen produksjonsdeploy** eller reell Gmail-synk før positiv Workspace-grant, mailbox-kontroll, Gmail API-kontroll og avklart 7-dagers testtokenbegrensning.

## Oppdatering 11.11.2026 – Gmail API avviser profilkontroll med 403

- Google OAuth-testbruker og riktig `tomarne@finnbilglass.no` kom gjennom samtykkeflyten, og staging returnerte **`workspace=failed&reason=gmail_http_403`**. Dette lokaliserer feilen til `GET https://gmail.googleapis.com/gmail/v1/users/me/profile`, **etter** vellykket OAuth-tokenutveksling, men **før** et kryptert refresh token kunne lagres. Ingen Gmail-import, ingen gyldig Workspace-grant registrert.
- **Første kontroll i eksisterende Google Cloud-prosjekt** `gen-lang-client-0228405648`: åpne [Gmail API i prosjektets API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=gen-lang-client-0228405648). Dersom knappen er **Enable**, aktiver Gmail API. **Manage** betyr at API-et er aktivert; da undersøk Workspace Admin API Controls/domenepolicy og Googles spesifikke `error.reason`. Ikke opprett ny Google Workspace, ny OAuth-klient eller nye kontoer.
- Googles `users.getProfile` støtter eksisterende `gmail.readonly`-scope; det kreves **ikke** bredere lese-/skrive-/slettetillatelse.
- For å skille 403-årsakene har PR #57 fått **allowlist-klassifisering** av Google API `error.details[].reason` eller `error.errors[].reason`: `gmail_service_disabled`, `gmail_domain_policy`, `gmail_quota`, `gmail_scope_denied`, ellers `gmail_http_403`. Provider-feiltekster, OAuth-koder og tokens skal **aldri** vises i UI, redirect, SQL eller CI-logger. Testene har syntetiske Google-feilsvar.
- Nytt OAuth-samtykke blir nødvendig etter API-aktivering, siden tidligere callback-forsøk har brukt engangsstate og **ingen** godkjent Gmail-refresh-token er lagret. Staging `GMAIL_SYNC_ENABLED=false` forblir urørt frem til riktig postkasse er verifisert.
- `tomarnejensen@gmail.com` er allerede `ADMIN/ACTIVE` i OPS, og `tomarne@finnbilglass.no` vises nå som **`ADMIN/INVITED`** etter en eksplisitt invitasjon i OPS. Denne invitasjonen er **ikke** årsaken til Gmail API 403 og er ikke nødvendig for en e-postkonto-OAuth-grant. Ikke aktiver eller fjern medlemskapet automatisk bare for å reparere Gmail.

Kilder: [Google Gmail getProfile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile), [Gmail API 403 reasons](https://developers.google.com/workspace/gmail/api/guides/handle-errors), [Enable an API](https://docs.cloud.google.com/service-usage/docs/enable-disable).

## Status 11.11.2026 – Gmail API aktivert av prosjektets eier

- Brukeren bekrefter at **Gmail API er Enabled** i eksisterende Google Cloud-prosjekt `gen-lang-client-0228405648` / OAuth-klienten «FinnBilGlass Access». Dette er **rapportert av kontoeieren**, ikke uavhengig bekreftet med Google Service Usage API. Ingen ny Workspace, Google Cloud-klient eller ny OAuth-hemmelighet er nødvendig.
- Staging-Gmail OAuth var tidligere blokkert med `gmail_http_403` ved `users/me/profile` etter Google-samtykke; det er derfor relevant å prøve på nytt nå som API-et er aktivert. Oppdatert klassifiserer f.eks. `SERVICE_DISABLED`, `domainPolicy`, kvoter og utilstrekkelig tillatelse; [stagingdeploy #42937047246](https://github.com/tajlive/finnbilglass/actions/runs/42937047246) har bestått.
- Neste brukerhandling: Fra allerede autentisert `https://ops-staging.finnbilglass.no/ops/ansatte` velges «Godkjenn Gmail-lesetilgang én gang» og Workspace-konto `tomarne@finnbilglass.no`. **Start ny OAuth-flyt** – siste `state` og autorisasjonskode var engangsbruk og kan ikke gjenbrukes. Ingen kode/token sendes til chat eller GitHub.
- Når callback har returnert, verifiser **status Connected** for kun godkjent Workspace-postkasse, kryptert refresh token og append-only audit i isolert EU-staging-D1 via read-only metadata. En gyldig grant betyr fortsatt **ikke** at Gmail-synk er testet; `GMAIL_SYNC_ENABLED=false` skal beholdes til autoriserte alias, kontobekreftelse, inbox-isolasjon og en kontrollert synktest er bestått.
- Ekstern OAuth-app i `Testing` med Gmail `readonly` kan ha **7-dagers refresh-token-utløp**. Produksjonsdriftsmodell må håndtere dette før GO; ikke påstå at engangssamtykket i Testing gir varig produksjonstilgang.

## 11.11.2026 – Bekreftet kryptert Workspace-grant, status og sikker Gmail-preflight i staging

**Faktisk D1-verifisering:** [GitHub Actions #42938685548](https://github.com/tajlive/finnbilglass/actions/runs/42938685548) SUCCESS med kun aggregerte metadata mot eksakt EU-staging-D1 `78842e17-ab0b-47c1-acde-244044073466`. Resultater: **7** OAuth-forsøk totalt, **5** consumed, **1** lagret Workspace-grant med status `ACTIVE` og eksakt postkasse `tomarne@finnbilglass.no`, **1** gyldig kryptert tokenformat, **1** append-only `CONNECTED`-audit, og **0** `gmail_sync`-cursor-rader. Ingen refresh token, kode, meldingsinnhold eller AES-nøkkel ble lest ut eller loggført. Metadatajobben er fjernet fra grenen etter kontroll.

**Sikker ekstern test klar:** [Staging deploy #42939623482](https://github.com/tajlive/finnbilglass/actions/runs/42939623482) SUCCESS med full QA, isolert migrasjonsrehearsal, EU-D1/Worker-secret-kontroll og staging health 200; uautentisert OAuth start/status 401. En ny admin-only, Cloudflare Access-/CSRF-beskyttet handling `POST /api/ops/manual/workspace/oauth/preflight` og knappen **«Test Gmail-tilgang (uten import)»** i `/ops/ansatte` er lagt til. Preflight verifiserer det krypterte lagrede grant ved en OAuth token refresh + **kun** Gmail `users/me/profile`, med eksakt kontroll mot `tomarne@finnbilglass.no`. Returnerer bare faste statuskoder (f.eks. `PROFILE_VERIFIED`, `ALIAS_NOT_CONFIGURED`, `WRONG_MAILBOX`), booleans for mottakeradresse og importflagg. Ingen Gmail-liste, meldingsinnhold, historikk-ID, e-postsend, SQL-skriving eller import; 5 syntetiske tester for feiltilfeller er koblet til full QA. Engangsdeployment-workflow fjernet etter suksess.

**Ikke slå på import ennå:** `GMAIL_SYNC_ENABLED=false` og `OPS_INBOUND_ADDRESS` er ikke etablert/verifisert i stagingkonfigurasjon. For første kontrollerte import må faktisk FinnBilGlass-mottakeradresse, alias og kundesaksruting bevises. Prod er **NO-GO** og Google External Testing-grants krever løsning for stabil >7-dagers drift. Det kreves ingen ny Google Workspace, OAuth-klient eller ansattinvitasjon.

## Eksternt kontrollpunkt som ikke kan automatiseres uten samtykke

Bare **kontoens eier** kan gi den innloggede Workspace-postkassen Gmail `readonly` OAuth-rettigheter, og eksisterende OAuth-klient må ha riktig redirect URI i Google Cloud Console. Dette er ikke det samme som å opprette Google Workspace på nytt.
