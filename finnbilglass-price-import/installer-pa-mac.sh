#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TARGET="${1:-tomarnejensen/finnbilglass-price-import}"
# Prefer an already-installed Homebrew Node 22 automatically on macOS.
if [[ "$(node --version 2>/dev/null || true)" != v22.* ]]; then
  if command -v brew >/dev/null 2>&1; then
    NODE22_PREFIX="$(brew --prefix node@22 2>/dev/null || true)"
    if [[ -n "${NODE22_PREFIX}" && -x "${NODE22_PREFIX}/bin/node" ]]; then
      export PATH="${NODE22_PREFIX}/bin:${PATH}"
      echo "Automatisk aktivert Node.js 22: $(node --version)"
    fi
  fi
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo 'STOPP: Node.js og npm kreves. Installer Node.js 22 før du fortsetter.'
  exit 2
fi
node -e 'if (Number(process.versions.node.split(".")[0]) !== 22) {console.error("STOPP: Bruk Node.js 22");process.exit(2)}'
echo 'FASE 1/3: Sikkerhetskontroll og låste avhengigheter'
./sikkerhetskontroll.sh
echo 'FASE 2/3: Lokal kodekontroll og regresjonstester'
npm run check
npm test
echo "FASE 3/3: Oppdaterer eksisterende privat Apify Actor: ${TARGET}"
echo 'Apify kan be om nettleserinnlogging. Ikke del kode, token eller passord i chatten.'
npx --yes apify-cli@latest login
npx --yes apify-cli@latest actors push "${TARGET}"
echo 'Upload sendt. Bygg må vise SUCCEEDED før begrenset Apify PROBE-test.'
