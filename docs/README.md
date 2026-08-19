# Finnbilglass

**Salg av bilglass til folk som ikke har forsikring.**

## Konsept

- **B2C** — selger bilglass direkte til privatpersoner.
- **Målgruppe:** bileiere uten forsikringsdekning for glasskade (steinsprut/sprukket rute) — de som i dag må betale full pris av egen lomme.
- **Kjerne:** kunden finner riktig glass via regnr/VIN, ser pris, og bestiller — uten å gå via forsikringsselskap.

## Grunndata

| Felt | Verdi |
|---|---|
| Domene | `finnbilglass.no` (registrert hos Domeneshop) |
| GitHub | `tajlive/finnbilglass` |
| Målgruppe | Privatpersoner (B2C) |
| Registrert | 2026-08-13 (Arch Project Factory v2.1) |

## Status

Aktiv styrende plan: [prosjektplan-2026-08-18.md](prosjektplan-2026-08-18.md).

Per 2026-08-18 er bildeopplasting, kunde-chat og speech satt pa vent. Produksjonsklar v1 prioriterer en enkel kundeflyt rundt kjennemerke, SVV-oppslag, resolverstatus og tydelig supportkontakt ved usikkerhet.

## Teknologistack

Cloudflare Worker + D1 + R2 + statiske assets i `public/`. Produksjonsendringer skal ga gjennom ren commit, test og direkte live-verifisering.
