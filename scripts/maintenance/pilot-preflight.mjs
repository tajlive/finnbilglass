#!/usr/bin/env node
/**
 * pilot-preflight.mjs — blokkerer pilotstart hvis databasen mangler noe
 * kundereisen er avhengig av.
 *
 * Kjøres manuelt mot et miljø, aldri fra CI (trenger Cloudflare-tilgang):
 *   node scripts/maintenance/pilot-preflight.mjs --database finnbilglass-db-staging --config wrangler.staging.toml
 *
 * Exit 1 = pilot må ikke startes. Hver sjekk har en eksplisitt grunn slik at
 * rapporten kan leses uten å tolke koden.
 */

import { execFileSync } from 'node:child_process';

const ACCOUNT_ID = '80d5b1d56a3e907150ba7348b6182894';

function arg(n) {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const database = arg('database');
const config = arg('config') ?? 'wrangler.toml';
if (!database) {
  console.error('bruk: --database <navn> [--config wrangler.staging.toml]');
  process.exit(2);
}

function sql(uttrykk) {
  const ut = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, '--remote', '--config', config, '--command', uttrykk, '--json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  const i = ut.indexOf('[');
  return i >= 0 ? JSON.parse(ut.slice(i))[0].results : [];
}

/** Hver sjekk: [navn, SQL som gir én rad med ok=1 når kravet er oppfylt, grunn] */
const SJEKKER = [
  [
    'idempotens-tabell (0038)',
    "SELECT COUNT(*) AS ok FROM sqlite_master WHERE type='table' AND name='inquiry_idempotency';",
    'Uten denne kan en dobbeltklikk eller nettverksretry lage to saker i /ops. Kjør migrations/0038_inquiry_idempotency.sql.',
  ],
  [
    'idempotens: PRIMARY KEY på idem_key',
    "SELECT (instr(sql,'idem_key')>0 AND instr(upper(sql),'PRIMARY KEY')>0) AS ok FROM sqlite_master WHERE name='inquiry_idempotency';",
    'Uten primærnøkkel er ikke reserveringen atomisk, og parallelle kall kan begge slippe gjennom.',
  ],
  [
    'henvendelser (beta_inquiries)',
    "SELECT COUNT(*) AS ok FROM sqlite_master WHERE type='table' AND name='beta_inquiries';",
    'Kundereisen kan ikke lagre henvendelser.',
  ],
  [
    'hendelseslogg (beta_inquiry_events)',
    "SELECT COUNT(*) AS ok FROM sqlite_master WHERE type='table' AND name='beta_inquiry_events';",
    'Uten hendelseslogg mangler saksbehandler tidslinjen i /ops.',
  ],
  [
    "hendelseslogg tillater 'reply' (0033)",
    "SELECT (instr(sql,'''reply''')>0) AS ok FROM sqlite_master WHERE name='beta_inquiry_events';",
    "Uten 'reply' i CHECK-constrainten feiler svar til kunde fra /ops.",
  ],
  [
    'rate limit-tabell',
    "SELECT COUNT(*) AS ok FROM sqlite_master WHERE type='table' AND name='inquiry_rate_limits';",
    'Uten rate limit er skjemaet åpent for misbruk.',
  ],
  [
    'prisliste (glass_prisliste)',
    "SELECT COUNT(*) AS ok FROM sqlite_master WHERE type='table' AND name='glass_prisliste';",
    'Uten prisliste kan ikke kunden få NOK-pris.',
  ],
];

let feil = 0;
console.log(`Pilot-preflight — ${database}\n`);
for (const [navn, spørring, grunn] of SJEKKER) {
  let ok = false;
  let detalj = '';
  try {
    const rader = sql(spørring);
    ok = Number(rader?.[0]?.ok ?? 0) > 0;
  } catch (e) {
    detalj = e.message.split('\n')[0];
  }
  if (ok) {
    console.log(`  ✔ ${navn}`);
  } else {
    feil++;
    console.log(`  ✘ ${navn}`);
    console.log(`     ${grunn}`);
    if (detalj) console.log(`     feil: ${detalj}`);
  }
}

console.log();
if (feil > 0) {
  console.log(`PILOT BLOKKERT — ${feil} krav ikke oppfylt.`);
  process.exit(1);
}
console.log('PILOT KLAR — alle krav oppfylt.');
