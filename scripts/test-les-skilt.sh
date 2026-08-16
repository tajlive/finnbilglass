#!/bin/bash
# E2E /api/les-skilt med EKTE skiltbilde (Wikimedia Commons: AV 43634).
set -uo pipefail
cd /Users/taj/finnbilglass
BASE="https://finnbilglass.no"
BILDE="${1:-tests/skilt-ekte.jpg}"

python3 -c "
import base64, json, sys
b64 = base64.b64encode(open(sys.argv[1],'rb').read()).decode()
open('/tmp/skilt-body.json','w').write(json.dumps({'image': 'data:image/jpeg;base64,' + b64}))
print('størrelse base64:', len(b64)//1024, 'KB')
" "$BILDE"

echo "=== /api/les-skilt ($BILDE):"
curl -s -X POST "$BASE/api/les-skilt" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  --data @/tmp/skilt-body.json -m 120 > /tmp/skilt-svar.json
python3 -c "
import json
try:
    d = json.load(open('/tmp/skilt-svar.json'))
except Exception as e:
    print('IKKE JSON:', open('/tmp/skilt-svar.json').read()[:300]); raise SystemExit
bil = d.get('bil') or {}
print(json.dumps({
  'ok': d.get('ok'),
  'regnr': d.get('regnr'),
  'lest': d.get('lest'),
  'funnet': d.get('funnet'),
  'bil': {k: bil.get(k) for k in ('merke','modell','aar','vin')},
  'resolverUtfall': (d.get('resolver') or {}).get('utfall'),
  'feil': d.get('error'),
}, ensure_ascii=False, indent=1))"
