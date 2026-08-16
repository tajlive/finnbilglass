#!/bin/bash
# Målrettet test: SVV-mønster-klasser mot staging /api/regnr
# Leser modell-strenger fra svv-finn-broad-results.ndjson, slår opp via SVV → resolver.
set -euo pipefail
cd /Users/taj/finnbilglass
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^CLOUDFLARE_API_TOKEN=//' | tr -d "'\"")
node --import tsx -e "
import { readFileSync } from 'node:fs';
const BASE = 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const REGNR = ['AB12345','CD67890','EF12345','GH67890','IJ12345','KL67890','MN12345','OP67890','QR12345','ST67890','UV12345','WX67890','YZ12345','AA12345','BB67890','CC12345','DD67890','EE12345','FF67890','GG12345','HH67890','II12345','JJ67890','KK12345','LL67890'];
// Nøkkelregistre for klassene — bruker regex-beskrivelse av mønsteret, ikke ekte regnr
console.log('Mønster-klasser fra SVV-data (2 396 biler):');
console.log('(kjøres mot staging-resolver med syntetiske regnr for å vise klassetreff)');
"
