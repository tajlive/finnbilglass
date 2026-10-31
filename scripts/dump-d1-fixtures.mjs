#!/usr/bin/env node
/**
 * Dump ground_truth + glass_prisliste fra prod-D1 (finnbilglass-db) til
 * data/fixtures/ som JSONL — lokale test-fixtures (kjøres uten nettverk).
 *
 * Korrekthet (2026-08-19):
 * - ground_truth dumpes i 10-års-chunks [1940,2030) PLUSS en eksplisitt
 *   rest-query (year IS NULL OR year < 1940 OR year >= 2030). Prod har 321
 *   slike rader (dummy-år 1500–1939 / 2030–2060) som ellers ville forsvunnet
 *   stille fra fixturen (36 180 → 35 859). Totalsjekk mot SELECT COUNT(*)
 *   feiler hvis noe faller ut.
 * - glass_prisliste dumpes i OFFSET-chunks (5000) med totalsjekk.
 * - Manifest skrives til data/fixtures/manifest.json (tid, DB, antall per
 *   del). data/fixtures/ er gitignored — kjør scriptet for å regenerere
 *   fixtures før npm test (7 GT-fixture-tester skippes uten dem).
 *
 * Bruk: node scripts/dump-d1-fixtures.mjs
 * Krever CLOUDFLARE_API_TOKEN (klarpakke/.env.local) + CLOUDFLARE_ACCOUNT_ID.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
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

  // ── ground_truth: 10-års-chunks [1940,2030) + eksplisitt rest ─────────────
  const gt = [];
  const chunkTeller = {};
  for (let y = 1940; y <= 2020; y += 10) {
    const rader = await q(`SELECT make, model, year, frontrute_eurocode, confidence FROM ground_truth
      WHERE year >= ${y} AND year < ${y + 10}`);
    gt.push(...rader);
    chunkTeller[`${y}-${y + 9}`] = rader.length;
  }
  const rest = await q(`SELECT make, model, year, frontrute_eurocode, confidence FROM ground_truth
    WHERE year IS NULL OR year < 1940 OR year >= 2030`);
  gt.push(...rest);

  // Totalsjekk: chunks + rest må matche SELECT COUNT(*) — aldri stille tap.
  const total = (await q('SELECT COUNT(*) AS n FROM ground_truth'))[0]?.n ?? -1;
  if (gt.length !== total) {
    throw new Error(`ground_truth-uttrekk ufullstendig: ${gt.length} rader dumpet, men ${total} i DB. Fiks dump-scriptet.`);
  }

  writeFileSync(join(OUT, 'ground-truth.jsonl'), gt.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`ground_truth: ${gt.length} rader (i DB: ${total}; rest utenfor 1940-2029: ${rest.length}) → ${join(OUT, 'ground-truth.jsonl')}`);

  // ── glass_prisliste: OFFSET-chunks (5000) ────────────────────────────────
  const pl = [];
  for (let off = 0; ; off += 5000) {
    const rader = await q(`SELECT varenr, varenavn, kommentar, pris, eurokode, rad_type FROM glass_prisliste LIMIT 5000 OFFSET ${off}`);
    pl.push(...rader);
    if (rader.length < 5000) break;
  }
  const plTotal = (await q('SELECT COUNT(*) AS n FROM glass_prisliste'))[0]?.n ?? -1;
  if (pl.length !== plTotal) {
    throw new Error(`glass_prisliste-uttrekk ufullstendig: ${pl.length} rader dumpet, men ${plTotal} i DB.`);
  }
  writeFileSync(join(OUT, 'glass-prisliste.jsonl'), pl.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`glass_prisliste: ${pl.length} rader → ${join(OUT, 'glass-prisliste.jsonl')}`);

  // ── Manifest (sporbarhet) ────────────────────────────────────────────────
  const manifest = {
    dumpet: new Date().toISOString(),
    db_uuid: DB,
    db_navn: 'finnbilglass-db (prod)',
    ground_truth: { i_db: total, dumpet: gt.length, aar_chunks: chunkTeller, rest_utenfor_1940_2029: rest.length },
    glass_prisliste: { i_db: plTotal, dumpet: pl.length },
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`ferdig. Størrelse: ${(fs.statSync(join(OUT, 'ground-truth.jsonl')).size + fs.statSync(join(OUT, 'glass-prisliste.jsonl')).size) / 1e6} MB`);
  console.log(`manifest: ${join(OUT, 'manifest.json')}`);
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
