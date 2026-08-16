#!/bin/bash
# E2E mot PROD: seed-status + manuell vei + bilde-vei på finnbilglass.no.
set -uo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
BASE="https://finnbilglass.no"

echo "=== 1) Seed-status prod ece_r43:"
npx wrangler d1 execute finnbilglass-db --remote --command "SELECT r43_nummer, eurokode, varenr, bekreftet FROM ece_r43" 2>&1 | grep -A4 '"results"' | head -8

echo ""
echo "=== 2) Manuell vei mot prod:"
curl -s -X POST "$BASE/api/verify-glass" \
  -H 'Content-Type: application/json' \
  -d '{"r43":"43R-004592","merke":"VW","modell":"TRANSPORTER T5","aar":2005}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'ok':d.get('ok'),'r43Nummer':d.get('r43Nummer'),'treff':[(t.get('varenr'),t.get('merke'),t.get('modell')) for t in (d.get('treff') or [])],'fusionOutcome':(d.get('fusion') or {}).get('outcome')}, ensure_ascii=False, indent=1))"

echo ""
echo "=== 3) Bilde-vei mot prod (merke-004592.png):"
python3 -c "
import base64, json
b64 = base64.b64encode(open('tests/merke-004592.png','rb').read()).decode()
body = {'image': 'data:image/png;base64,' + b64, 'merke': 'VW', 'modell': 'TRANSPORTER T5', 'aar': 2005}
open('/tmp/verify-body-prod.json','w').write(json.dumps(body))
"
curl -s -X POST "$BASE/api/verify-glass" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  --data @/tmp/verify-body-prod.json \
  -m 90 > /tmp/verify-svar-prod.json
python3 -c "
import json
d = json.load(open('/tmp/verify-svar-prod.json'))
obs = d.get('observasjon', {})
print(json.dumps({
  'ok': d.get('ok'),
  'r43Nummer': d.get('r43Nummer'),
  'r43LestAvAI': obs.get('r43Numbers'),
  'treff': [(t.get('varenr'), t.get('varenavn'), t.get('pris')) for t in (d.get('treff') or [])],
  'fusionOutcome': (d.get('fusion') or {}).get('outcome'),
  'melding': d.get('melding'),
}, ensure_ascii=False, indent=1))
" 2>&1 || head -c 400 /tmp/verify-svar-prod.json
echo "FERDIG"
