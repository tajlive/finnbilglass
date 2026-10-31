# G7 — Rollback-drill (KLA-301)

> Status 2026-10-31: **Faktisk drill utført i staging** (se under). Rollback er verifisert ende-til-ende, ikke bare antatt fra deployment-historikken.

## Faktisk drill utført (staging, 2026-10-31)

```
deploy 791408f        → 1afe22a8  (ny integrasjonskandidat)
wrangler rollback     → 8528d2bc  (forrige versjon, 100 %)
  verifisert: /health 200 · /api/regnr → PINPOINT (ruten serverer)
re-deploy 791408f     → d30b4ffc  (ny kandidat tilbake)
  verifisert: /health 200 · /api/regnr → PINPOINT
```

Bevis: rollback er reelt testet — forrige versjon ble aktivert til 100 % og
verifisert fungerende FØR ny deploy. Deployment-historikk alene er ikke nok.

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
