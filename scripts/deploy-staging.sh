#!/bin/bash
# Deploy finnbilglass-frontrute-staging (wrangler.staging.toml)
set -euo pipefail
cd /Users/taj/finnbilglass
TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
ACCT=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
SVV=$(grep '^SVV_API_KEY=' /Users/taj/bilglass/.env.local | head -1 | cut -d= -f2- | tr -d "'\"")
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
printf '%s' "$SVV" | npx wrangler secret put SVV_API_KEY --config wrangler.staging.toml
npx wrangler deploy --config wrangler.staging.toml
