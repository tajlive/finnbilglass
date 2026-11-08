# FinnBilGlass Kustom staging-verifisering — 2026-11-08

## Resultat

**NO-GO for API-integrasjon, betalingsmetoder og release.** Ingen produksjonsendringer, ordre, capture eller refund ble utført.

## Releasekandidat og QA

- Arbeidsgren: `release/fbg-kustom-staging-20261108`, basert på `c371624aeb34d630e3b232eb45aa4831b5fb1284`.
- `npm run typecheck`: PASS.
- `npm run test:kustom`: 37/37 PASS, 0 skipped.
- `npm run qa`: 648/648 PASS, 0 failed, 0 skipped.
- `git diff --check`: PASS.
- `npm audit --omit=dev --audit-level=high`: 0 sårbarheter.
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
- Ingen D1-migrering ble kjørt. Produksjons-worker og produksjonsbindinger ble ikke endret.

## Gjenstående leverandørblokkering

Cloudflare-staging-secret `KUSTOM_API_USERNAME` må erstattes med en Playground API username som tilhører `M00808102`; passordet må forbli Playground-testcredential. Den eksisterende verdien skal kun oppdateres via godkjent secret-håndtering. Ikke kopier den til terminal, logg, Git eller rapport. Når dette er rettet, kjør diagnostikk igjen; kun etter verifisert autentisering kan betalingsmetoder eller Elements origins rapporteres.
