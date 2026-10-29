#!/usr/bin/env bash
# Deploy an approved, isolated production snapshot. Secrets are managed separately.
set -euo pipefail
snapshot="${1:-}"
if [[ -z "$snapshot" || ! -d "$snapshot/public" || ! -f "$snapshot/wrangler.toml" ]]; then
  echo "Bruk: $0 /absolutt/sti/til/godkjent-isolert-snapshot" >&2
  exit 2
fi
if [[ "$(cd "$snapshot" && pwd -P)" == "$(cd "$(dirname "$0")/.." && pwd -P)" ]]; then
  echo "Prosjektets arbeidskopi kan ikke publiseres direkte." >&2
  exit 2
fi
cd "$snapshot"
unset CLOUDFLARE_API_TOKEN
./node_modules/.bin/wrangler deploy --config wrangler.toml --env-file /dev/null
