# FinnBilGlass Kustom staging-verifisering — 2026-11-08

## Resultat

**NO-GO for API-integrasjon, betalingsmetoder og release.** Ingen produksjonsendringer, ordre, capture eller refund ble utført.

## Releasekandidat og QA

- Arbeidsgren: `release/fbg-kustom-staging-20261108`, basert på `c371624aeb34d630e3b232eb45aa4831b5fb1284`.
- `npm run typecheck`: PASS.
- `npm run test:kustom`: 37/37 PASS, 0 skipped.
- `npm run qa`: 648/648 PASS, 0 failed, 0 skipped.
- Gjentatt kontroll på releasekandidat med eksplisitt staging-OAuth-flag (HEAD `acb95a7bbd668b2726a4cd6e8a8efa7cbddf2bc8`): typecheck PASS, Kustom 37/37 PASS, full `npm run qa` exit status 0.
- `git diff --check`: PASS.
- `npm audit --omit=dev --audit-level=high`: 0 sårbarheter.
- `npm audit --audit-level=high`: 0 sårbarheter i alle avhengigheter.
- Wrangler staging dry-run: PASS. Bare staging D1/R2-bindinger ble vist; `KUSTOM_MONEY_MOVEMENTS_ENABLED=false`.
- Gitleaks: fire klassifiserte funn. Tre er `ACCESS_AUD`-verdier i Wrangler-konfig (audience-identifikator, ikke hemmelighet); ett er ordet «Nøkkel» i en eksisterende rapport. Ingen credential-verdi funnet i endringene.

## Playground-tilgang

Diagnostikkruten ble midlertidig publisert på staging-worker `finnbilglass-frontrute-staging`, bak Cloudflare Access, og kalt fra Chrome med den eksisterende innloggede økten.

- Diagnostikkens HTTP-status: **409**.
- Responsens ikke-hemmelige felt: `merchantId=M00808102`, `credentialMerchantMatches=false`, `credentialIsPlayground=true`, `error=CREDENTIAL_SCOPE_MISMATCH`.
- Ruten gjorde derfor ingen forespørsel til Kustom. Checkout-autentiseringens HTTP-status er **ikke målt**; ingen GET til ordre-endepunktet eller config-endepunktene ble sendt.
- Merchant-ID for butikk/produksjonsportal er oppgitt som bekreftet av eier, men credentials i staging er ikke verifisert mot `M00808102`.
- Express Checkout, NO-konfigurasjon, Elements origins, Visa, Mastercard, Vipps, Klarna, Apple Pay og Google Pay er **IKKE BEKREFTET**.

Kustoms dokumentasjon sier at API-username normalt er `<MID>-<randomsuffix>`, mens Playground-passord starter med `kco_test_api_`. Diagnostikken så bare på prefikser inne i Worker-runtime; credential-verdier ble verken returnert eller logget. Ettersom username-prefikset ikke samsvarte med oppgitt Merchant ID, ble ikke credentialen sendt til leverandøren.

## Staging-deploy og tilbakeføring

- Midlertidig første diagnostikkversjon: `6c4feac8-b66c-4f20-b076-db9ecde18570`.
- Korrigert ADMIN-allowlist-diagnostikk: `6116da08-63b9-4496-a7b0-3cf715b81b0c`.
- Etter credential-scope-avvik ble staging-worker rullet tilbake til `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` (100%).
- Chrome viste deretter `Siden finnes ikke` for diagnostikk-URL-en. Diagnostikkruten er ikke aktiv i staging.
- Ny kontroll etter at credentials kunne ha blitt oppdatert: midlertidig versjon `400730b8-9ab7-4a08-94a4-8cde93773d40` ga samme HTTP 409 og samme scope-mismatch, uten Kustom-kall. Rullet straks tilbake til `0bed424b-b66a-41ed-9f5a-1f0e6cd3854f` på 100%; Chrome-innlasting etter tilbakeføring viste `Siden finnes ikke`.
- Ingen D1-migrering ble kjørt. Produksjons-worker og produksjonsbindinger ble ikke endret.

Wrangler viste først at `OAUTH_ENABLED_PROVIDERS` manglet under `env.staging.vars`. Jeg la inn `google` eksplisitt i releasekandidaten; secret-navnene for Google OAuth finnes i Cloudflare staging (verdiene ble ikke lest). Etter endringen passerer staging dry-run uten denne advarselen. Den aktive staging Worker ble rullet tilbake til versjonen før diagnostikk og har ennå ikke fått denne kandidatendringen; OAuth-innlogging og admin-E2E gjenstår.

## Elements- og Chrome-funn

- Chrome i 390 px responsive viewport lastet den aktive stagingversjonens glassflyt for testskilt `SU18018` (VW Transporter 2005) og nådde resultatlisten for frontrute. UI-et viste flere mulige varianter, utstyrsspørsmål og at glassvalg/pris kontrolleres manuelt før tilbud. Ingen glassvariant ble valgt, og ingen tilbudsforespørsel eller ordre ble sendt. Dette er en avgrenset mobilkontroll, ikke full mobil-E2E.
- Desktop-kontrollen ble tidligere stoppet ved variantvalg uten å sende forespørsel; full kundereise er ikke bestått.
- Den aktive, eldre stagingversjonen serverer et Payment Method Display med `locale="nb-NO"` og uten `include`, og laster Playground-CDN-script direkte. Kustoms offentlige nøkkel og tilhørende Merchant ID kan ikke verifiseres før API-tilgangen fungerer; staging-origin er heller ikke bekreftet i Kustom Elements-klientlisten.
- Chrome Console viste en CSP report-only-advarsel for `https://js.playground.kustom.co/kustom-elements/v1/pre-load.js` og feilen `Cannot read properties of undefined (reading '_internal')` i `pre-load.js`. Derfor er komponenten **ikke funksjonell**; skjermen viste kun overskriften «Betalingsmetoder», ingen metoder eller logoer.
- Kustoms oppdaterte installasjonsveiledning krever Portal-snippeten med initialisering av `window.kustomElements`; det serverte staging-scriptet injiserer bare CDN-scriptet. Denne eldre implementasjonen er ikke med i releasekandidaten. Kandidaten viser ingen betalingsmetoder før Merchant ID, public key og origin er verifisert.
- Staging-siden bruker `workers.dev`; det er ikke bevis for at denne origin er Kustom-registrert. Kustom docs krever at origin er tillatt i Elements-klienten.

## Staging D1 og migreringer

- Read-only `wrangler d1 migrations list finnbilglass-staging-auth --env staging --remote`: «No migrations to apply».
- Read-only katalog-D1-kontroll viser eksisterende applikasjonstabeller, inkludert katalog/tilbud; Kustom-ledger-tabellene ligger i auth-D1. `SELECT name FROM d1_migrations` i `finnbilglass-staging-catalog` returnerte ingen rader.
- Wrangler lister katalogmigrasjonene `0001`–`0048c` som ventende fordi katalogbindingen ikke angir en egen `migrations_dir`, mens historikktabellen er tom. Dette er ikke bevis for at skjemaet mangler; det viser at migration tracking ikke samsvarer med repoets migrasjonskø. Ingen migrering ble kjørt. Dette må avklares og sikkerhetskopieres før en migration-/releaseplan kan godkjennes.
- Begge remote schema-forespørslene var `SELECT` og Cloudflare rapporterte `changed_db=false`, `rows_written=0`.

## Gjenstående leverandørblokkering

Cloudflare-staging-secret `KUSTOM_API_USERNAME` må erstattes med en Playground API username som tilhører `M00808102`; passordet må forbli Playground-testcredential. Den eksisterende verdien skal kun oppdateres via godkjent secret-håndtering. Ikke kopier den til terminal, logg, Git eller rapport. Når dette er rettet, kjør diagnostikk igjen; kun etter verifisert autentisering kan betalingsmetoder eller Elements origins rapporteres.
