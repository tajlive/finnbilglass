# Arvet kunnskap (fra Arch Knowledge Graph)

Prosjekt finnbilglass arver 4 lessons fra Arch sin kunnskapsbase.
Kilde: tajlive/KP .arch/knowledge/lessons/ · generert 2026-08-13.

---

# Lesson: Edge-runtime + Supabase = krasj

Ser du `runtime: "edge"` og `@supabase/supabase-js` i samme API-rute → det krasjer i
prod (500) fordi `process.version` mangler i V8 isolates.

Regel: supabase-js-ruter = `runtime: "nodejs"`. `Buffer` finnes heller ikke i edge.

Kilde: `failures/cf-edge-runtime-avvik.md`.

---

# Lesson: Kapital/P&L — kun aktive sesjoner

Alle summeringer av kapital, P&L, saldo og leaderboard MÅ filtrere
`status IN ('active','paused')`. Stoppede sesjoner er fryst historikk og genererer
fantom-data hvis de telles med.

`paper_accounts` er eneste fasit — aldri summer sesjoner inn i konto.

Kilde: `failures/paper-balance-inflasjon.md`.

---

# Lesson: Route handler → createServerClient(request, response)

I Next.js route handlers (ikke RSC): bruk `createServerClient(request, response)` fra
`src/lib/supabase/server.ts` (sync-varianten). `cookies()`-varianten uten args krasjer
i route-handler-context → 500 for innloggede.

Kilde: fiks av `/api/onboarding/events` 2026-08-10.

---

# Lesson: wrangler multi-env → --env ""

`wrangler.jsonc` med flere environments → alle `wrangler deploy`/`versions`-kommandoer
MÅ ha `--env ""` (tom streng) for å treffe default-prod. Uten det treffer du feil
environment eller feiler.

Kilde: KLA-278 wrangler `versions secret put` (versjon 4faac85d).
