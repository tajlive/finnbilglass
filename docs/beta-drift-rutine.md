# Beta-driftrutine — begrenset ekte kunde-beta (ingen statusendringer)

Gjelder til `EVIDENCE_REVIEW_ENABLED` åpnes (etter minst 10 gjennomgåtte saker).

## Daglig operatørrutine (minst én gang per arbeidsdag)

1. **Kjør rapporten:** `node scripts/beta-drift-rapport.mjs` (eller motta daglig cron-rapport).
2. **Kontrollér verifikasjonene** øverst i rapporten:
   - `/ops` krever token (401 uten) — hvis ikke: **eskaler straks** (token-gate brutt).
   - Nyeste saker har thumbnail i R2 — hvis ikke: **eskaler** (bilde mangler).
   - `decisionAuthority` forblir NONE (kode-invariant).
3. **Åpne Operations Center** (`/ops`, med token) og gjennomgå nye saker:
   - Se bilde (thumbnail + fullsize) og kandidatdata.
   - Registrer utfallet **internt** (ikke i systemet): treff riktig / feil kandidat / manglende bilde / uklart.
4. **Eskaler straks** (til arkitekt/Tom) ved:
   - Manglende bilde eller thumbnail.
   - Manglende sak i ops (kunden sier «lastet opp», men ingen sak).
   - Feil kandidatdata (glasset matcher ikke bilen).
   - Feil tilgang (401 med korrekt token).
   - 5xx / 1101 i kundeflyt eller opplasting.

## Grenser (fase 3)

- **Ingen statusendringer i systemet** (`CONFIRMED`/`REJECTED`/`NEEDS_CUSTOMER_INFO` er lukket — 403 feature_disabled). Utfallet registreres kun internt inntil review åpnes.
- **Ingen customer-/order-dataendringer** — kun lesing.
- Feature-flags uendret: `UPLOAD=true`, `REVIEW=false`, `STATUS_CHANGE=false`.

## Måling (for GO/NO-GO etter 10 saker)

- Antall saker + utfall (PINPOINT/VERIFY/FALLBACK).
- Feilrate: upload mislykket (quality REJECT) og ops-visning manglende.
- Gjennomsnittlig svartid (opprettet → intern registrering).
- Årsaker til at saker forblir ubehandlet.
