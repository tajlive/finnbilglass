#!/bin/bash
# Deploy prod-worker med verify-glass + seed ece_r43 i prod + e2e-verifisering.
set -uo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")

echo "=== 1) Deploy prod:"
npx wrangler deploy 2>&1 | tail -4

echo ""
echo "=== 2) Seed ece_r43 i prod (testrad VW T5):"
npx wrangler d1 execute finnbilglass-db --remote --command "INSERT OR IGNORE INTO ece_r43 (r43_nummer, landkode, eurokode, varenr, merke, modell, kilde, bekreftet) VALUES ('004592', 'E1', '8579AGSGYAVZ1B', '8579AGSGYAVZ1B', 'VW', 'TRANSPORTER T5 2003-', 'manual', 1)" 2>&1 | tail -3

echo ""
echo "=== 3) Verifiser seed i prod:"
npx wrangler d1 execute finnbilglass-db --remote --command "SELECT r43_nummer, eurokode, varenr, bekreftet FROM ece_r43" 2>&1 | tail -4
echo "FERDIG"
