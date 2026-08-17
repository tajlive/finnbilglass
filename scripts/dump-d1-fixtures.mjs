#!/usr/bin/env node
/**
 * Dump ground_truth + glass_prisliste fra prod-D1 (finnbilglass-db) til
 * data/fixtures/ som JSONL — lokale test-fixtures (kjøres uten nettverk).
 *
 * Bruk: node scripts/dump-d1-fixtures.mjs
 * Krever CLOUDFLARE_API_TOKEN (klarpakke/.env.local) + CLOUDFLARE_ACCOUNT_ID.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'fixtures');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '80d5b1d56a3e907150ba7348b6182894';
const DB = process.env.FINNBILGLASS_DB_UUID ?? 'ac35018c-0d43-4742-adf8-d881b7274684'; // prod

async function main() {
  const fs = await import('node:fs');
  let tok = process.env.CLOUDFLARE_API_TOKEN;
  if (!tok) {
    try {
      const env = fs.readFileSync('/Users/taj/klarpakke/.env.local', 'utf8');
      const m = env.match(/^CLOUDFLARE_API_TOKEN="?([^"\n]+)"?/m);
      if (m) tok = m[1];
    } catch { /* ignore */ }
  }
  if (!tok) throw new Error('CLOUDFLARE_API_TOKEN mangler');
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  mkdirSync(OUT, { recursive: true });

  const q = async (sql) => {
    const r = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
      method: 'POST', headers: H, body: JSON.stringify({ sql }),
    })).json();
    if (!r.success) throw new Error('D1-query feilet: ' + JSON.stringify(r.errors) + ' — SQL: ' + sql.slice(0, 120));
    return r.result?.[0]?.results ?? [];
  };

  // ground_truth i år-chunks
  const gt = [];
  for (let y = 1940; y <= 2026; y += 10) {
    const rader = await q(`SELECT make, model, year, frontrute_eurocode, confidence FROM ground_truth
      WHERE year >= ${y} AND year < ${y + 10}`);
    gt.push(...rader);
  }
  writeFileSync(join(OUT, 'ground-truth.jsonl'), gt.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('ground_truth:', gt.length, 'rader →', join(OUT, 'ground-truth.jsonl'));

  // glass_prisliste i OFFSET-chunks
  const pl = [];
  for (let off = 0; ; off += 5000) {
    const rader = await q(`SELECT varenr, varenavn, kommentar, pris, eurokode, rad_type FROM glass_prisliste LIMIT 5000 OFFSET ${off}`);
    pl.push(...rader);
    if (rader.length < 5000) break;
  }
  writeFileSync(join(OUT, 'glass-prisliste.jsonl'), pl.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('glass_prisliste:', pl.length, 'rader →', join(OUT, 'glass-prisliste.jsonl'));

  console.log('ferdig. Størrelse:', (fs.statSync(join(OUT, 'ground-truth.jsonl')).size + fs.statSync(join(OUT, 'glass-prisliste.jsonl')).size) / 1e6, 'MB');
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
