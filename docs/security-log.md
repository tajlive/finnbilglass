# Sikkerhetslogg — FinnBilGlass

Kort, faktabasert logg over sikkerhetshendelser. Én oppføring per hendelse:
hva, når, påvirkning, bevis, tiltak. Ingen gjetting — usikkerhet skrives som usikkerhet.

---

## 2026-10-31 → 2026-11-01 — OTP testmodus kunne brukes i produksjon (auth-bypass)

**Hva:** `POST /api/auth/otp/send` returnerte engangskoden i responsen når forespørselen
hadde headeren `x-local-test: true`. Sjekken var
`env.ENVIRONMENT !== 'production' || request.headers.get('x-local-test') === 'true'`,
så headeren omgikk produksjonssperren. Hvem som helst kunne be om en kode for en
vilkårlig e-postadresse og få den utlevert.

**Eksponert vindu:** fra produksjonsdeploy `45128052` (2026-10-31 12:38) til fiksen
ble deployet (2026-11-01 18:25).

**Påvirkning:** Innlogging kunne i prinsippet gjennomføres for enhver identitet som
fantes i auth-lagringen. I produksjon var auth-lagringen bundet til
`finnbilglass-local-auth` — en testdatabase.

**Bevis på misbruk:** ikke funnet.
- Produksjons-D1 (`finnbilglass-db`) har ingen auth-tabeller (`auth_users`,
  `auth_sessions`, `auth_otp_codes`) — aldri migrert dit.
- `finnbilglass-local-auth` (remote) inneholder kun `_cf_KV` — ingen tabeller.
- Ingen sesjoner å tilbakekalle. Staging inneholder kun testbrukere opprettet av
  Hermes (`*@test.no`).

**Usikkerhet:** Cloudflare-observability har `logs.enabled = false` for Workeren, så
forespørselslogger med headere er ikke lagret. Header-nivå etterforskning er derfor
umulig; konklusjonen bygger på at det ikke finnes noe persistenslag der en sesjon
kunne ha blitt opprettet.

**Tiltak:**
- Testmodus styres nå utelukkende av `ENVIRONMENT !== 'production'`; header-veien er fjernet.
- Produksjon kobler ingen `AuthStorage` (test-DB-ene er også fjernet som bindinger).
- Auth-, kunde- og admin-ruter svarer 401/503 uten lagring i stedet for 500.
- Rotasjon av `SUPPORT_EVIDENCE_TOKEN` (prod + staging, lagret i BWS).
- Verifisert etter fiks: `x-local-test` mot produksjon gir
  `503 {"error":"INNLOGGING_IKKE_AKTIVERT"}` — ingen kode.

---

## 2026-11-01 20:29–20:33 — Produksjonsdomenene ble servert av staging-Workeren

**Hva:** `[env.staging]` i `wrangler.toml` arvet de globale `[[routes]]`-oppføringene.
Hver `wrangler deploy --env staging` knyttet derfor `finnbilglass.no`,
`www.finnbilglass.no` og `api.finnbilglass.no` til `finnbilglass-frontrute-staging`.

**Eksponert vindu:** ca. 4 minutter (staging-deploy 20:29 → domenene flyttet tilbake 20:33).

**Påvirkning:** I vinduet kjørte produksjonsdomenet staging-konfigurasjon:
`ENVIRONMENT=staging`, `inquiries_enabled=true` og staging-katalogen som `FINNBILGLASS_DB`.
Offentlige søk ville blitt logget i staging i stedet for produksjon.

**Bevis på kundetrafikk i vinduet:** ingen. `beta_inquiries` i staging hadde 0 rader
mellom 20:29 og 20:40; alle 19 radene i tabellen er Hermes' syntetiske tester (`@test.no`).

**Tiltak:**
- `routes = []` under `[env.staging]` — staging kan ikke lenger eie produksjonsdomener.
- Domenene er knyttet til Workeren via Workers Domains-API-et, ikke `[[routes]]`.
- `[[routes]]` er fjernet fra `wrangler.toml`, slik at deploy ikke forsøker å
  synkronisere domener (CI-tokenet mangler `workers/routes`-skriving).
- Verifisert: staging-deploy etter fiksen flytter ikke domenene.

---

## Rutine ved nye hendelser

1. Skriv hendelsen her samme dag — fakta, ikke vurdering.
2. Skill mellom «ingen bevis funnet» og «bevist ikke inntruffet».
3. Noter eksponert vindu med tidsstempler og hvilken deploy/commit som lukket det.
