# FinnBilGlass – gratis GitHub-oppsett for raskere utvikling

Oppdatert 11.11.2026. Dette er en praktisk veiledning, ikke en erklæring om at alle kontobaserte brytere er aktivert.

## Allerede på plass i dette repoet
- **PR Verification**: `.github/workflows/pr-verify.yml`, med `npm ci`, npm-cache, TypeScript, `npm test`, Gitleaks og staging-migrasjonsrepetisjon.
- **Deploy-gater**: `.github/workflows/deploy.yml`, tester og sikkerhet før eventuelt produksjonsdeploy.
- **Nattlige kontroller**: `.github/workflows/nightly-quality.yml`, uten tilgang til prod-secrets; også separat kvalitetssjekk av draft PR #57.
- `has_projects=true` og Issues aktivert i GitHub-repoets metadata. Dette **bekrefter ikke** at et GitHub Projects V2-brett allerede finnes.

**Behold eksisterende CI/caching:** Ikke opprett en parallell testworkflow; det gir mer støy og ventetid.

## Konfigureres automatisk ved merge av denne PR-en
1. `.github/dependabot.yml`: ukentlig npm-PR, månedlig GitHub Actions-PR, samler patch/minor-oppdateringer, maks 2+1 åpne versjons-PR-er. **Ingen automerge.** Alle må bestå normal QA.
2. `AGENTS.md`: varige, repo-lokale regler for Codex/kodeagenter, bakoverkompatibilitet og produksjonsgrenser.
3. `.github/copilot-instructions.md`: kontekst for støttede Copilot-klienter; hvilken Copilot-funksjon som leser filen avhenger av abonnement og klient.
4. `.github/pull_request_template.md`: kort, gjenbrukbar QA- og release-sjekkliste.

## Gratis innstillinger som må bekreftes i GitHub UI

Åpne [repository settings](https://github.com/tajlive/finnbilglass/settings):

- **Settings → Security / Advanced Security:** Kontroller at Dependabot alerts og Dependabot security updates er slått på. Dette er andre brytere enn `dependabot.yml`.
- **Settings → Advanced Security → Code scanning:** Aktiver **CodeQL Default setup** for TypeScript/JavaScript hvis det ikke allerede er aktivert. Gratis for offentlige repoer. Ikke legg til en duplisert CodeQL-workflow.
- **Settings → Advanced Security:** Kontroller secret scanning og push protection. Offentlig repo har gratis secret scanning. Bruk ikke betalte private-repo-tillegg uten beslutning.
- **Settings → General → Pull Requests:** Vurder *Automatically delete head branches* etter merge, slik at gamle brancher ikke hoper seg opp. Behold `main`, release- og staging-brancher med nødvendige regler.
- **Settings → Rules → Rulesets / Branches:** Verifiser at `main` krever PR og bestått PR Verification, uten å låse ute nødvendig release-arbeid. Regelendring må vurderes med eksisterende deploy-workflow.
- **Projects:** Gjenbruk ett eksisterende board hvis det finnes. Status: Backlog → Klar → Pågår → Testing → Ferdig. Knytt Issue #39, #52, #38, #37, #36 og PR #57. Ikke lag duplisert board.

## Gratis AI, men ingen gratis garanti for API-kall
- **GitHub Copilot Free:** opptil 2 000 kodefullføringer/måned og begrenset chat-/agentbruk. Gratisnivået gir ikke nødvendigvis Copilot cloud agent eller avansert automatisert kodegjennomgang.
- **GitHub Models:** fullt avviklet 30.07.2026. Ikke bygg GitHub Actions som kaller det.
- **OpenAI eller andre modell-API-er:** krever egen konto, modellvalg og eventuelle bruksutgifter. Aldri legg nøkler i kode eller `AGENTS.md`; bruk GitHub Actions Secrets om eksplisitt godkjent. Standard er **ingen AI-kall fra CI**, ingen hemmeligheter i PR-kjøringer og ingen automatiske betalte operasjoner.

## Prioritet før lansering
- P0: gammelt dataarkiv og første-salg-E2E (Issues #39 og #52, draft PR #57).
- P1: katalogsøking, flerlinjetilbud, handlingsorientert arbeidskø.
- Ingen av forslagene over endrer produksjons-Worker, migrerer D1, importerer e-post eller starter betaling.

Offisiell dokumentasjon:
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates
- https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches
- https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/
