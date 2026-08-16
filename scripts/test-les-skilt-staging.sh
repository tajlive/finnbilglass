#!/bin/bash
# Deploy staging med les-skilt + e2e-test av /api/les-skilt (skilt-su18018.png).
set -uo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
BASE="https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev"

echo "=== 1) Deploy staging:"
npx wrangler deploy --config wrangler.staging.toml 2>&1 | tail -3

echo ""
echo "=== 2) E2E /api/les-skilt (skilt-su18018.png → SU18018 → SVV):"
python3 -c "
import base64, json
b64 = base64.b64encode(open('tests/skilt-su18018.png','rb').read()).decode()
open('/tmp/skilt-body.json','w').write(json.dumps({'image': 'data:image/png;base64,' + b64}))
"
curl -s -X POST "$BASE/api/les-skilt" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  --data @/tmp/skilt-body.json -m 90 > /tmp/skilt-svar.json
python3 -c "
import json
d = json.load(open('/tmp/skilt-svar.json'))
bil = d.get('bil') or {}
print(json.dumps({
  'ok': d.get('ok'),
  'regnr': d.get('regnr'),
  'lest': d.get('lest'),
  'funnet': d.get('funnet'),
  'bil': {k: bil.get(k) for k in ('merke','modell','aar','vin')},
  'resolverUtfall': (d.get('resolver') or {}).get('utfall'),
  'feil': d.get('error'),
}, ensure_ascii=False, indent=1))" 2>&1 || head -c 400 /tmp/skilt-svar.json
echo "FERDIG"
