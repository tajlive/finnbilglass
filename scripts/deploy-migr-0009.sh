#!/bin/bash
# Deploy migrasjon 0009 (ece_r43) til prod + staging, og Workers AI Meta-agree.
set -euo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")

echo "=== Migrasjon 0009 → prod (finnbilglass-db):"
npx wrangler d1 execute finnbilglass-db --remote --file migrations/0009_ece_r43.sql 2>&1 | tail -4

echo "=== Migrasjon 0009 → staging (finnbilglass-db-staging):"
npx wrangler d1 execute finnbilglass-db-staging --remote --file migrations/0009_ece_r43.sql 2>&1 | tail -4

echo "=== Workers AI agree (Meta-lisens, llama-3.2-11b-vision-instruct):"
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"prompt":"agree"}' | head -c 400
echo
echo "FERDIG"
