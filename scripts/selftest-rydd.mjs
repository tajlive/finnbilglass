#!/usr/bin/env node
/**
 * Rydderutine for egentest-ressurser (source=self_test_50).
 *
 * Lister — og valgfritt sletter — alle evidence-saker, R2-objekter og D1-rader
 * for en gitt runId. DEFAULT = DRY-RUN (viser hva som VILLE blitt slettet).
 * Faktisk sletting krever --execute OG separat godkjenning fra Tom.
 *
 * Bulk-basert (JOIN på session_id) — ~8 D1-kall uansett saksantall.
 *
 * Bruk:
 *   node scripts/selftest-rydd.mjs --runId self_test_50_20260819144905_83534
 *   node scripts/selftest-rydd.mjs --runId <id> --db prod --execute   (aldri uten godkjenning)
 */
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const runIdx = args.indexOf('--runId');
const dbIdx = args.indexOf('--db');
const runId = runIdx >= 0 ? (args[runIdx + 1] ?? '') : '';
const db = dbIdx >= 0 ? (args[dbIdx + 1] ?? 'staging') : 'staging';
const execute = args.includes('--execute');

if (!runId) { console.error('Bruk: --runId <id> [--db staging|prod] [--execute]'); process.exit(2); }
if (execute && !process.env.SELFTEST_CLEANUP_APPROVED) {
  console.error('NEKTER: --execute krever at SELFTEST_CLEANUP_APPROVED=true er satt (separat godkjenning).');
  process.exit(2);
}

const DB_UUID = db === 'prod' ? 'ac35018c-0d43-4742-adf8-d881b7274684' : '6c8c3eeb-e4bb-41c7-831f-25e5a735717c';
const BUCKET = db === 'prod' ? 'finnbilglass-opplaering' : 'finnbilglass-opplaering-staging';

function bws() {
  try {
    const env = execSync('grep -E "^(BWS_ACCESS_TOKEN|BWS_PROJECT_ID)=" ~/.hermes/.env', { encoding: 'utf8', shell: '/bin/bash' });
    return execSync(`export ${env.replace(/\n/g, ' ')}; bws secret list 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['value'] for s in d if s['key']=='CLOUDFLARE_API_TOKEN'][0])" | tr -d '"'`, { encoding: 'utf8', shell: '/bin/bash' }).trim();
  } catch { return process.env.CLOUDFLARE_API_TOKEN ?? ''; }
}
const CF = bws();
const API = 'https://api.cloudflare.com/client/v4';
const H = { Authorization: `Bearer ${CF}`, 'Content-Type': 'application/json' };

async function d1(sql, ...bind) {
  const r = await fetch(`${API}/accounts/80d5b1d56a3e907150ba7348b6182894/d1/database/${DB_UUID}/query`, { method: 'POST', headers: H, body: JSON.stringify({ sql, params: bind }) });
  const d = await r.json();
  if (!d.success) throw new Error(`D1: ${JSON.stringify(d.errors)}`);
  return d.result[0].results ?? [];
}
async function r2Delete(key) {
  const r = await fetch(`${API}/accounts/80d5b1d56a3e907150ba7348b6182894/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, { method: 'DELETE', headers: H });
  return r.status;
}

const LIKE = `%${runId}%`;
const J = `JOIN evidence_cases c ON t.case_id = c.case_id WHERE c.session_id LIKE ?`;

console.log(`\n=== Ryddeplan (${execute ? 'EXECUTE' : 'DRY-RUN'}) — runId ${runId} · db ${db} ===`);

const saker = await d1(`SELECT case_id, session_id, status FROM evidence_cases WHERE session_id LIKE ?`, LIKE);
const bilder = await d1(`SELECT t.case_id, t.image_id, t.image_type, t.r2_key, t.thumb_r2_key FROM evidence_case_images t ${J}`, LIKE);
const kvalitet = await d1(`SELECT t.event_id FROM evidence_case_image_quality_events t ${J}`, LIKE);
const review = await d1(`SELECT t.event_id FROM evidence_case_review_events t ${J}`, LIKE);
const status = await d1(`SELECT t.event_id FROM evidence_case_status_events t ${J}`, LIKE);
const kandidater = await d1(`SELECT t.case_id FROM evidence_case_candidate_snapshots t ${J}`, LIKE);

const d1Rader = saker.length + bilder.length + kvalitet.length + review.length + status.length + kandidater.length;
const r2Objekter = bilder.reduce((n, b) => n + (b.r2_key ? 1 : 0) + (b.thumb_r2_key ? 1 : 0), 0);

console.log(`Saker: ${saker.length} · D1-rader: ${d1Rader} (cases ${saker.length} / bilder ${bilder.length} / kvalitet ${kvalitet.length} / review ${review.length} / status ${status.length} / kandidater ${kandidater.length})`);
console.log(`R2-objekter: ${r2Objekter} (fullbilder + thumbnails)`);
for (const b of bilder.slice(0, 8)) console.log(`  ${b.case_id}: ${b.image_type} r2=${b.r2_key} thumb=${b.thumb_r2_key}`);
if (bilder.length > 8) console.log(`  … +${bilder.length - 8} bilder`);

if (!execute) {
  console.log('\nDRY-RUN: ingenting slettet. Kjør med --execute (og SELFTEST_CLEANUP_APPROVED=true) etter separat godkjenning.');
  process.exit(0);
}

// Slett i FK-rekkefølge (children → parent), deretter R2.
for (const s of saker) {
  await d1(`DELETE FROM evidence_case_image_quality_events WHERE case_id = ?`, s.case_id);
  await d1(`DELETE FROM evidence_case_review_events WHERE case_id = ?`, s.case_id);
  await d1(`DELETE FROM evidence_case_status_events WHERE case_id = ?`, s.case_id);
  await d1(`DELETE FROM evidence_case_candidate_snapshots WHERE case_id = ?`, s.case_id);
  await d1(`DELETE FROM evidence_case_images WHERE case_id = ?`, s.case_id);
  await d1(`DELETE FROM evidence_cases WHERE case_id = ?`, s.case_id);
}
for (const b of bilder) {
  if (b.r2_key) await r2Delete(b.r2_key);
  if (b.thumb_r2_key) await r2Delete(b.thumb_r2_key);
}
console.log(`\nSlettet: ${d1Rader} D1-rader + ${r2Objekter} R2-objekter (${saker.length} saker).`);
