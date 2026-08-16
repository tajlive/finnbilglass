#!/bin/bash
# Bilde-vei-test mot staging via curl (unngår Python-UA 1010-blokk).
set -uo pipefail
cd /Users/taj/finnbilglass
python3 -c "
import base64, json
b64 = base64.b64encode(open('tests/merke-004592.png','rb').read()).decode()
body = {'image': 'data:image/png;base64,' + b64, 'merke': 'VW', 'modell': 'TRANSPORTER T5', 'aar': 2005}
open('/tmp/verify-body.json','w').write(json.dumps(body))
print('body:', len(body['image']) // 1024, 'KB base64')
"
curl -s -X POST "https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev/api/verify-glass" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  --data @/tmp/verify-body.json \
  -m 90 > /tmp/verify-svar.json
python3 -c "
import json
d = json.load(open('/tmp/verify-svar.json'))
obs = d.get('observasjon', {})
print(json.dumps({
  'ok': d.get('ok'),
  'r43Nummer': d.get('r43Nummer'),
  'r43LestAvAI': obs.get('r43Numbers'),
  'eurocodes': obs.get('eurocodes'),
  'features': obs.get('features'),
  'warnings': obs.get('warnings'),
  'rawText': (obs.get('rawText') or '')[:400],
  'treff': d.get('treff'),
  'fusionOutcome': (d.get('fusion') or {}).get('outcome'),
  'melding': d.get('melding'),
}, ensure_ascii=False, indent=1))
" 2>&1 || head -c 500 /tmp/verify-svar.json
