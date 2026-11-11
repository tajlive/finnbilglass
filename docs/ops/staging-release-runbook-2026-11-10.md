# FinnBilGlass — fast stagingløyfe og første salg (10.11.2026)

> **Sikkerhetsoverstyring 11.11.2026:** Denne historiske runbooken beskriver et eldre oppsett med `STAGING_CLOUDFLARE_API_TOKEN` og konto-bred `D1 Edit`. **IKKE FØLG disse eldre token-/migrasjonsinstruksjonene**: staging og produksjon deler konto, og Cloudflare D1 Edit er ikke isolert til stagingdatabasen. Migrasjon 0046 er allerede bekreftet PASS i reell staging-D1 med uavhengig read-only QA. Ikke migrer den på nytt. Bruk den oppdaterte, godkjenningspliktige **[eksakt-SHA Worker-deploy-runbooken](staging-exact-sha-worker-deploy.md)**. Ingen produksjonsruter, konto-bred D1-skrivetoken eller automatisk Kustom-betaling er tillatt.


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

## Oppdatert D1-provisjonering – 10.11.2026

- **Bekreftet:** `finnbilglass-db-staging` eksisterer nå i Cloudflare-konto `80d5b1d56a3e907150ba7348b6182894`. UUID: `78842e17-ab0b-47c1-acde-244044073466`, opprettet med **EU-jurisdiksjon** i [en engangsjobb #42902714452](https://github.com/tajlive/finnbilglass/actions/runs/42902714452). Den påfølgende [kontrollen #42902912457](https://github.com/tajlive/finnbilglass/actions/runs/42902912457) bekreftet aktiv eksisterende API-token, D1-lesetilgang og **riktig** stagingdatabase-ID.
- Stagingbindingen i `wrangler.staging.toml` og D1-ID-sperrene i `.github/workflows/staging-ops.yml` på `main` bruker nå korrekt UUID. Den tidligere ID-en `6c8c3eeb-e4bb-41c7-831f-25e5a735717c` finnes ikke i kontoens D1-liste.
- Engangsjobben som kunne opprette ny D1 er **fjernet fra repositoryet etter verifikasjon**; `staging-credential-diagnostic.yml` er beholdt som kun manuelt startbar, skrivebeskyttet kontroll. Eksisterende `CLOUDFLARE_API_TOKEN` ble brukt bare til avgrenset bootstrap og inspeksjon, **ikke** som permanent fallback for D1-migrasjoner og stagingdeploy.
- **Viktig NO-GO:** Den nye D1-databasen er tom. Før migrasjonene `0040–0044` må basis-tabellene (minst `beta_inquiries` og `beta_inquiry_events`, og nødvendig resolver-/katalogskjema) opprettes i en kontrollert, sporbar prosess uten kopiering av reelle kundedata fra produksjon. Kontroller skjema og testdata eksplisitt, og test hele tilbud/ordre/synk-kjeden. Ikke bruk `finnbilglass-staging-auth` eller produksjons-D1 som erstatning.
- **Ekstern engangsblokkering:** GitHub Environment `staging` mangler fortsatt `STAGING_CLOUDFLARE_API_TOKEN`. Den skal opprettes som dedikert staging-token og verifiseres før stagingmigrasjon/deploy. Ikke lim tokenverdi i chat eller logger.

## Verifisert stagingdrift 10.11.2026 – komplett nytt EU-skjema og første admin

**Bestått og dokumentert:**

- [Kredential-/DB-kontroll #42902912457](https://github.com/tajlive/finnbilglass/actions/runs/42902912457): Cloudflare API-token godkjent, korrekt staging-D1 navn/UUID i EU.
- [Full migrasjonsrehearsal #42904250976](https://github.com/tajlive/finnbilglass/actions/runs/42904250976): gjeldende schema- og OPS-SQL bestod offline, uten Cloudflare-token.
- [Éngangsklargjøring #42904681771](https://github.com/tajlive/finnbilglass/actions/runs/42904681771): nøyaktig **22 historiske basismigrasjoner + 5 OPS-migrasjoner** lagt til på den tidligere helt tomme databasen `finnbilglass-db-staging` / `78842e17-ab0b-47c1-acde-244044073466`. Konto, UUID og jurisdiksjon `eu` ble verifisert **før** skriving; D1 Time Travel-bokmerke er dokumentert i workflow-oppsummeringen. Alle påkrevde OPS-tabeller finnes, **0 kundehenvendelser** ble opprettet og ingen produksjonsdata ble kopiert.
- [Første admininvitasjon #42905319320](https://github.com/tajlive/finnbilglass/actions/runs/42905319320): én `ADMIN`-medlemskapspost med status `INVITED` opprettet for eksisterende oppsatt administrator `tomarnejensen@gmail.com`, uten e-postutsending eller ekstra app-passord. Aktiviseres først ved signert Access-innlogging. Den første feilede kjøringen #42905287009 ble rettet og erstattet av den beståtte kjøringen.
- Begge **én-gangs skrive-workflows** er slettet fra `main` etter suksess. Den eksisterende Cloudflare repo-tokenen ble bare brukt som midlertidig, kontrollert bootstrap; ingen permanent fallback til produksjonsorientert token er innført.

**Ny Access/Resend-readiness:** [read-only #42905866593](https://github.com/tajlive/finnbilglass/actions/runs/42905866593) bekrefter at `RESEND_API_KEY` finnes på staging Worker, mens **`OPS_ACCESS_TEAM_DOMAIN`** og **`OPS_ACCESS_AUD`** mangler. Cloudflare-tokenen kan liste Worker secrets men får **HTTP 403** mot Access-organisasjonen; Access-applisten viste 0 poster i denne tokenens kontovisning. Dette beviser ikke at Access-apps mangler globalt. Offentlig staging `/health` svarte 403 og er derfor **ikke** en bestått smoke-test.

**Neste handlinger før Worker-deploy:**

1. Kontroller Cloudflare Zero Trust-konto som eier `Operations Staging`. Finn *Team domain* (`*.cloudflareaccess.com`) og riktig *Application AUD tag* for den aktuelle staging-host; påse at appen bruker riktig host og har en Allow-policy for inviterte ansatte. Gi en egen autorisert staging-token til GitHub Environment `staging` under `STAGING_CLOUDFLARE_API_TOKEN`. Ikke kopier eksisterende repo-token til Access-policy via frontendkode eller logger.
2. Installer de to manglende Access-verdiene på **bare** `finnbilglass-frontrute-staging` som Worker secrets. Disse verdiene er identifikatorer, ikke personlige Google-/Workspace OAuth-nøkler. Verifiser at Resend-secret beholdes.
3. Kjør releaseporten med `inspect_staging=true`, `apply_migrations=false` (migrasjonene er **allerede installert**), `deploy=false`. Dokumenter D1/Worker-secrets; gjennomfør deretter kun stagingdeploy med `deploy=true`.
4. Test to ansattroller, syntetisk forespørsel, kontrollert tilbud/Resend, deduplisering, Gmail-synk etter godkjent OAuth, dokumentert kundeaksept og kun én manuell ordre. Betalingslenke må fortsatt testes uten reell belastning.

**Fortsatt NO-GO for produksjon** til staging-Worker og komplett handel er dokumentert med faktiske testkall. Ingen kundedata, Worker-deploy, e-post eller penger ble behandlet av de ovennevnte bootstrapjobbene.

## Staging Worker faktisk deployet – Cloudflare CLI 10.11.2026

- **Eksisterende Cloudflare Access-app identifisert uten Zero Trust-adminrettigheter:** `ops-staging.finnbilglass.no` gir `302` mot `tomarnejensen.cloudflareaccess.com`. Cloudflare Access' offentlige innloggings-`kid` ble verifisert mot staginghosten og gir eksakt application **AUD** `8e526c95018b6569d35cf08fba4148e54f1f66a8322246359cb58f5513bc8dbb`. Se [CLI-oppdagelse #42907601189](https://github.com/tajlive/finnbilglass/actions/runs/42907601189).
- **De to manglende staging Worker-secrets er installert:** `OPS_ACCESS_TEAM_DOMAIN` og `OPS_ACCESS_AUD`. Eksisterende `RESEND_API_KEY` er beholdt. [Engangskjøring #42907894618](https://github.com/tajlive/finnbilglass/actions/runs/42907894618) SUCCESS. Secret-oppdateringen berørte kun `finnbilglass-frontrute-staging`. Zero Trust-policy er ikke endret.
- **Faktisk stagingdeploy med Wrangler CLI:** [#42908130357](https://github.com/tajlive/finnbilglass/actions/runs/42908130357) **SUCCESS**. Fastlåst PR #57 HEAD `f01946960d46fcb2fe0d0e758e102d1c4ae64d48`; `npm ci`, full `npm run qa`, offline schema-rehearsal og staging dry-run før token ble brukt. Fysisk EU-D1 identitet, alle tre nødvendig Worker-secret-navn og fravær av produksjonsruter ble kontrollert. `wrangler deploy --config wrangler.staging.toml` fullførte, og `workers.dev/health` svarte HTTP **200** etterpå.
- Både privilegert engangsjobben for Access-verdier og engangsjobben for stagingdeploy er **fjernet** fra `main` etter vellykket kjøring. Repo-token ble brukt som avgrenset engangs-bootstrap; varig releaseport krever fremdeles dedikert `STAGING_CLOUDFLARE_API_TOKEN` i GitHub Environment `staging`.
- **Ikke forveksle deploy med E2E-godkjenning:** Den første faktiske Access-innloggingen (inkl. D1 INVITED→ACTIVE), minst én til invitert ansatt, kundesak→tilbud→Resend→aksept→ordre, duplikatkontroll, Gmail Workspace OAuth og Kustom manuelt må fremdeles prøves i staging. Ingen ekte e-postutsending eller betaling ble foretatt av deployjobben. Produksjon fortsatt **NO-GO**.

## Første innlogging og syntetisk kundemottak – verifisert 10.11.2026

- **Faktisk første admin-innlogging:** [D1-kontroll #42909653531](https://github.com/tajlive/finnbilglass/actions/runs/42909653531) bekreftet `ADMIN/ACTIVE`, `accepted_at`, `last_login_at` og én `LOGIN`-hendelse. Google/Cloudflare Access-innlogging + D1-invitasjon fungerer uten et andre app-passord. Ingen sensitiv JWT lagret eller vist. Den engangs, skrivebeskyttede verifikasjonsjobben er slettet fra `main` etterpå.
- **Oppdaget faktisk feil:** Første syntetiske POST `/api/inquiry` fikk HTTP **500** i [kjøring #42910003796](https://github.com/tajlive/finnbilglass/actions/runs/42910003796). Årsaken var at nyopprettet staging-D1 manglet `feature_flags` – migrasjon `0005_feature_flags.sql` var utelatt fra det ferske D1-manifestet. `henvendelserTillatt()` slår opp i denne tabellen før en forespørsel lagres.
- **Rettet i kun EU-staging:** [D1-migrasjon #42910257950](https://github.com/tajlive/finnbilglass/actions/runs/42910257950) bekreftet riktig UUID/jurisdiksjon, at tabellen manglet og et Time Travel-bokmerke, kjørte den uendrede `0005_feature_flags.sql` og la inn `inquiries_enabled=1` kun i staging. Testen bekreftet at alle nødvendige flagg er på plass. Privilegert engangsjobb er slettet. Manifestet `scripts/maintenance/staging-fresh-db-manifest.json` omfatter nå `0005`, så dette ikke gjentas ved neste nye stagingmiljø.
- **Ekte syntetisk inngangs-E2E:** [kundetest #42910460374](https://github.com/tajlive/finnbilglass/actions/runs/42910460374) **SUCCESS** mot distribuert `workers.dev`: én ny sak **#1**, HTTP 201; identisk retry med samme `Idempotency-Key` gir samme ID; endret payload med samme nøkkel gir HTTP 409. D1 bekrefter én opprettelseshendelse og **0 automatiske tilbud/ordre**. Data: oppdiktet kontakt med `.invalid`, **ingen bilregistrering**, ingen ekte utsending eller betaling. Engangsjobben er slettet etterpå.
- **Neste verifiserbare milepæl:** Åpne `ops-staging.finnbilglass.no/ops` etter autentisering, oppdater saker og behandle syntetisk sak **#1** via den ekte ansatt-API-en. Utfør først manuell evidenskontroll, opprett og send testtilbud med godkjent testmottaker, registrer dokumentert aksept og opprett én ordre. Ikke omgå signert Access JWT med SQL-writes – bare en reell interaktiv ansattøkt kan bevise den delen av E2E. Gmail kan først testes med korrekt Workspace OAuth. **Ingen prod-GO** før dette er dokumentert.

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
