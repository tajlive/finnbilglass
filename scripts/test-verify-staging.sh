#!/bin/bash
# Verifiser verify-glass på staging: seed-status + manuell vei + bilde-vei.
set -uo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_ACCOUNT_ID=//' | tr -d "'\"")
BASE="https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev"

echo "=== 1) Seed-status i staging ece_r43:"
npx wrangler d1 execute finnbilglass-db-staging --remote --command "SELECT r43_nummer, eurokode, varenr, bekreftet FROM ece_r43" 2>&1 | tail -6

echo ""
echo "=== 2) Manuell vei: r43=43R-004592 (uten bilde):"
curl -s -X POST "$BASE/api/verify-glass" \
  -H 'Content-Type: application/json' \
  -d '{"r43":"43R-004592","merke":"VW","modell":"TRANSPORTER T5","aar":2005}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'ok':d.get('ok'),'r43Nummer':d.get('r43Nummer'),'treff':d.get('treff'),'fusionOutcome':(d.get('fusion') or {}).get('outcome'),'melding':d.get('melding')}, ensure_ascii=False, indent=1))"

echo ""
echo "=== 3) Bilde-vei: merke-test.png (43R-004592):"
B64=$(python3 -c "import base64; print(base64.b64encode(open('tests/merke-004592.png','rb').read()).decode())")
python3 - "$B64" <<'PY'
import base64, json, sys, urllib.request
b64 = sys.argv[1]
data_url = "data:image/png;base64," + b64
body = json.dumps({"image": data_url, "merke": "VW", "modell": "TRANSPORTER T5", "aar": 2005}).encode()
req = urllib.request.Request("https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev/api/verify-glass", data=body, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
        obs = d.get("observasjon", {})
        print(json.dumps({
            "ok": d.get("ok"),
            "r43Nummer": d.get("r43Nummer"),
            "r43LestAvAI": obs.get("r43Numbers"),
            "eurocodes": obs.get("eurocodes"),
            "warnings": obs.get("warnings"),
            "rawText": (obs.get("rawText") or "")[:300],
            "treff": d.get("treff"),
            "fusionOutcome": (d.get("fusion") or {}).get("outcome"),
            "melding": d.get("melding"),
        }, ensure_ascii=False, indent=1))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:500])
PY
echo "FERDIG"
