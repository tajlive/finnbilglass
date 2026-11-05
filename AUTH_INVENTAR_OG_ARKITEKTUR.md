# FINNBILGLASS — AUTENTISERINGSINVENTAR OG ANBEFALT ARKITEKTUR

**Dato:** 2026-11-01
**Status:** Utkast til beslutning (C5.2-arbeidspakke)
**Produksjon:** HOLD — ingen endringer før separat GO

---

## 1. EKSISTERENDE AUTENTISERING (INVENTAR)

### 1.1 Token-basert auth (backend)

| Endepunkt | Token | Miljøvariabel | Beskyttelse |
|-----------|-------|---------------|-------------|
| `/api/support/*` | `SUPPORT_EVIDENCE_TOKEN` | `wrangler secret put` | Bearer-token, fail-closed |
| `/api/admin/apify-catalog/sync` | `APIFY_SYNC_TOKEN` | `wrangler secret put` | Bearer-token, fail-closed |
| `/api/admin/apify-catalog/status` | `APIFY_SYNC_TOKEN` | `wrangler secret put` | Bearer-token, fail-closed |
| `/api/admin/pris-estimat` | (ingen egen token) | — | Ikke beskyttet ennå |

**Implementering:** `supportAuthorised()` (index.ts:168-171), `authorized()` (apify-catalog-sync.ts:27-32)

### 1.2 Session-håndtering (frontend + backend)

| Komponent | Implementering | Lagring |
|-----------|---------------|---------|
| `sessionId` | `public/app.js:25-26` — `localStorage['fb-session-id']` | LocalStorage (kunde) |
| `sessionId` | `src/index.ts:99-101` — fra request body, max 64 tegn | D1 (opplæringshendelser, innlogging, bildebevis) |
| Session-utløp | Ingen | — |
| Session-fornyelse | Ingen | — |

### 1.3 Kundeautentisering

**IKKE implementert.** Kunder kan:
- Søke på registreringsnummer uten innlogging
- Be om pristilbud som gjest (navn + telefon/e-post)
- Sende bilder som gjest

Ingen innlogging, ingen OTP, ingen brukerkontoer, ingen Min side.

### 1.4 Adminautentisering

**Token-basert, ikke rollebasert.** Admin-endepunktene beskyttes av `SUPPORT_EVIDENCE_TOKEN` / `APIFY_SYNC_TOKEN`. Ingen roller (ADMIN/REVIEWER/OPERATOR), ingen MFA, ingen invite-liste.

### 1.5 Cloudflare Access

**IKKE konfigurert** i wrangler.toml eller wrangler.staging.toml. Ingen hostnavn er beskyttet av Access. `admin.finnbilglass.no` eksisterer ikke ennå.

### 1.6 D1-tabeller knyttet til auth/sesjoner

| Tabell | Formål | Auth-relatert? |
|--------|--------|----------------|
| `login_tokens` | Magic Link-tokener | Ja (eksisterende, ubenyttet i Worker-kode) |
| `sessions` | Kundesesjoner | Ja (eksisterende, ubenyttet) |
| `admin_roles` | Admin-roller | Ja (eksisterende, ubenyttet) |
| `admin_audit_log` | Audit-logging | Ja (eksisterende, ubenyttet) |
| `auth_rate_limits` | Rate limiting | Ja (eksisterende, ubenyttet) |

Disse tabellene finnes i D1-skjemaet (migrasjoner 0012-0018 området) men er ikke integrert i Worker-koden ennå.

---

## 2. ANBEFALT AUTH-ARKITEKTUR

### 2.1 Kunde (B2C)

| Komponent | Valg | Begrundelse |
|-----------|------|-------------|
| Innlogging | Passordløs OTP på e-post | Eksisterende D1-tabeller (`login_tokens`), brev via Brevo (eksisterende SMTP-integrasjon) |
| Gjestesøk | Uendret | Kunde skal kunne søke uten innlogging (vedtatt krav) |
| Min side | E-postkode + sesjon | Kobler gjesteforespørsler til brukeridentitet |
| Sesjon | HttpOnly/Secure/SameSite=Lax cookie | Sikker sesjonshåndtering |
| Rate limiting | 5 forespørsler per IP per 10 min (eksisterende G12) | Allerede implementert i /api/inquiry |
| CSRF | SameSite=Lax + cookie | Tilstrekkelig for same-origin |

### 2.2 Admin (B2B/Internal)

| Komponent | Valg | Begrundelse |
|-----------|------|-------------|
| Ytre beskyttelse | Cloudflare Access på `admin.finnbilglass.no` | MFA/passkey via IdP, eksisterende mønster fra Operations Center |
| Interne API-er | Bearer-token + rollekontroll | `SUPPORT_EVIDENCE_TOKEN` for overgang, rollebasert auth på sikt |
| Roller | ADMIN / REVIEWER / OPERATOR | Vedtatt i CTO-plan V3.2 |
| Audit-logging | `admin_audit_log` (eksisterende D1-tabell) | Alle godkjenninger logges |

### 2.3 Sikkerhetsregler (uveikelige)

- OTP med kort utløp (10 min), begrensede forsøk (3), engangsbruk
- Ingen kunde kan lese andres forespørsler ved å endre ID — eierskap kontrolleres på serveren
- Ingen automatisk kobling til forespørsel basert på registreringsnummer alene
- Generiske feilmeldinger som hindrer kontoopptelling
- Ingen produksjons-e-postutsending uten godkjent leverandør

---

## 3. PEN.DEV INTEGRASJONSSTATUS

### 3.1 Funnet i kodebasen

| Fil | Formål |
|-----|--------|
| `src/ops-center-ui.ts` | Internal Operations Center — HTML-siden, read/support surface |
| `src/approval/decisions.ts` | Godkjenningsbeslutninger |
| `src/approval/policy.ts` | Policy-modul (ren, ingen DB/IO) |
| `src/approval/overrides.ts` | Operatør-overstyringer |

### 3.2 pen.dev-status

**Ikke verifisert.** Ingen referanse til pen.dev i wrangler.toml, package.json eller kildekode. `pendev-guard.mjs` er nevnt i session summary som et verktøy for å beskytte mot datatap ved bruk av pen.dev som designverktøy, men ikke funnet i repositoriet.

**Anbefalt første handling:** Verifiser om pen.dev er installert på systemet, og om det eksisterer en `.pen`-designfil for FinnBilGlass Operations Center.

---

## 4. ROLLER OG TILGANG

| Rolle | Kan | Kan ikke |
|-------|-----|----------|
| **Kunde (gjest)** | Søke på regnr, be om pristilbud, sende bilder | Se andres saker, administrere roller |
| **Kunde (innlogget)** | Samle som gjest + se egne saker på Min side | Administrere systemet |
| **OPERATOR** | Behandle tilbudsforespørsler, følge opp kunder | Godkjenne glassidentifikasjon |
| **REVIEWER** | Behandle glasskonflikter, godkjenne/avvise kandidater | Omgå evidensregler (kan ikke gjøre uverifisert til sikker) |
| **ADMIN** | Administrere brukere/roller, se systemstatus | — |

**Vedtatt AND-port for direkte kjøp:**
```
glassVerified && positionVerified && priceVerified && availabilityVerified && orderFlowApproved
```
Hvert vilkår må verifiseres på serveren. UI-status EXACT er aldri nok alene.

---

## 5. NESTE STEG (etter CTO-plan V3.2)

| Prioritet | Oppgave | Status |
|-----------|---------|--------|
| P0 | Bekreft alle 4 pristilbudsreiser fungerer (inkl. null kandidater) | ✅ Ferdig (tester på plass) |
| P0 | Kartlegg eksisterende auth | ✅ Ferdig (dette dokumentet) |
| P1 | Anbefalt auth-arkitektur | ✅ Ferdig (se seksjon 2) |
| P1 | Design kundeinnlogging + Min side | Neste |
| P1 | Design Admin-innlogging + Operations Center | Neste |
| P1 | pen.dev-designfil | Neste |
| P1 | Verifiser SKU-manifest (duplikater, konflikter) | Neste |
| P1 | R2-evidensarkiv-design | Dokumentert (FASE5_SAMLET_RAPPORT.md) |

---

## 6. HOLD-REGLER (UFAVVIKLIGE)

- Ingen produksjonsaktivering av kundeinnlogging
- Ingen produksjonsaktivering av admininnlogging
- Ingen produksjonsaktivering av forespørsler (`inquiries_enabled=0`)
- Ingen D1-migrasjoner uten separat GO
- Ingen Cloudflare-produksjonsdeploy
- Ingen PR-merge uten Tom-godkjenning

---

## 7. FILER OG REFERANSER

| Fil | Beskrivelse |
|-----|-------------|
| `src/index.ts` | Worker med `supportAuthorised()`, `sessionId()`, `/api/inquiry`, `/api/admin/*` |
| `src/routes/apify-catalog-sync.ts` | `authorized()` med `APIFY_SYNC_TOKEN` |
| `src/ops-center-ui.ts` | Internal Operations Center UI |
| `src/approval/decisions.ts` | Godkjenningsbeslutninger |
| `src/approval/policy.ts` | Policy-modul |
| `wrangler.toml` | Produksjonskonfig (ingen Access) |
| `wrangler.staging.toml` | Stagingkonfig (ingen Access) |
| `public/app.js` | Frontend med `SESSION_KEY = 'fb-session-id'` |
