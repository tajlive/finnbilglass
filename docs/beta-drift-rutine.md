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

## Nødstopp (kill switch) — ved mistanke om feil i resolver eller kundeflyt

Flags i D1-tabellen `feature_flags`. Alle er fail-closed for resolveren (manglende rad = AV):

| Flagg | Av (=0) betyr |
|---|---|
| `resolver_all` | All resolver-stopp — PINPOINT/VERIFY degraderes til FALLBACK på **alle** ruter (`/api/regnr`, `/api/vin`, `/api/frontrute`, skiltlesing) |
| `resolver_pinpoint` | PINPOINT degraderes til VERIFY (kandidatene beholdes, intet auto-godkjent svar) |
| `inquiries_enabled` | Stanser nye kundehenvendelser (POST `/api/inquiry` → 503) — uavhengig av resolveren |

**Propageringstid: ~10 sekunder (målt 10,3 s).** Nødstoppet er IKKE øyeblikkelig —
flaggene caches per Worker-isolat i 10 s (`FLAG_CACHE_TTL_MS`). Etter at du har
flippet et flagg, vent **minst 10 s** før du erklærer stoppet aktivt, og verifiser
med et faktisk oppslag (`curl /api/regnr` skal vise FALLBACK, ikke PINPOINT).

Flagg-flipp gjøres med `wrangler d1 execute finnbilglass-db --remote --command
"UPDATE feature_flags SET enabled = 0 WHERE flag = 'resolver_all'"` (bytt flagg).

## Grenser (fase 3)

- **Ingen statusendringer i systemet** (`CONFIRMED`/`REJECTED`/`NEEDS_CUSTOMER_INFO` er lukket — 403 feature_disabled). Utfallet registreres kun internt inntil review åpnes.
- **Ingen customer-/order-dataendringer** — kun lesing.
- Feature-flags uendret: `UPLOAD=true`, `REVIEW=false`, `STATUS_CHANGE=false`.

## Måling (for GO/NO-GO etter 10 saker)

- Antall saker + utfall (PINPOINT/VERIFY/FALLBACK).
- Feilrate: upload mislykket (quality REJECT) og ops-visning manglende.
- Gjennomsnittlig svartid (opprettet → intern registrering).
- Årsaker til at saker forblir ubehandlet.
