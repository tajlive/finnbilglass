# G7 — Rollback-drill (KLA-301)

> Status 2026-08-13: **Prosedyre verifisert; faktisk drill avventer neste deploy** (staging har kun 1 deployment — rollback krever 2+).

## Verifisert i dag

```
wrangler deployments list -c wrangler.staging.toml   # OK — viser version 6975203c (100 %, 15:56)
wrangler deployments list                             # OK — prod-visning e7d0b571 (14:17)
```

## Prosedyre (staging + prod)

1. `wrangler deployments list [-c wrangler.staging.toml]` → finn version-id.
2. `wrangler rollback <version-id> [-c wrangler.staging.toml]` → aktiver forrige versjon (100 %).
3. Verifiser: `curl -s https://<worker>.workers.dev/api/health` + fasit-test (`node scripts/test-fasit.mjs`).
4. Logg i Linear (KLA-301) med version-id-er: «rollback X → Y, fasit grønn».

## Drills-krav (når 2+ deployments finnes)

- Drill A (staging): deploy → verifiser → rollback → verifiser fasit. Mål: <5 min totalt.
- Drill B (prod): kun ved faktisk incident — samme prosedyre, dokumentert i incident-rapport.

## Automatisk beskyttelse

- Kill switch (G6) dekker DE fleste degraderinger uten rollback (feature_flags → PINPOINT→VERIFY/FALLBACK).
- Rollback er siste instans: brukes når Worker-kode er ødelagt, ikke når data/flag er feil.
