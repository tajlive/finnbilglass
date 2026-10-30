#!/usr/bin/env bash
# Deploy an already reviewed, isolated staging snapshot. Never deploy the working tree.
set -euo pipefail
snapshot="${1:-}"
if [[ -z "$snapshot" || ! -d "$snapshot/public" || ! -f "$snapshot/wrangler.staging.toml" ]]; then
  echo "Bruk: $0 /absolutt/sti/til/isolert-snapshot" >&2
  exit 2
fi
if [[ "$(cd "$snapshot" && pwd -P)" == "$(cd "$(dirname "$0")/.." && pwd -P)" ]]; then
  echo "Prosjektets arbeidskopi kan ikke publiseres direkte." >&2
  exit 2
fi
cd "$snapshot"
unset CLOUDFLARE_API_TOKEN
./node_modules/.bin/wrangler deploy --config wrangler.staging.toml --env-file /dev/null
