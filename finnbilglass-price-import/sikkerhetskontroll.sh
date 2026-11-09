#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p audit-reports
if [[ ! -f package-lock.json ]]; then
  echo 'Oppretter package-lock.json fra npm-registeret (ingen kode eller passord sendes).'
  npm install --package-lock-only --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund
fi

echo 'Kontrollerer at sikkerhetsfiksen basic-ftp@6.2.3 er låst i package-lock.json ...'
node src/verify-lockfile.js

echo 'Kjører npm audit for produksjonsavhengigheter ...'
set +e
npm audit --omit=dev --omit=optional --json > audit-reports/initial.json
initial_rc=$?
set -e
node src/audit-gate.js audit-reports/initial.json --report-only || {
  echo 'STOPP: Kunne ikke lese audit-rapporten, f.eks. pga. nettverk. Ingen opplasting.'
  exit 2
}

# A remediation is attempted only within compatible ranges; never use --force.
if [[ "$initial_rc" -ne 0 ]]; then
  echo 'Prøver kun kompatible sikkerhetsoppdateringer (uten --force).'
  set +e
  npm audit fix --package-lock-only --omit=dev --omit=optional --ignore-scripts --no-fund
  fix_rc=$?
  set -e
  if [[ "$fix_rc" -ne 0 ]]; then
    echo 'Merk: Ikke alle funn kunne rettes automatisk. Kontrollerer sluttstatus.'
  fi
fi

node src/verify-lockfile.js
set +e
npm audit --omit=dev --omit=optional --audit-level=high --json > audit-reports/final.json
final_rc=$?
set -e
node src/audit-gate.js audit-reports/final.json
# The parser blocks high/critical AND audit/network errors. Do not interpret
# npm's non-zero status alone as proof of high severity (low findings can remain).
echo 'PASS: Ingen kjente HIGH/CRITICAL advisories i produksjonsavhengighetene.'
