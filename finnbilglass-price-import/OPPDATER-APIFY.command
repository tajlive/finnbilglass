#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo 'FinnBilGlass v1.0.13: sikkerhetskontroll, tester og trygg Apify-opplasting'
./installer-pa-mac.sh
printf '\nResultatet over avgjør om publisering ble utført.\n'
echo 'Trykk Enter for å lukke Terminal-vinduet.'
read -r _ || true
