#!/bin/bash
# Deploy staging + seed ece_r43-testdata + test verify-glass (manuell + bilde).
set -euo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")

echo "=== 1) Deploy staging:"
npx wrangler deploy --config wrangler.staging.toml 2>&1 | tail -6

echo "=== 2) Seed ece_r43-testrad (staging):"
npx wrangler d1 execute finnbilglass-db-staging --remote --command "INSERT OR IGNORE INTO ece_r43 (r43_nummer, landkode, eurokode, varenr, merke, modell, kilde, bekreftet) VALUES ('004592', 'E1', '8579AGSGYAVZ1B', '8579AGSGYAVZ1B', 'VW', 'TRANSPORTER T5 2003-', 'manual', 1)" 2>&1 | tail -2

echo "=== 3) Verifiser seed:"
npx wrangler d1 execute finnbilglass-db-staging --remote --command "SELECT r43_nummer, eurokode, varenr, bekreftet FROM ece_r43" --json 2>&1 | tail -3
echo "FERDIG"
