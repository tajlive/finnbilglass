# FinnBilGlass – beslutninger fra OPS staging-arbeidet 10.–11.11.2026

Dette er fullstendig tidligere innhold i OPS-grenens `AGENTS.md`, bevart ved samordning med GitHubs globale `AGENTS.md` fra `main`. Les også `docs/ops/workspace-existing-decision.md` og `docs/OPS_RELEASE_PLAN_FinnBilGlass_2026-11-11.md`.

---

# FinnBilGlass – permanente agent- og prosjektbeslutninger

Dette er den autoritative arbeidsavtalen for ChatGPT, Codex, CI-agenter og andre utviklere i dette repoet. Les før endringer og oppdater den ved **vedtatte** driftsvalg. Ikke gjett på konto-, produksjons- eller tilgangsstatus; verifiser faktisk miljø.

## Google Workspace og e-post (vedtatt 10.11.2026)

- **Google Workspace for finnbilglass.no er allerede opprettet. Ikke opprett nytt Workspace, en konkurrerende e-postleverandør eller en ny Google OAuth-klient uten teknisk bevis for at eksisterende løsning ikke kan brukes.**
- Eksisterende Workspace-konto inkluderer `tomarne@finnbilglass.no`; den er **ikke** det samme som den private Gmail-kontoen `tomarnejensen@gmail.com`. Den private Gmail-tilkoblingen i ChatGPT er **ikke** bevis på at FinnBilGlass sin Workspace-postkasse er autorisert for OPS.
- **Resend** sender utgående tilbud, svar og invitasjoner (etter kontroll, gjennom idempotent outbox). **Google Workspace/Gmail API** speiler innkommende kundepost, svar og manuelt sendte Gmail-meldinger, skrivebeskyttet. **Brevo er ikke en del av valgt flyt.**
- Google OAuth client ID og client secret eksisterer allerede på staging-Worker. **Godkjent stagingløsning er ADMIN-styrt engangs-OAuth**, med `gmail.readonly`, offline access, CSRF-state/PKCE og et kryptert refresh token i isolert EU-staging-D1. `OPS_GMAIL_TOKEN_ENCRYPTION_KEY` er konfigurert kun som Worker secret, og OAuth-tabellene er installert; `OPS_WORKSPACE_OAUTH_ENABLED=true` i staging. `GMAIL_REFRESH_TOKEN` trenger **ikke** å opprettes manuelt i staging. `GMAIL_SYNC_ENABLED=false` helt til riktig Workspace-postkasse, alias og nødvendig samtykke er verifisert. Autorisasjonskode, refresh token, JWT og klienthemmeligheter må aldri inn i Git, D1 i klartekst, logger eller chat.
- **Google OAuth – blokkering løst 11.11.2026:** Den eksisterende klienten «FinnBilGlass Access» har nå riktig redirect, og `tomarne@finnbilglass.no` har gitt `gmail.readonly`-samtykke. **Ett aktivt kryptert Workspace-token og en `CONNECTED`-audit er faktisk kontrollert** i EU-staging-D1, ref. [Actions #42939141513](https://github.com/tajlive/finnbilglass/actions/runs/42939141513). Appen er fortsatt External/Testing: Google-dokumentasjon sier at refresh token for Gmail-scope normalt utløper etter 7 dager; dette er en **separat produksjonsblokkering**, ikke en grunn til å opprette ny Workspace/klient.
- **Gmail API 403 – løst 11.11.2026:** Eier aktiverte Gmail API i prosjekt `gen-lang-client-0228405648`; etter ny engangsgodkjenning viste OPS **Tilkoblet Workspace** og verifisert D1-grant. **Admin-only preflight** er deployet til staging: knappen «Test Gmail-tilgang (uten import)», `POST /api/ops/manual/workspace/oauth/preflight`, validerer nytt access token og eksakt Gmail-postkasse, ingen meldinger eller skrivetransaksjoner; [deploy #42939623482](https://github.com/tajlive/finnbilglass/actions/runs/42939623482) bestått. `GMAIL_SYNC_ENABLED=false`, og mottakeralias/leveringsruting er **ikke verifisert**. OPS har `tomarnejensen@gmail.com` ADMIN ACTIVE, og separat `tomarne@finnbilglass.no` ADMIN INVITED; sistnevnte invitasjon er ikke en Gmail OAuth-forutsetning.
- Avstem at innlogget Workspace-mailboks er en godkjent bedriftsadresse før første import; personlig Gmail, annen bedriftspost og private e-poster må ikke importeres. Synk må være duplikatsikker, med vedleggskontroll, sikker sakskobling og «Må fordeles» når bevis ikke er entydig. Ikke bruk AI eller bare emnefeltet som fasit.
- **Gmail-import før GO:** Den første manuelle `SENT`-speilingen skal tillate bare den eksplisitt autoriserte Workspace-postkassen som avsender i tillegg til bekreftede bedriftens alias, uten å åpne mottak til denne adressen automatisk. Gmail base64url MIME-tekst dekodes som UTF-8 for æ/ø/å. Begge deler er implementert med regresjonstester i PR #57, men **import er fortsatt deaktivert** til kontrollert staging-E2E.
- E-post- og Google Workspace-innstillinger settes opp **én gang** og skal fungere uavhengig av ChatGPT/CLI-økter. Ingen ekstra lokale app-passord. Ikke be om gjentatt innlogging dersom signert Cloudflare Access eller eksisterende OAuth kan gjenbrukes.
- **Løst:** `redirect_uri_mismatch`, manglende testbruker og Gmail API 403 er historiske stagingfeil, ikke aktive stoppunkter. OAuth er koblet og bekreftet i EU-staging-D1. Neste blokkering er **trygg alias-konfigurasjon, reell profilpreflight, avgrenset e-post-E2E og varig Google OAuth-publisering**. Se runbook. Gmail-import er fortsatt AV.
- Detaljert kontrakt og status: `docs/ops/workspace-existing-decision.md`.

## Operasjon, kvalitet og produksjon

- Repo `tajlive/finnbilglass`; PR #57 er stagingkandidaten for første manuelle salg.
- Kunde velger mulige glass og sender forespørsel. **Ansatt verifiserer SKU/utstyr/fitment** før tilbud. Ordre er manuell og først tillatt etter dokumentert tilbudsaksept. Betalingslenke opprettes manuelt i Kustom Portal; ingen automatisk capture/refund, faktura eller fraktbestilling i denne fasen.
- Ikke vis «beta» eller «pilot» på offentlige kundesider. Ikke la AI-, 43R-, DOT- eller mangelfulle katalogdata autorisere eksakt glass.
- Staging: Worker `finnbilglass-frontrute-staging`, EU-D1 `finnbilglass-db-staging` UUID `78842e17-ab0b-47c1-acde-244044073466`. Isoler fra produksjon. Reserverte syntetiske testadresser `.invalid`/`.test`/`.example`/`.localhost` skal **aldri** sendes til Resend.
- Ansattinnlogging: Cloudflare Access + invitasjon i D1 + rolle- og append-only-aktivitetslogg. Ingen ekstra innloggingsskjema i hver agentøkt. Ingen omgåelse av Access JWT via tokens, SQL eller uautentiserte skrivetransaksjoner.
- Ingen produksjonsdeploy, ekte betaling, virkelig e-post eller kopiering av produksjonskunder for en QA-test uten nødvendig godkjenning og dokumentert ende-til-ende stagingtest. Bruk smalt autoriserte CLI-/GitHub Actions-arbeidsflyter, dokumenter SHA/QA, og fjern privilegerte engangsjobber.
- Sist bekreftet: syntetisk sak #1 har ett `DRAFT`-tilbud på 1,00 kr og én `OFFER_CREATED`-audit; ingen outbox, ordre eller betaling. Se `docs/ops/staging-release-runbook-2026-11-10.md`.
