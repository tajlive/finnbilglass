# FinnBilGlass Kustom staging-verifisering — 2026-11-08

## Resultat

**NO-GO for release og norske Checkout/HPP-metoder.** Playground Basic Auth og Express Checkout-konfigurasjon er nå bekreftet for Playground-MID `PM00730041`. Elements-origin for staging mangler, og Visa/Mastercard/Vipps er ikke testet i HPP. Ingen produksjonsendringer, ordre, capture eller refund ble utført.

## Releasekandidat og QA

- Arbeidsgren: `release/fbg-kustom-staging-20261108`, basert på `c371624aeb34d630e3b232eb45aa4831b5fb1284`.
- Kustom-kodecommit: `6a457ba7c27e5cded3ab59e9e315495dbb33f35e`. Siste dokumentasjonsoppdatering / kandidat-HEAD: `ecf2ca9d`; draft PR [#29](https://github.com/tajlive/finnbilglass/pull/29) er åpen. GitHub Actions-run `42482470005`: Typecheck, Testsuite og skanning etter secrets-filer PASS. PR er ikke merget og dette er ikke en produksjonsrelease.
- Nyeste kontrollerte kandidat-HEAD før dette rapporttillegget: `5d0a17b606c90be1331d0ffb0f9145484643f768`. Draft PR #29 er fortsatt åpen; gjeldende PR-verifisering `42482555511` PASS.
- `npm run typecheck`: PASS.
- `npm run test:kustom`: 37/37 PASS, 0 skipped.
- `npm run qa`: 648/648 PASS, 0 failed, 0 skipped.
- Gjentatt kontroll på releasekandidat med eksplisitt staging-OAuth-flag (HEAD `acb95a7bbd668b2726a4cd6e8a8efa7cbddf2bc8`): typecheck PASS, Kustom 37/37 PASS, full `npm run qa` exit status 0.
- Fersk kontroll på dokumentasjonsoppdatert HEAD `5eb34aba28449b6ed3e950b2cae3d4c88f9a9870`: `npm run qa` exit 0; Kustom 37/37 bestått, 0 hoppet over. `npm run test:vin-gt`: 17/17 bestått, 0 hoppet over; `ground-truth.jsonl`-fixture var til stede.
- `git diff --check`: PASS.
- `npm audit --omit=dev --audit-level=high`: 0 sårbarheter.
- `npm audit --audit-level=high`: 0 sårbarheter i alle avhengigheter.
- Wrangler staging dry-run: PASS. Bare staging D1/R2-bindinger ble vist; `KUSTOM_MONEY_MOVEMENTS_ENABLED=false`.
- Gitleaks: fire klassifiserte funn. Tre er `ACCESS_AUD`-verdier i Wrangler-konfig (audience-identifikator, ikke hemmelighet); ett er ordet «Nøkkel» i en eksisterende rapport. Ingen credential-verdi funnet i endringene.
- Denne arbeidskopiens `npm run qa`: 648/648 PASS, 0 hoppet over. Etterpå ble `npm run test:kustom` kjørt på siste kode: 37/37 PASS, 0 hoppet over; `npm run typecheck`, `git diff --check`, staging dry-run og `npm audit --omit=dev --audit-level=high` PASS.
- Ny fersk kjøring på HEAD `5d0a17b606c90be1331d0ffb0f9145484643f768`: `npm run qa` avsluttet med exit 0; `npm audit --omit=dev --audit-level=high` rapporterte 0 sårbarheter; worktree var ren og `git diff --check` PASS. Dette er lokal QA, ikke staging- eller Chrome E2E.

## Playground-tilgang

Diagnostikkruten ble midlertidig publisert kun på staging-worker `finnbilglass-frontrute-staging`, bak Cloudflare Access og ADMIN-allowlist. Den utførte faste GET-kall fra Worker-runtime. Credentials ble aldri returnert eller logget.

- `GET /checkout/v3/orders/does-not-exist`: **HTTP 404**, som Kustom dokumenterer som akseptert autentisering.
- `GET /config/checkout/v1/config/expressCheckoutPaymentMethods` med `X-merchant-id: M00808102`: **HTTP 200**.
- `GET /config/checkout/v1/config/country/NO/expressCheckoutPaymentMethods` med `X-merchant-id: M00808102`: **HTTP 200**.
- Begge konfigurasjonssvarene oppga `merchantId=PM00730041`, `country=NO`, `revision=533`. Dette er Playground-merchanten som også vises i Playground-portalen. API-et returnerte ikke `M00808102`; Merchant ID for produksjon er derfor **ikke bekreftet i Playground**.
- Konfigurasjonen for Playground `PM00730041`: Apple Pay **enabled=true**, Google Pay **enabled=true**, Klarna **enabled=true**, Amazon Pay **false**, PayPal **false**. Dette bekrefter bare Express Checkout-konfigurasjon for Playground, ikke betalingsavtale/HPP for produksjon.
- `GET /elements/v1/clients/`: **HTTP 200** for `PM00730041`. Klientens merchant stemmer med Playground-portalen; offentlig nøkkel matcher staging-preview-nøkkelen som koden allerede bruker. Tillatte origins er bare `https://finnbilglass.no` og `https://www.finnbilglass.no`. `workers.dev`-staging-origin er ikke tillatt. `placements=[]`, altså ingen Payment Method Display-plassering i denne klienten.
- GET-konfigurasjonen ble kun lest. Ingen PUT/DELETE, betalingsmetodeendring, ordre, capture eller refund ble utført.

### Skrivebeskyttet Playground-portal

- Innlogget portal på `portal.playground.kustom.co` viser valgt butikk `FinnBilglass – PM00730041`. API-autentisering og Elements-klientrespons bekrefter nå at dette er Playground-MID-en for de eksisterende staging-credentials. Eieroppgitt `M00808102` er ikke samme MID i Playground.
- Elements-siden viser `finnbilglass.no` og `www.finnbilglass.no` som FinnBilglass-domener. Staging-origin `finnbilglass-frontrute-staging.tomarnejensen.workers.dev` er ikke oppført.
- Betalingsmetode-siden viser en katalog på 22 metoder, med Visa, Mastercard, Vipps, Klarna, Apple Pay og Google Pay som katalogoppføringer. Land/tilgjengelighet i denne katalogen bekrefter ikke at metoden er aktivert for Checkout/HPP eller forhandleravtalen.
- Ingen portalinnstillinger ble endret, ingen credential-sider eller passord ble åpnet, og ingen Playground-ordre ble opprettet.

Kustoms dokumentasjon sier at API-username normalt er `<MID>-<randomsuffix>`, og Playground-credentials er miljøspesifikke. Workerens staging-credential samsvarte med Playground-portalens `PM00730041` og passordet var av Playground-type. Basic Auth er verifisert gjennom 404-kallet.

## Staging-deploy og tilbakeføring

- Midlertidig første diagnostikkversjon: `6c4feac8-b66c-4f20-b076-db9ecde18570`.
- Korrigert ADMIN-allowlist-diagnostikk: `6116da08-63b9-4496-a7b0-3cf715b81b0c`.
- Etter credential-scope-avvik ble staging-worker rullet tilbake til `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` (100%).
- Chrome viste deretter `Siden finnes ikke` for diagnostikk-URL-en. Diagnostikkruten er ikke aktiv i staging.
- Ny kontroll etter at credentials kunne ha blitt oppdatert: midlertidig versjon `400730b8-9ab7-4a08-94a4-8cde93773d40` ga samme HTTP 409 og samme scope-mismatch, uten Kustom-kall. Rullet straks tilbake til `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` på 100%; Chrome-innlasting etter tilbakeføring viste `Siden finnes ikke`.
- Ny, korrigert Playground-MID-diagnostikk ble midlertidig deployet som versjon `0c0d1896-99c2-44f9-9773-0ffe888a9bd1`, deretter flere transportdiagnostikkversjoner og til slutt `290b605c-9950-46b4-add5-0b5aade6357e`. Den siste ga vellykkede GET-resultater over. Umiddelbart etterpå ble staging rullet tilbake til `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` (100%). Chrome viste `Siden finnes ikke`; diagnostikkruten er deaktivert.
- Ingen D1-migrering ble kjørt. Produksjons-worker og produksjonsbindinger ble ikke endret.

### Siste skrivebeskyttede Cloudflare-kontroll

- `wrangler deployments list --name finnbilglass-frontrute-staging` viser staging-worker `finnbilglass-frontrute-staging` med versjon `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` på 100% etter rollback. Ingen ny versjon ble publisert i denne kontrollen.
- Wrangler-konfigurasjonene for staging peker på konto-ID `80d5b1d56a3e907150ba7348b6182894`; `wrangler whoami` viser visningsnavnet `KLARPAKKE` for denne kontoen. Dette er kontovisningsnavnet, ikke FinnBilGlass-stagingens URL. Chrome viste kun FinnBilGlass på `finnbilglass-frontrute-staging.tomarnejensen.workers.dev`; `klarpakke.no` eller Kustoms produksjonsportal ble ikke åpnet. Konto-/eierskapskoblingen må eksplisitt avklares før flere stagingpubliseringer, for å sikre at FinnBilGlass staging skal ligge i denne kontoen.
- Den eksisterende staging-workerens offentlige visning er FinnBilGlass. Den lokale diagnostikkruten er ikke publisert, og Kustom-konfigurasjonen har ikke endret seg.

Wrangler viste først at `OAUTH_ENABLED_PROVIDERS` manglet under `env.staging.vars`. Jeg la inn `google` eksplisitt i releasekandidaten; secret-navnene for Google OAuth finnes i Cloudflare staging (verdiene ble ikke lest). Etter endringen passerer staging dry-run uten denne advarselen. Den aktive staging Worker ble rullet tilbake til versjonen før diagnostikk og har ennå ikke fått denne kandidatendringen; OAuth-innlogging og admin-E2E gjenstår.

## Elements- og Chrome-funn

- Chrome i 390 px responsive viewport lastet den aktive stagingversjonens glassflyt for testskilt `SU18018` (VW Transporter 2005) og nådde resultatlisten for frontrute. UI-et viste flere mulige varianter, utstyrsspørsmål og at glassvalg/pris kontrolleres manuelt før tilbud. Ingen glassvariant ble valgt, og ingen tilbudsforespørsel eller ordre ble sendt. Dette er en avgrenset mobilkontroll, ikke full mobil-E2E.
- Desktop Chrome på aktiv staging for testskilt `SU18018` fant VW Transporter 2005 og viste 39 mulige glassvarianter (5 frontruter). UI-et krevde manuelle utstyrsvalg; ingen variant var forhåndsvalgt. Ingen variant ble valgt, og tilbudsskjema ble ikke sendt. Dette er en delvis skrivebeskyttet flyt, ikke full desktop-E2E.
- Den aktive, eldre stagingversjonen serverer et Payment Method Display med `locale="nb-NO"` og uten `include`, og laster Playground-CDN-script direkte. API-kontrollen bekrefter at staging-preview-nøkkelen hører til Playground-klienten, men klienten har ingen Payment Method Display-plassering og staging-origin er ikke tillatt.
- Chrome Console viste en CSP report-only-advarsel for `https://js.playground.kustom.co/kustom-elements/v1/pre-load.js` og feilen `Cannot read properties of undefined (reading '_internal')` i `pre-load.js`. Derfor er komponenten **ikke funksjonell**; skjermen viste kun overskriften «Betalingsmetoder», ingen metoder eller logoer.
- Kustoms oppdaterte installasjonsveiledning krever Portal-snippeten med initialisering av `window.kustomElements`; det serverte staging-scriptet injiserer bare CDN-scriptet. Denne eldre implementasjonen er ikke med i releasekandidaten. Kandidaten viser ingen betalingsmetoder før Merchant ID, public key og origin er verifisert.
- Staging-siden bruker `workers.dev`; det er ikke bevis for at denne origin er Kustom-registrert. Kustom docs krever at origin er tillatt i Elements-klienten.

## Staging D1 og migreringer

- Read-only `wrangler d1 migrations list finnbilglass-staging-auth --env staging --remote`: «No migrations to apply».
- Read-only katalog-D1-kontroll viser eksisterende applikasjonstabeller, inkludert katalog/tilbud; Kustom-ledger-tabellene ligger i auth-D1. `SELECT name FROM d1_migrations` i `finnbilglass-staging-catalog` returnerte ingen rader.
- Wrangler lister katalogmigrasjonene `0001`–`0048c` som ventende fordi katalogbindingen ikke angir en egen `migrations_dir`, mens historikktabellen er tom. Dette er ikke bevis for at skjemaet mangler; det viser at migration tracking ikke samsvarer med repoets migrasjonskø. Ingen migrering ble kjørt. Dette må avklares og sikkerhetskopieres før en migration-/releaseplan kan godkjennes.
- Begge remote schema-forespørslene var `SELECT` og Cloudflare rapporterte `changed_db=false`, `rows_written=0`.

## Betalingsmetoder og gjenstående blokkeringer

- Apple Pay: **BEKREFTET** aktivert i Playground Express Checkout for `PM00730041`; ikke verifisert i HPP eller produksjon.
- Google Pay: **BEKREFTET** aktivert i Playground Express Checkout for `PM00730041`; ikke verifisert i HPP eller produksjon.
- Klarna: **BEKREFTET** aktivert i Playground Express Checkout for `PM00730041`; ikke verifisert i HPP eller produksjon.
- Visa, Mastercard og Vipps: **IKKE BEKREFTET**. Payment Method Display har ingen plassering; ingen syntetisk HPP-ordre ble opprettet. Katalogoppføring i portalen er ikke aktiveringsbevis.
- Playground Merchant ID: **PM00730041**. Produksjons-ID `M00808102` ble ikke bekreftet i Playground og fikk ikke samme MID i konfigurasjonssvarene.
- Staging-origin må tillates i Elements-klienten før staging Elements kan fungere. Det må gjøres kun etter at Kustom har bekreftet at endringen er kostnadsfri og i riktig Playground-klient; denne oppgaven endret ikke Kustom-innstillinger.
- En syntetisk Playground HPP-ordre og individuell Visa/Mastercard/Vipps-verifisering gjenstår. Ingen ekte penger, capture eller refund.
- Etter den siste QA-kontrollen ble det ikke opprettet syntetisk ordre eller HPP-session. Stagingkontoens Cloudflare-eierskap er uavklart, så det er ikke trygt å publisere ny midlertidig diagnostikk før den koblingen er bekreftet.
- Katalog-D1 migration tracking er uavklart (`0001`–`0048c` ser ventende ut), admin/OAuth-E2E og full desktop/mobil kundereise gjenstår. Produksjonsrelease: **NO-GO**.
