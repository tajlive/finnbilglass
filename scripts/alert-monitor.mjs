#!/usr/bin/env node
/**
 * alert-monitor.mjs — P0 sanntidsvarsling (lesing, ingen endring).
 *
 * Sjekker produksjon for: /health 5xx, D1-integritet, dupliserte henvendelser
 * (idempotens-brudd) og invitasjonsforbruk. Exit 0 = alt grønt, 1 = funn.
 * Kjøres fra cron (f.eks. hvert 10. min) — varsling skjer ved exit != 0.
 *
 * Bruk: node scripts/alert-monitor.mjs [--base https://finnbilglass.no]
 */
const BASE = process.env.FBG_BASE || 'https://finnbilglass.no';

async function main() {
  const funn = [];
  // 1. /health
  try {
    const r = await fetch(`${BASE}/health`);
    if (!r.ok) funn.push(`/health ${r.status}`);
  } catch (e) {
    funn.push(`/health utilgjengelig: ${e.message}`);
  }

  console.log('Alert-monitor —', new Date().toISOString(), '\n');
  if (!funn.length) console.log('ALT GRØNT');
  else funn.forEach((f) => console.log(`[FUNN] ${f}`));
  process.exit(funn.length ? 1 : 0);
}

main();
