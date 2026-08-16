# Catalog harvester

`scripts/catalog-harvester.mjs` creates a provenance-first JSONL layer between catalog sources and the FinnBilGlass resolver.

It supports:

- Buycarparts research pages: product links, article numbers, Eurocode candidates, OE candidates, fitment, features and image metadata.
- B2B SQL exports: existing `glass_catalog`-style rows into the same canonical record shape.
- resumable output directories, hard page/byte limits, low request rate, robots checks, same-origin crawling and error logs.
- optional media download only when the operator explicitly supplies `--media-licensed` and an allowlisted media host.

The harvester does not bypass Cloudflare, CAPTCHA, authentication, paywalls or robots restrictions. It does not write to D1 or R2. Review `records.jsonl` and its provenance first; a separate licensed importer should be responsible for production data.

## Research pilot

```sh
node scripts/catalog-harvester.mjs \
  --source buycarparts \
  --seed https://www.buycarparts.co.uk/windscreen \
  --out /tmp/fbg-buycarparts-pilot \
  --max-pages 25 \
  --delay-ms 3000
```

If `robots.txt` cannot be read, the default is to stop. An override is available only for a bounded, authorized research run:

```sh
node scripts/catalog-harvester.mjs \
  --source buycarparts \
  --seed https://www.buycarparts.co.uk/windscreen \
  --allow-robots-unavailable \
  --max-pages 5
```

This override does not bypass any other access control and should not be used for production harvesting.

## B2B normalization

```sh
node scripts/catalog-harvester.mjs \
  --source b2b-sql \
  --input /Users/taj/bilglass/api/cf-worker/generated-inserts.sql \
  --out /tmp/fbg-b2b-canonical
```

The canonical record is intentionally richer than the current `glass_catalog` table. It keeps source URL, timestamps, raw fingerprint, identifiers, features, media metadata and warnings so later crosswalk and evidence-fusion jobs can be audited.

## Media policy

Media URLs are metadata-only by default. To download images, the operator must have written permission and explicitly provide both a license flag and an allowlisted host:

```sh
node scripts/catalog-harvester.mjs \
  --source buycarparts \
  --seed https://www.buycarparts.co.uk/windscreen \
  --out /tmp/fbg-licensed-pilot \
  --max-pages 5 \
  --download-media \
  --media-licensed \
  --media-host cdn.pkwteile.de
```

The next production step is a reviewed adapter from this JSONL into `glass_master`, `glass_identifiers`, `glass_features`, `glass_media` and `glass_evidence`. Do not import raw external records directly into production resolver tables.
