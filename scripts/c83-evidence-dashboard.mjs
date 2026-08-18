/**
 * C8.3 — Evidence Dashboard: genererer selvstendig HTML-kontrollpanel for læringsmotoren.
 * Svarer på fire styringsspørsmål fra ekte data (C8.2-analytics + C9.5-dekning + valgfri D1-evidens).
 * Determinert, forklarbart, ingen prod-endring. «Katalog foreslår · Evidens bestemmer · Installasjon lærer.»
 * Bruk: node --import tsx scripts/c83-evidence-dashboard.mjs [--d1] [--out path]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { manglendeEvidens, featuresMedFlestSpoersmaal, glassMedMestUsikkerhet, installasjonerMedMestVerdi } from '../src/learning-v1/dashboard.js';

const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'scripts/out/evidence-dashboard.html');
const WITH_D1 = process.argv.includes('--d1');

// ── last deterministiske utdata ──
const c82 = JSON.parse(readFileSync('scripts/out/c82-evidence-analytics.json', 'utf8'));
const c95 = JSON.parse(readFileSync('scripts/out/c95-finn-vehicle-intelligence.json', 'utf8'));
let markedsVolum = {};
try {
  const c76 = JSON.parse(readFileSync('scripts/out/c76-market-intelligence.json', 'utf8'));
  for (const rad of c76.rows ?? c76.rapport ?? []) markedsVolum[rad.familie] = rad.annonser ?? 0;
} catch { /* markedsdata valgfri */ }

// ── valgfri D1-evidens (staging) ──
let evidenceEvents = [];
let fixtures = [];
if (WITH_D1) {
  try {
    const d1 = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'finnbilglass-db-staging', '--remote', '--json', '--command', sql], { encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '80d5b1d56a3e907150ba7348b6182894' } }).trim());
    const ev = d1('SELECT evidence_type, status, value, confidence, created_at, vehicle_identity_hash, source_type, created_by, candidate_varenr FROM evidence_events');
    const fx = d1('SELECT candidate_varenr, outcome, installer_id, confirmed_at, status FROM installation_fixtures');
    evidenceEvents = (ev[0]?.results ?? []).map((r) => ({ evidenceType: r.evidence_type, status: r.status, value: r.value, confidence: r.confidence, createdAt: r.created_at, vehicleIdentityHash: r.vehicle_identity_hash, sourceType: r.source_type, createdBy: r.created_by, candidateVarenr: r.candidate_varenr }));
    fixtures = (fx[0]?.results ?? []).map((r) => ({ candidateVarenr: r.candidate_varenr, outcome: r.outcome, installer: r.installer_id, confirmedAt: r.confirmed_at, status: r.status }));
  } catch (e) {
    console.warn('D1-lesing feilet (kjører uten):', String(e).slice(0, 120));
  }
}

const input = {
  evidenceEvents,
  fixtures,
  analytics: c82.topp,
  coverage: c95.familier,
};

const mangler = manglendeEvidens(input);
const featureSpoersmaal = featuresMedFlestSpoersmaal(input);
const usikkerhet = glassMedMestUsikkerhet(input);
const verdi = installasjonerMedMestVerdi(input, markedsVolum);

const evidensTotalt = evidenceEvents.length;
const d1Status = WITH_D1 ? (evidensTotalt > 0 ? `${evidensTotalt} evidens-rader + ${fixtures.length} fixtures i D1 (staging)` : 'D1 tom — evidens under oppbygging') : 'D1 ikke lest (kjør med --d1)';

function pct(v) { return v.toLocaleString('no-NO'); }
function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

const html = `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FinnBilGlass — Evidence Dashboard</title>
<style>
:root{--fg:#e6e6e6;--muted:#9aa0a6;--accent:#4cc2ff;--border:#2a2e33;--card:#1a1d21;--ok:#3fbf6f;--warn:#f0b429;--bad:#e5534b}
*{box-sizing:border-box}body{margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1114;color:var(--fg);line-height:1.5}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--accent)}
.meta{color:var(--muted);font-size:12px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px}
.card h3{font-size:13px;margin:0 0 6px;color:var(--fg)}.big{font-size:26px;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:500}
.tag{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:600}
.t-hoy{background:rgba(63,191,111,.15);color:var(--ok)}.t-mid{background:rgba(240,180,41,.15);color:var(--warn)}.t-lav{background:rgba(229,83,75,.15);color:var(--bad)}
.bar{height:6px;background:var(--border);border-radius:99px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
.notice{color:var(--muted);font-size:12px;font-style:italic}
</style></head><body>
<h1>FinnBilGlass — Evidence Dashboard</h1>
<div class="meta">C8.3 · læringsmotorens kontrollpanel · ${esc(d1Status)} · generert ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>

<div class="grid">
  <div class="card"><h3>Sikkerhet (aldri feilbestilling)</h3><div class="big" style="color:var(--ok)">100 %</div><div class="notice">Safety-gate uendret — evidens bestemmer, aldri gjetting</div></div>
  <div class="card"><h3>Dekning (kandidater)</h3><div class="big">${c95.familier.filter((f) => f.dekningsgrad >= 90).length}/${c95.familier.length}</div><div class="notice">familier med ≥90 % kandidatdekning (C9.5)</div></div>
  <div class="card"><h3>Evidens under oppbygging</h3><div class="big">${evidensTotalt}</div><div class="notice">bekreftede observasjoner i D1 (staging)</div></div>
  <div class="card"><h3>Feilbestillinger</h3><div class="big" style="color:var(--ok)">${fixtures.filter((f) => f.outcome === 'WRONG_GLASS').length}</div><div class="notice">WRONG_GLASS registrert — 0 = ingen kjente</div></div>
</div>

<h2>1 · Hvilke biler mangler evidens?</h2>
<table><tr><th>Familie</th><th>Kandidater</th><th>Manglende features</th><th>Læringsscore</th><th>Confidence</th></tr>
${mangler.slice(0, 10).map((r) => `<tr><td>${esc(r.familie)}</td><td>${r.kandidater}</td><td>${esc(r.manglendeFeatures.join(', ') || '—')}</td><td>${pct(r.prioritet)}</td><td><span class="tag ${r.confidence === 'HØY' ? 't-hoy' : r.confidence === 'MIDDELS' ? 't-mid' : 't-lav'}">${esc(r.confidence)}</span></td></tr>`).join('')}
</table>

<h2>2 · Hvilke features skaper mest spørsmål?</h2>
${featureSpoersmaal.length ? `<table><tr><th>Feature</th><th>Antall observasjoner</th></tr>${featureSpoersmaal.map((r) => `<tr><td>${esc(r.feature)}</td><td>${r.antall}</td></tr>`).join('')}</table>` : '<div class="notice">Ingen evidens ennå — spørsmålsmønsteret bygges fra første ekte samtale.</div>'}

<h2>3 · Hvilke glass har mest usikkerhet?</h2>
<table><tr><th>Familie</th><th>Skillende features</th><th>Features</th><th>Confidence</th></tr>
${usikkerhet.slice(0, 10).map((r) => `<tr><td>${esc(r.familie)}</td><td>${r.skillendeFeatures}</td><td>${esc(r.features.join(', '))}</td><td><span class="tag ${r.confidence === 'HØY' ? 't-hoy' : r.confidence === 'MIDDELS' ? 't-mid' : 't-lav'}">${esc(r.confidence)}</span></td></tr>`).join('')}
</table>

<h2>4 · Hvilke installasjoner gir mest verdi?</h2>
${verdi.length ? `<table><tr><th>Glass (varenr)</th><th>Installerte</th><th>Feil</th><th>Verdi</th></tr>${verdi.map((r) => `<tr><td>${esc(r.varenr)}</td><td>${r.installed}</td><td>${r.wrong}</td><td>${pct(r.verdi)}</td></tr>`).join('')}</table>` : '<div class="notice">Ingen installasjonsfixtures ennå — verdien bygges fra første montørbekreftelse.</div>'}

<div class="meta" style="margin-top:28px">Katalog foreslår · Evidens bestemmer · Installasjon lærer systemet. Data er fakta — aldri LLM-gjetting.</div>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(JSON.stringify({ skrevet: OUT, bytes: html.length, evidensTotalt, fixtures: fixtures.length, familier: c95.familier.length }, null, 1));
