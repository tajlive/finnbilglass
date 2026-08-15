#!/usr/bin/env node
/**
 * GT-import: splitter gt-generert.sql i batcher à 200 rader og importerer
 * til D1 via CF D1 REST API (stabil i bakgrunn; wrangler-child-prosess feiler der).
 *
 * Bruk:  node scripts/gt-import.mjs [staging|prod] [--dry-run]
 *   staging (default) → finnbilglass-db-staging
 *   prod              → finnbilglass-db
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DB = {
  staging: '6c8c3eeb-e4bb-41c7-831f-25e5a735717c',
  prod: 'ac35018c-0d43-4742-adf8-d881b7274684',
};
const ACC = '80d5b1d56a3e907150ba7348b6182894';

function env(name) {
  const val = process.env[name];
  if (!val) {
    // les fra klarpakke/.env.local
    try {
      const txt = readFileSync('/Users/taj/klarpakke/.env.local', 'utf8');
      const m = txt.match(new RegExp(`^${name}=(.*)$`, 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
    throw new Error(`Mangler ${name}`);
  }
  return val;
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const target = argv.includes('prod') ? 'prod' : 'staging';
  const dbId = DB[target];
  const token = env('CLOUDFLARE_API_TOKEN');

  const sql = readFileSync('/Users/taj/finnbilglass/data/gt-ekspansjon/gt-generert.sql', 'utf8');
  // SQL-format: kommentarlinje + én INSERT-setning med mange tuple-rader
  const insIdx = sql.indexOf('INSERT');
  const nl = sql.indexOf('\n', insIdx);
  const hdr = sql.slice(insIdx, nl + 1); // «INSERT OR IGNORE ... VALUES\n»
  const rader = sql.slice(nl + 1).split('\n').filter((l) => l.startsWith('('))
    .map((l) => l.replace(/,\s*$/, '')); // strip radens trailing komma — join legger til eget
  console.log(`${target}: ${rader.length} GT-rader i ${Math.ceil(rader.length / 200)} batcher`);

  if (dry) return;

  const stateFile = `/Users/taj/finnbilglass/data/gt-ekspansjon/import-state-${target}.json`;
  let startBatch = 0;
  if (existsSync(stateFile)) startBatch = JSON.parse(readFileSync(stateFile, 'utf8')).doneBatches ?? 0;

  const B = 200;
  let done = 0;
  for (let i = 0; i < rader.length; i += B) {
    const batchNo = i / B;
    if (batchNo < startBatch) continue;
    const chunk = rader.slice(i, i + B).join(',\n').replace(/,\s*$/, '');
    const stmt = `${hdr}${chunk}`;
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: stmt }),
    });
    const j = await res.json();
    if (!j.success) {
      console.error(`Batch ${batchNo} FEILET: ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
      writeFileSync(stateFile, JSON.stringify({ doneBatches: batchNo, error: String(j.errors?.[0]?.message ?? 'ukjent') }));
      process.exit(1);
    }
    done += chunk.split('(').length - 1;
    if (batchNo % 20 === 0) {
      console.log(`batch ${batchNo}/${Math.ceil(rader.length / B)} — ${done} rader`);
      writeFileSync(stateFile, JSON.stringify({ doneBatches: batchNo + 1 }));
    }
  }
  writeFileSync(stateFile, JSON.stringify({ doneBatches: Math.ceil(rader.length / B), ferdig: true }));
  console.log(`FERDIG: ${done} rader til ${target}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
