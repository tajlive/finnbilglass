#!/bin/bash
# Setter SVV_API_KEY som wrangler-secret på finnbilglass-frontrute.
set -euo pipefail
cd /Users/taj/finnbilglass
TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
SVV=$(grep '^SVV_API_KEY=' /Users/taj/bilglass/.env.local | cut -d= -f2- | tr -d "'\"" )
if [ -z "$TOKEN" ] || [ -z "$SVV" ]; then echo "FEIL: mangler token eller SVV-nøkkel"; exit 1; fi
export CLOUDFLARE_API_TOKEN="$TOKEN"
printf '%s' "$SVV" | npx wrangler secret put SVV_API_KEY --name finnbilglass-frontrute
