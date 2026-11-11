# FinnBilGlass coding context

FinnBilGlass er en norsk bilglassbutikk med TypeScript, Cloudflare Workers, D1 og manuelt håndterte tilbud og ordre.
Les `AGENTS.md` og `docs/OPS_RELEASE_PLAN_FinnBilGlass_2026-11-11.md` før større endringer.

- Foretrekk små PR-er. Bruk eksisterende issue #39 (release), #52 (manuelt salg), #38 (mail), #37 (staff) og #36 (auth).
- `main` er ikke synonymt med den aktive OPS staging-kandidaten, som per 11.11.2026 er draft PR #57. Kontroller alltid fersk status.
- Bevar gamle saker, data, priser, ordre og hendelser; legg til nye felter på en bakoverkompatibel måte.
- Tilbud kan ha varenummer og/eller varenavn, frivillig beskrivelse, og pris i NOK. Ikke vis `UTEN-VARENUMMER` som et virkelig varenummer.
- Glassmatch må bygge på etterprøvbar evidens; katalogmatch er ikke automatisk EXACT.
- Betaling og Gmail: ingen automatisk capture/refund, blind synk, reelle e-poster eller produksjonsdeploy som del av kodeforslag.
- Normal test: `npm ci && npm run qa`; for OPS staging også `python3 scripts/maintenance/staging-migration-rehearsal.py`.
- Bruk bare syntetiske fixture-data. Ikke logg eller legg inn tokens, nøkler, kundedata eller Cloudflare-secrets.
- Dokumenter eksakt SHA, QA og eventuelle release-blokker. Svar på norsk med konkrete, korte resultater.
