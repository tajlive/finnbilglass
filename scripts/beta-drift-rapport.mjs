#!/usr/bin/env node
/**
 * Beta-drift-rapport — daglig overvåking av ekte kundesaker (lesing, ingen endring).
 *
 * Leser prod-D1 (ac35018c) og verifiserer /ops token-gate + R2-thumbnail.
 * Skriver markdown-rapport til output/beta-drift/<dato>.md + stdout.
 *
 * Filtrerer ut interne test-saker (self_test_50, prod-sync-smoke, smoke).
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB = 'ac35018c-0d43-4742-adf8-d881b7274684';
const PROD = 'https://www.finnbilglass.no';
const TEST_PREFIX = ['self_test_50', 'prod-sync-smoke', 'prod-readiness-audit', 'smoke', 'diag'];

function bws() {
  try {
    const env = execSync('grep -E "^(BWS_ACCESS_TOKEN|BWS_PROJECT_ID)=" ~/.hermes/.env', { encoding: 'utf8', shell: '/bin/bash' });
    const cf = execSync(`export ${env.replace(/\n/g, ' ')}; bws secret list 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['value'] for s in d if s['key']=='CLOUDFLARE_API_TOKEN'][0])" | tr -d '"'`, { encoding: 'utf8', shell: '/bin/bash' }).trim();
    const tok = execSync(`export ${env.replace(/\n/g, ' ')}; bws secret list 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['value'] for s in d if s['key']=='SUPPORT_EVIDENCE_TOKEN_PRODUCTION'][0])" | tr -d '"'`, { encoding: 'utf8', shell: '/bin/bash' }).trim();
    return { cf, tok };
  } catch { return { cf: process.env.CLOUDFLARE_API_TOKEN ?? '', tok: process.env.SELFTEST_TOKEN ?? '' }; }
}
const { cf, tok } = bws();

async function d1(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/80d5b1d56a3e907150ba7348b6182894/d1/database/${DB}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cf}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors));
  return d.result[0].results ?? [];
}

const exclude = TEST_PREFIX.map((p) => `session_id NOT LIKE '${p}%'`).join(' AND ');
const siste24h = Date.now() - 24 * 3600 * 1000;

const saker = await d1(`SELECT case_id, session_id, status, created_at FROM evidence_cases WHERE ${exclude} ORDER BY created_at DESC LIMIT 100`);
const saker24 = saker.filter((s) => s.created_at >= siste24h);
const eldsteNy = await d1(`SELECT case_id, created_at FROM evidence_cases WHERE status='NEW' AND ${exclude} ORDER BY created_at ASC LIMIT 1`);
const kvalitetReject = await d1(`SELECT COUNT(*) n FROM evidence_case_image_quality_events WHERE quality_class='REJECT' AND created_at >= ${siste24h}`);
const henvendelser = await d1(`SELECT regnr, navn, melding, status, created_at FROM beta_inquiries WHERE created_at >= ${siste24h} ORDER BY created_at DESC LIMIT 50`);
const kandidatSnap = await d1(`SELECT c.case_id, s.candidates_json FROM evidence_case_candidate_snapshots s JOIN evidence_cases c ON c.case_id = s.case_id WHERE c.${exclude} ORDER BY c.created_at DESC LIMIT 100`);

// Kandidat-fordeling per sak (1=PINPOINT, 2+=VERIFY, 0/ingen=FALLBACK/ukjent)
const snapMap = {};
for (const s of kandidatSnap) {
  try { snapMap[s.case_id] = JSON.parse(s.candidates_json).length; } catch { snapMap[s.case_id] = 0; }
}
let pinpoint = 0, verify = 0, fallback = 0;
for (const s of saker24) {
  const n = snapMap[s.case_id] ?? 0;
  if (n === 1) pinpoint++; else if (n >= 2) verify++; else fallback++;
}

// Verifisering (punkt 4)
const tok401 = (await fetch(`${PROD}/api/ops/summary`)).status === 401;
const tokOk = (await fetch(`${PROD}/api/ops/summary`, { headers: { Authorization: `Bearer ${tok}` } })).status === 200;
// thumbnail på nyeste sak med bilde
let thumbOk = null, thumbCase = null;
for (const s of saker) {
  const img = await d1(`SELECT thumb_r2_key FROM evidence_case_images WHERE case_id='${s.case_id}' LIMIT 1`);
  if (img.length && img[0].thumb_r2_key) {
    const enc = encodeURIComponent(img[0].thumb_r2_key);
    const r = await fetch(`${PROD}/api/ops/thumb?key=${enc}`, { headers: { Authorization: `Bearer ${tok}` } });
    thumbOk = r.status === 200;
    thumbCase = s.case_id;
    break;
  }
}

const na = new Date().toISOString();
const md = [
  `# Beta-driftrapport — ${na}`,
  '',
  `## Verifikasjoner (før rapport)`,
  `- /ops krever token: ${tok401 ? '✅ 401 uten token' : '❌ FEIL'} · med token: ${tokOk ? '✅ 200' : '❌ FEIL'}`,
  `- Nyeste sak thumbnail i R2: ${thumbOk === null ? '— (ingen saker)' : thumbOk ? `✅ ${thumbCase}` : '❌ FEIL'}`,
  `- decisionAuthority: NONE (kode-invariant; bekreftet smoke 2026-08-19)`,
  '',
  '## Nye evidenssaker (siste 24t)',
  `- **${saker24.length}** nye ekte saker (totalt ${saker.length} ikke-test)`,
  `- PINPOINT ${pinpoint} · VERIFY ${verify} · FALLBACK ${fallback}`,
  '',
  `## Eldste ubehandlede sak (status NEW)`,
  eldsteNy.length ? `- ${eldsteNy[0].case_id} — ${new Date(eldsteNy[0].created_at).toISOString()}` : '- ingen',
  '',
  `## Opplastingsfeil (quality REJECT, 24t): ${kvalitetReject[0]?.n ?? 0}`,
  '',
  '## Manuelle henvendelser (24t)',
  henvendelser.length ? henvendelser.map((h) => `- ${h.regnr} ${h.navn ? '· ' + h.navn : ''} (${h.status})${h.melding ? ': ' + h.melding.slice(0, 120) : ''}`).join('\n') : '- ingen',
  '',
].join('\n');

const out = join(ROOT, 'output', 'beta-drift', `${na.slice(0, 10)}.md`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md);
console.log(md);
console.log(`\nRapport skrevet: ${out}`);
