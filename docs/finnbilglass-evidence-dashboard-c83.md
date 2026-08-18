# FINNBILGLASS EVIDENCE DASHBOARD (C8.3)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Kontrollpanel for læringsmotoren — deterministisk, forklarbart, ingen prod-endring.

## 1. HVA DASHBOARDET SVARER PÅ (fire styringsspørsmål)

| # | Spørsmål | Kilde |
|---|---|---|
| 1 | **Hvilke biler mangler evidens?** | C8.2-analytics × confidence (LAV/MIDDELS/HØY) |
| 2 | **Hvilke features skaper mest spørsmål?** | D1 `evidence_events`-fordeling (live) |
| 3 | **Hvilke glass har mest usikkerhet?** | skillende features × confidence |
| 4 | **Hvilke installasjoner gir mest verdi?** | `installation_fixtures` × markedsvolum (C7.6) |

## 2. KOMPONENTER

| Modul | Funksjon |
|---|---|
| `src/learning-v1/dashboard.ts` | Rent domene (ingen I/O): `manglendeEvidens()`, `featuresMedFlestSpoersmaal()`, `glassMedMestUsikkerhet()`, `installasjonerMedMestVerdi()` |
| `scripts/c83-evidence-dashboard.mjs` | Leser C8.2/C9.5/C7.6-utdata + **live D1 (staging)** via wrangler → genererer selvstendig HTML (inline CSS, norsk) |

## 3. EKTE DATA — D1-EVIDENS LIVE (verifisert)

Dashboardet leser **ekte staging-evidens**:
- `evidence_events`: **3 rader** — OE CAPTURED ×2 + OE CONFIRMED (fra C8.1-E2E: SU18018 → 7H0845101H, sha256-hash `acf436c279ef`)
- `installation_fixtures`: 0 (første montørbekreftelse bygger verdien)

Dette beviser den selvforbedrende loopen: samtale → evidens → D1 → **dashboard**.

## 4. PITFALLS FIKSET (verifisert under bygg)

- **snake_case vs camelCase**: D1-kolonner er `evidence_type`/`vehicle_identity_hash`/`installer_id` — scriptet mappet feil først (SQLITE_ERROR 7500) → fikset.
- **wrangler --json er flerlinjet**: `.split('\n')[0]` ga «Unexpected end of JSON input» → parse hele stdout.
- **CF-token**: `CLOUDFLARE_API_TOKEN` må eksporteres (fra klarpakke/.env.local, cfat_…, konto 80d5b1d5).

## 5. TESTER

**5/5 C8.3** (prioritering, feature-telling, usikkerhets-sortering, installasjonsverdi, script-integritet) + 4/4 C9.5 + 7/7 C8.2 + 10/10 C8.1 + 4/4 C9.2 + 7/7 C9 + 25/25 challenge + suite + TSC 0.

## 6. GRATIS-MODELL-STATUS (fra krisehåndteringen)

- **Default**: `gemini-3.6-flash` (gratis, GOOGLE_API_KEY, bevist live) — config satt
- **Backup lokal**: `ollama-legion` (qwen3:30b-a3b på Legion, tailscale) — lagt til som custom provider
- Døde kilder dokumentert: DeepSeek direkte (tom), Nous paid (tom), Kimi K3 OAuth (K3 nektet)

## 7. NESTE

- C10 Glass Knowledge Graph (dashboardet blir kontrollpanelet for grafen)
- G20-kandidatgenerering (BMW 3 2019+)
- Ordre-strøm → automatisk fixture-registrering

**Ingen produksjonsendring. Staging-only. STOPP.**
