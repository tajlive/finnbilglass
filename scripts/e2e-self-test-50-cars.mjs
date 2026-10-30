#!/usr/bin/env node
/**
 * E2E-egentest — 50 biler for Finnbilglass (staging).
 *
 * Validerer hele kjeden per bil:
 *   regnr → SVV-kjøretøy → kandidat-/glassøk → kundevendt bildeopplasting
 *   → R2 fullbilde + thumbnail → evidence case → Operations Center
 *   → read-only AI-observasjon.
 *
 * Sikkerhet:
 *  - Nekter production med mindre ALLOW_SELF_TEST_PRODUCTION=true er satt.
 *  - AI får aldri annen decisionAuthority enn NONE.
 *  - Ingen review-/status-skriving på test-sakene (human-review-endepunkter
 *    berøres ikke); review/status-ruter verifiseres kun som 403 feature_disabled.
 *  - Alle ressurser merkes source=self_test_50 + runId i sessionId.
 *
 * Bruk:
 *   node scripts/e2e-self-test-50-cars.mjs
 *   BASE_URL=... node scripts/e2e-self-test-50-cars.mjs
 *   SELFTEST_TOKEN=... node scripts/e2e-self-test-50-cars.mjs   (hvis ikke BWS)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const ALLOW_PROD = process.env.ALLOW_SELF_TEST_PRODUCTION === 'true';

// ── Production-guard ─────────────────────────────────────────────
const erProduksjon = /finnbilglass\.no$|^https:\/\/(www\.)?finnbilglass\.no/.test(BASE);
if (erProduksjon && !ALLOW_PROD) {
  console.error(`NEKTER: ${BASE} er produksjon. Sett ALLOW_SELF_TEST_PRODUCTION=true kun etter eksplisitt godkjenning.`);
  process.exit(2);
}

// ── Token (BWS → env-fallback) ──────────────────────────────────
function hentToken() {
  if (process.env.SELFTEST_TOKEN) return process.env.SELFTEST_TOKEN;
  try {
    const env = execSync('grep -E "^(BWS_ACCESS_TOKEN|BWS_PROJECT_ID)=" ~/.hermes/.env', { encoding: 'utf8', shell: '/bin/bash' });
    const out = execSync(`export ${env.replace(/\n/g, ' ')}; bws secret list 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['value'] for s in d if s['key']=='SUPPORT_EVIDENCE_TOKEN_STAGING'][0])" | tr -d '"'`, { encoding: 'utf8', shell: '/bin/bash' });
    const t = out.trim();
    if (t) return t;
  } catch { /* fallthrough */ }
  console.error('Mangler support-token. Sett SELFTEST_TOKEN eller kjør med BWS-tilgang.');
  process.exit(2);
}
const TOKEN = hentToken();

// ── Konfig ──────────────────────────────────────────────────────
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'data/fixtures/self-test-50-cars.json'), 'utf8'));
const BILDE_FULL = readFileSync(join(ROOT, 'data/fixtures/self-test-50-bilde-full.jpg'));
const BILDE_THUMB = readFileSync(join(ROOT, 'data/fixtures/self-test-50-bilde-thumb.jpg'));
const DATA_URL_FULL = `data:image/jpeg;base64,${BILDE_FULL.toString('base64')}`;
const DATA_URL_THUMB = `data:image/jpeg;base64,${BILDE_THUMB.toString('base64')}`;
const RUN_ID = `self_test_50_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${process.pid}`;
const PARALLELLITET = 3;
const DELAY_MS = 150;
const TIMEOUT_MS = 20000;
const MAX_RETRY = 2;

const OUT_DIR = join(ROOT, 'output', 'self-test-50', RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kall(path, { method = 'POST', body, token = true, retry = MAX_RETRY } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', 'User-Agent': `Mozilla/5.0 (self-test-50 ${RUN_ID})` };
  if (token) headers.Authorization = `Bearer ${TOKEN}`;
  let sisteFeil = null;
  for (let i = 0; i <= retry; i++) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      clearTimeout(tid);
      const ms = Date.now() - t0;
      const ct = r.headers.get('content-type') ?? '';
      let data = null;
      let bytes = null;
      if (ct.includes('json')) {
        data = await r.json().catch(() => null);
      } else {
        const buf = await r.arrayBuffer().catch(() => null);
        bytes = buf ? buf.byteLength : null;
      }
      return { status: r.status, data, bytes, ms, ok: r.ok };
    } catch (e) {
      sisteFeil = e;
      await sleep(400 * (i + 1)); // backoff
    }
  }
  return { status: 0, data: null, ms: 0, ok: false, feil: String(sisteFeil) };
}

// ── Per-bil-verifisering ────────────────────────────────────────
async function verifiserBil(bil, i) {
  const sessionId = `self_test_50_${RUN_ID}_${i}`;
  const ut = { index: i, regnr: bil.regnr, forventet: bil.forventet, steg: {}, ok: true };
  try {
    // A. Kjøretøy
    const a = await kall('/api/regnr', { body: { regnr: bil.regnr }, token: false });
    ut.steg.regnr = { status: a.status, ms: a.ms };
    if (a.status === 0) throw new Error(`regnr-oppslag feilet: ${a.feil}`);
    if (a.status >= 500) throw new Error(`regnr-oppslag 5xx: ${a.status}`);
    if (a.data?.ok === false && a.status !== 200) throw new Error(`regnr-oppslag: ${a.data?.error ?? a.status}`);
    const svv = a.data?.bil;
    ut.bil = svv ? { merke: svv.merke, modell: svv.modell, aar: svv.aar } : null;
    if (svv && svv.merke) ut.faktiskMerke = svv.merke;

    // B. Kandidat-/glassflyt (fra resolveren i /api/regnr — aldri en beslutning)
    const res = a.data?.resolver ?? null;
    const kandidater = Array.isArray(res?.kandidater) ? res.kandidater : [];
    ut.steg.kandidater = { utfall: res?.utfall ?? 'ukjent', antall: kandidater.length };
    const beslutningFelt = ['approved', 'valgtSku', 'beslutning', 'decisionAuthority', 'valgtGlass'];
    const harBeslutning = beslutningFelt.some((f) => f in (a.data ?? {})) || kandidater.some((k) => (k ?? {}).valgt === true || (k ?? {}).approved === true);
    if (harBeslutning) { ut.ok = false; ut.feil.push?.('resolver inneholder beslutningsfelt'); }

    // C. Evidence-opplasting (komprimert testbilde + thumbnail)
    const t0 = Date.now();
    const c = await kall('/api/evidence-capture', { body: { regnr: bil.regnr, sessionId, images: [{ type: 'windshield', data: DATA_URL_FULL, thumbnail: DATA_URL_THUMB }] }, token: false });
    const cms = Date.now() - t0;
    ut.steg.evidence = { status: c.status, ms: cms };
    if (c.status === 201) {
      ut.caseId = c.data?.caseId;
      ut.imageCount = c.data?.imageCount;
      ut.decisionAuthority = c.data?.decisionAuthority;
      if (c.data?.decisionAuthority !== 'NONE') { ut.ok = false; ut.feil.push?.('decisionAuthority ≠ NONE'); }
      // R2: fullbilde + thumbnail via ops-thumb (token) — bytes via arrayBuffer
      const full = await kall(`/api/ops/thumb?key=${encodeURIComponent(`evidence-capture/${ut.caseId}/windshield.jpg`)}`, { method: 'GET', token: true });
      const thumb = await kall(`/api/ops/thumb?key=${encodeURIComponent(`evidence-capture/${ut.caseId}/windshield.thumb.jpg`)}`, { method: 'GET', token: true });
      ut.steg.r2full = { status: full.status, bytes: full.bytes ?? null, ms: full.ms };
      ut.steg.r2thumb = { status: thumb.status, bytes: thumb.bytes ?? null, ms: thumb.ms };
      if (full.status !== 200) throw new Error(`R2 fullbilde mangler: ${full.status}`);
      if (thumb.status !== 200) throw new Error(`R2 thumbnail mangler: ${thumb.status}`);

      // D. Ops-API: saken leses med token, AI-observasjon read-only
      const ops = await kall('/api/ops/ai-observasjoner', { method: 'GET', token: true });
      ut.steg.ops = { status: ops.status, ms: ops.ms };
      if (ops.status !== 200) throw new Error(`ops-API: ${ops.status}`);
      const sak = (ops.data?.evidenssaker ?? []).find((s) => s.caseId === ut.caseId);
      if (!sak) throw new Error('saken finnes ikke i ops-API');
      ut.steg.opsSak = {
        status: sak.status,
        bilder: (sak.images ?? []).map((b) => ({ type: b.imageType, harThumb: !!b.thumbUrl, harFull: !!b.fullUrl })),
        kandidater: (sak.kandidater ?? []).length,
        sisteReview: sak.sisteReview ?? null,
      };
      if (!sak.images?.some((b) => b.thumbUrl && b.fullUrl)) throw new Error('saken mangler thumb/fullUrl i ops');
      // Read-only: siste review-hendelse må være kundens NEW-opprettelse (ingen beslutning tatt).
      const rev = sak.sisteReview ?? null;
      if (rev && rev.status !== 'NEW') throw new Error(`saken har ikke-NEW review-status: ${rev.status}`);
    } else {
      // Gyldig feiltilstand: 400/413/422 er kontrollert; 5xx er feil
      if (c.status >= 500) throw new Error(`evidence-opplasting 5xx: ${c.status} ${c.data?.error ?? ''}`);
      if (c.status === 403 && c.data?.error === 'feature_disabled') { ut.steg.evidence.flagAv = true; }
      else { ut.ok = false; ut.feil.push?.(`evidence ${c.status}: ${c.data?.error ?? ''}`); }
    }
  } catch (e) {
    ut.ok = false;
    ut.feil = [...(ut.feil ?? []), e.message];
  }
  return ut;
}

// ── Negative tester (separate, ikke 50 ganger) ──────────────────
async function negativeTester() {
  const n = {};
  // 1. feature flag av → review/status 403 feature_disabled
  const status = await kall('/api/support/evidence/X/status', { body: { status: 'CONFIRMED', actor: 'Tom', reason: 'x' } });
  n.statusFlagAv = { status: status.status, error: status.data?.error, ok: status.status === 403 && status.data?.error === 'feature_disabled' };
  const reviewFlate = await kall('/support/evidence', { method: 'GET' });
  n.reviewFlateFlagAv = { status: reviewFlate.status, ok: reviewFlate.status === 403 };
  // 2. ugyldig bildedata → 400
  const ugyldig = await kall('/api/evidence-capture', { body: { regnr: 'SU18018', images: [{ type: 'hack', data: 'data:image/png;base64,AAAA' }] }, token: false });
  n.ugyldigType = { status: ugyldig.status, ok: ugyldig.status === 400 };
  // 3. for stort → 413
  const stor = await kall('/api/evidence-capture', { body: { regnr: 'SU18018', images: [{ type: 'windshield', data: `data:image/png;base64,${'A'.repeat(7000000)}` }] }, token: false });
  n.forStor = { status: stor.status, ok: stor.status === 413 };
  // 4. lav oppløsning → 422 kvalitetsgate
  const litenPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const lav = await kall('/api/evidence-capture', { body: { regnr: 'SU18018', images: [{ type: 'windshield', data: `data:image/png;base64,${litenPng}` }] }, token: false });
  n.lavOpplosning = { status: lav.status, error: lav.data?.error?.slice(0, 80), ok: lav.status === 422 };
  // 5. manglende token → 401
  const utenToken = await kall('/api/ops/ai-observasjoner', { method: 'GET', token: false });
  n.utenToken = { status: utenToken.status, ok: utenToken.status === 401 };
  return n;
}

// ── Hovedløp ────────────────────────────────────────────────────
const biler = FIXTURE.biler;
const resultater = [];
let idx = 0;
async function worker() {
  while (idx < biler.length) {
    const i = idx++;
    resultater.push(await verifiserBil(biler[i], i));
    await sleep(DELAY_MS);
  }
}
console.log(`Kjører 50-bilers egentest mot ${BASE} (runId ${RUN_ID})`);
const tStart = Date.now();
await Promise.all(Array.from({ length: PARALLELLITET }, worker));
const totalMs = Date.now() - tStart;

const negative = await negativeTester();
// token-gate én gang per run er dekket av negative.utenToken

// ── Oppsummering ────────────────────────────────────────────────
const pass = resultater.filter((r) => r.ok);
const fail = resultater.filter((r) => !r.ok);
const ev201 = resultater.filter((r) => r.steg.evidence?.status === 201);
const r2fullOk = resultater.filter((r) => r.steg.r2full?.status === 200);
const r2thumbOk = resultater.filter((r) => r.steg.r2thumb?.status === 200);
const opsOk = resultater.filter((r) => r.steg.opsSak);
const authorityAvvik = resultater.filter((r) => r.decisionAuthority && r.decisionAuthority !== 'NONE');
const http5xx = resultater.filter((r) => [r.steg.regnr?.status, r.steg.evidence?.status].some((s) => s >= 500 && s !== 0));
const negOk = Object.values(negative).every((v) => v.ok === true);

const go = pass.length === 50 && ev201.length === 50 && r2fullOk.length === 50 && r2thumbOk.length === 50 && opsOk.length === 50 && authorityAvvik.length === 0 && http5xx.length === 0 && negOk;

const rapport = {
  runId: RUN_ID,
  baseUrl: BASE,
  startTid: new Date().toISOString(),
  totalMs,
  fixture: { versjon: FIXTURE.versjon, biler: biler.length },
  oppsummering: {
    biler: biler.length,
    pass: pass.length,
    fail: fail.length,
    evidence201: ev201.length,
    r2FullOk: r2fullOk.length,
    r2ThumbOk: r2thumbOk.length,
    opsLesOk: opsOk.length,
    decisionAuthorityAvvik: authorityAvvik.length,
    ukontrollerte5xx: http5xx.length,
    katalogtreff: resultater.filter((r) => (r.steg.kandidater?.antall ?? 0) > 0).length,
    ingenKandidat: resultater.filter((r) => (r.steg.kandidater?.antall ?? -1) === 0).length,
    negativeGrønne: negOk,
    GO: go,
  },
  negative,
  avvik: fail.map((r) => ({ regnr: r.regnr, index: r.index, steg: Object.keys(r.steg), feil: r.feil })),
  biler: resultater,
};
writeFileSync(join(OUT_DIR, 'resultat.json'), JSON.stringify(rapport, null, 2));

// Markdown-rapport
const linjer = [];
linjer.push(`# Egentest 50 biler — ${BASE}`, '');
linjer.push(`**RunId:** ${RUN_ID} · **Totaltid:** ${(totalMs / 1000).toFixed(1)}s · **Start:** ${new Date().toISOString()}`, '');
linjer.push('', '## Oppsummering', '');
linjer.push(`| Mål | Verdi |`, `|---|---|`);
linjer.push(`| Kjøretøy-fullføringer | ${pass.length}/50 |`);
linjer.push(`| Evidence-opplasting 201 | ${ev201.length}/50 |`);
linjer.push(`| R2 fullbilde | ${r2fullOk.length}/50 |`);
linjer.push(`| R2 thumbnail | ${r2thumbOk.length}/50 |`);
linjer.push(`| Ops-lesing | ${opsOk.length}/50 |`);
linjer.push(`| decisionAuthority-avvik | ${authorityAvvik.length} |`);
linjer.push(`| Ukontrollerte 5xx/1101 | ${http5xx.length} |`);
linjer.push(`| Negative tester | ${negOk ? 'grønne' : 'RØDE'} |`);
linjer.push(`| **GO / NO-GO** | **${go ? 'GO' : 'NO-GO'}** |`);
linjer.push('', '## Per bil', '', '| # | regnr | merke | modell | år | forventet | kandidater | evidence | R2 full | R2 thumb | ops | DA | resultat |');
linjer.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of resultater) {
  linjer.push(`| ${r.index} | ${r.regnr} | ${r.bil?.merke ?? '—'} | ${r.bil?.modell ?? '—'} | ${r.bil?.aar ?? '—'} | ${r.forventet} | ${r.steg.kandidater?.antall ?? '—'} | ${r.steg.evidence?.status ?? '—'} | ${r.steg.r2full?.status ?? '—'} | ${r.steg.r2thumb?.status ?? '—'} | ${r.steg.ops?.status ?? '—'} | ${r.decisionAuthority ?? '—'} | ${r.ok ? '✅' : '❌ ' + (r.feil ?? []).join('; ')} |`);
}
if (fail.length) {
  linjer.push('', '## Avvik', '');
  for (const f of fail) linjer.push(`- **${f.regnr}** (#${f.index}): ${(f.feil ?? []).join('; ')}`);
}
writeFileSync(join(OUT_DIR, 'rapport.md'), linjer.join('\n'));

console.log(`\n${pass.length}/50 pass · ${fail.length} fail · GO: ${go}`);
console.log(`Rapport: ${OUT_DIR}/rapport.md`);
console.log(`JSON: ${OUT_DIR}/resultat.json`);
process.exit(go ? 0 : 1);
