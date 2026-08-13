#!/bin/bash
# Deploy finnbilglass-frontrute Worker (account 80d5b1d5 = Tom sin CF)
set -euo pipefail
cd /Users/taj/finnbilglass
TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
ACCT=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
if [ -z "$TOKEN" ] || [ -z "$ACCT" ]; then echo "FEIL: mangler creds"; exit 1; fi
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
npx wrangler deploy
