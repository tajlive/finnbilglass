#!/bin/bash
# Deploy finnbilglass-frontrute Worker
# SVV_API_KEY hentes fra bilglass-repoet (.env.local) og settes som Worker-secret.
set -euo pipefail
cd /Users/taj/finnbilglass
TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
ACCT=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
SVV=$(grep '^SVV_API_KEY=' /Users/taj/bilglass/.env.local | head -1 | cut -d= -f2- | tr -d "'\"" )
if [ -z "$TOKEN" ] || [ -z "$ACCT" ]; then echo "FEIL: mangler creds"; exit 1; fi
if [ -z "$SVV" ]; then echo "FEIL: mangler SVV_API_KEY i bilglass/.env.local"; exit 1; fi
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
printf '%s' "$SVV" | npx wrangler secret put SVV_API_KEY --name finnbilglass-frontrute
npx wrangler deploy
