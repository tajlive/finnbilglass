# FinnBilGlass – instruksjoner til kodeagenter

Dette repoet er et bilglass-/tilbuds- og ordresystem med Cloudflare Workers, D1 og TypeScript.
Arbeid i små, etterprøvbare PR-er. Ikke anta at staging og produksjon har samme database eller secrets.

## Sannhetskilder
- Releaseplan: `docs/OPS_RELEASE_PLAN_FinnBilGlass_2026-11-11.md`.
- Manuell første-salg-kode: [PR #81](https://github.com/tajlive/finnbilglass/pull/81) MERGED. Produksjons-SQL: [PR #83](https://github.com/tajlive/finnbilglass/pull/83) MERGED. Aktiv produksjonsflaggkandidat: [draft PR #82](https://github.com/tajlive/finnbilglass/pull/82). Eldre [PR #57](https://github.com/tajlive/finnbilglass/pull/57) er staginghistorikk, ikke grunnlag for ny merge. Sjekk fersk SHA/status før endring.
- Eksisterende arbeid: Issues #39 (release/rollback), #52 (manuelt salg), #38 (e-post), #37 (invitasjon) og #36 (auth). Oppdater eksisterende saker fremfor å opprette dubletter.

## Endringsregler
1. Les gjeldende kode og relevante tester; avklar riktig basebranch. Ikke skriv blindt til `main`.
2. Bevar alle historiske `beta_inquiries`, `beta_inquiry_events`, bilder, notater, tilbud, ordrefelt og betalingsreferanser. Gamle statuser må ikke nullstilles. Nye saker kan legges til.
3. Eksisterende `ops_manual_offers` med bare `sku` skal fortsette å fungere. `UTEN-VARENUMMER` er intern markør, aldri et faktisk kundenummer. Flervarelinjestøtte må være additiv og fryse avtalte beløp.
4. Katalogtreff er ikke bevis på korrekt rute. Ikke merk glass som EXACT uten uavhengig OE-/foto-bevis etter prosjektets policy.
5. Manuell salgsstart: forespørsel → dokumentert glasskontroll → tilbud → dokumentert kundeaksept → én ordre → manuell Kustom Portal-lenke og manuell betalingskontroll. Ikke automatiser capture/refund eller sett PAID ved utsendt lenke.
6. Gmail-import forblir av frem til riktig Workspace-postboks, alias og samtykke er kontrollert. Ikke les eller kopier private meldinger.
7. Bruk syntetiske testkunder. Aldri commit API-nøkler, tokens, reelle kundedata, lokale .env-filer eller D1-eksporter.
8. Prod-D1-migrasjoner, ekte utsendelser, live betalinger og deploy krever eksakte kontrollpunkter, backup/rollback og releasebevis. Kjør ikke alle pending-migrasjoner.
9. Dokumenter endring med PR, faktisk testkommando, commit SHA og GitHub Actions-run. Ikke merk produksjonsoppgave ferdig bare fordi CI er grønn.

## Arbeidsflyt
- Bruk Node 22 og `npm ci`.
- Normal QA: `npm run qa` og `npx tsc --noEmit`.
- OPS staging-kandidat: `python3 scripts/maintenance/staging-migration-rehearsal.py` og `npx wrangler deploy --config wrangler.staging.toml --dry-run` (ingen Cloudflare-credentials).
- Kjenn igjen at `main` og draft PR #57 har forskjellig OPS-kode. Test riktig branch og lever aldri utestet OPS-kode via dokumentasjons-PR.
- Skriv kort norsk oppsummering: gjort, testet, gjenstår, eventuell GO/NO-GO. Ikke lov asynkron oppfølging.

## Spesialiserte agentroller – hovedarkitekt samordner

Arbeid parallelt på lesende oppgaver og separate, små GitHub-PR-er; ingen rolle kan alene erklære produksjon GO.

- **Arkitekt/releaseansvarlig:** eier #39, release-SHA, grenstrategi, GO/NO-GO og koordinering av alle roller.
- **Database/legacy:** verifiserer prod-D1 UUID, 0040/0041/0044, Time Travel og bevaring av historiske saker; ingen nye migrasjoner uten påvist behov.
- **Sikkerhet/identitet:** verifiserer eksisterende Access-appens AUD, Google/MFA, INVITED→ACTIVE og at både apex og www er beskyttet for `/ops`, `/ops/*`, `/api/ops`, `/api/ops/*`. Bruk samme eksisterende Access-app der det er mulig, ikke løs ved Allow=Everyone.
- **DevOps/rollback:** avklarer `finnbilglass-ops-repair`-rutene, faktiske Worker-versjoner, bindinger og rollback; proddeploy kun via workflow_dispatch, eksakt SHA og GitHub production environment approval. `wrangler secret put` er IKKE en read-only operasjon.
- **QA:** tester prodflagg, innlogging/rolleavslag og tidligere saker uten kundemails, ny stagingordre eller betaling. CI-bevis og produksjonsbevis er separate.
- **Salgsflyt/e-post:** kontrollerer Resend-konfigurasjon og manuell OE/foto-kontroll, tilbud, skriftlig aksept og nøyaktig én ordre. Gmail-import, Kustom auto-capture/refund og automatisk PAID forblir av.

Nåværende dokumenterte prod-status er [Issue #39](https://github.com/tajlive/finnbilglass/issues/39): SQL 0040/0041/0044 anvendt i prod, gammeldata bevart, første ADMIN står INVITED. Gjenstående Access AUD/www, Worker-ruting og manuell deploy må bevises i Cloudflare; ikke gjenta ferdige oppgaver. Denne rollefordelingen oppretter ikke i seg selv nye kjørende agentprosesser.
