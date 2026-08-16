#!/bin/bash
# Kjør Gate A (500-test) mot staging med fersk env fra .env.local
set -euo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
node --import tsx scripts/test-500-gt.mjs
