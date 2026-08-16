#!/usr/bin/env node
/**
 * test-500-gt: 500 GT-fasit-rader mot staging (PINPOINT-aggresjons-audit).
 *
 * Grupperer GT per (make, year, model-token) → kjøretøyets GYLDIGE glass-sett.
 * Klasser:
 *   correct_pinpoint   — PINPOINT og valgt ∈ gyldig-sett OG settet har 1 glass
 *   pinpoint_aggressiv — PINPOINT men kjøretøyet har >1 GT-variant (SKAL være VERIFY)
 *   wrong_pinpoint     — PINPOINT og valgt ∉ gyldig-sett (HARD FALSK)
 *   verify_med_fasit   — VERIFY og valgt-sett ∩ kandidater ≠ ∅
 *   verify_uten_fasit  — VERIFY uten overlap
 *   fallback           — FALLBACK
 *   api_feil           — HTTP/JSON-feil
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const DELAY_MS = Number(process.env.DELAY_MS ?? 300);

function args() {
  const a = process.argv.slice(2);
  const o = { alle: false, n: 500, seed: 42 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--alle') o.alle = true;
    else if (a[i] === '--n') o.n = parseInt(a[++i], 10);
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
  }
  return o;
}

async function hentGt() {
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    try {
      const env = readFileSync('/Users/taj/klarpakke/.env.local', 'utf8');
      const m = env.match(/^CLOUDFLARE_API_TOKEN="?([^"\n]+)"?/m);
      if (m) token = m[1];
    } catch { /* undefined */ }
  }
  const ACCOUNT = '80d5b1d56a3e907150ba7348b6182894';
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const dbs = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database`, { headers: H })).json();
  const db = (dbs.result ?? []).find((d) => d.name === 'finnbilglass-db-staging');
  if (!db) throw new Error('fant ikke finnbilglass-db-staging i D1-listen');
  const q = async (sql) => {
    const r = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${db.uuid}/query`, {
      method: 'POST', headers: H, body: JSON.stringify({ sql }),
    })).json();
    if (!r.success) throw new Error('D1-query feilet: ' + JSON.stringify(r.errors));
    return r.result[0]?.results ?? [];
  };
  // GT i år-chunks (unngår CPU-tak + resultatgrense; join gjøres i minne)
  const gt = [];
  for (let y = 1940; y <= 2026; y += 10) {
    const rader = await q(`SELECT make, model, year, frontrute_eurocode FROM ground_truth
      WHERE year >= ${y} AND year < ${y + 10} AND frontrute_eurocode IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL`);
    gt.push(...rader);
  }
  // Prisliste i OFFSET-chunks → map for crosswalk (varenr = gammel kode, eurokode = AGS-kode)
  const pl = new Map();
  for (let off = 0; ; off += 5000) {
    const rader = await q(`SELECT varenr, eurokode FROM autoglass_prisliste WHERE rad_type='glass' LIMIT 5000 OFFSET ${off}`);
    for (const r of rader) pl.set(String(r.varenr), r.eurokode);
    if (rader.length < 5000) break;
  }
  return gt.map((g) => ({ ...g, varenr: g.frontrute_eurocode, pl_eurokode: pl.get(String(g.frontrute_eurocode)) ?? null }));
}

const STOPP = new Set(['CLASS', 'SERIE', 'SERIES', 'LHD', 'RHD', 'AUTOMATIKK', 'AUTOMATIC', 'KOMBI', 'LIMITED', 'SPORT', 'STYLE', 'TURBO', 'TDI', 'CDI', 'TFSI', 'TSI', 'TFSIE', '4MATIC', 'XDRIVE', 'SDRIVE', 'BLUETEC', 'DIESEL', 'GTD', 'GTE', 'GTI', 'AMG', 'ACTIVE', 'DYNAMIC', 'TREND', 'COMFORT', 'LIFE', 'PASSION', 'BASIC', 'EXECUTIVE', 'R-LINE', 'S-LINE', 'PREMIUM', 'BENZ']);
function tokensAv(s) {
  return [...new Set(String(s ?? '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPP.has(t) && !/^\d{2,}$/.test(t)))];
}
function norm(s) { return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** Grupper GT-rader per kjøretøy. Koder-settet (gyldige) = GT-kode + prisliste-varenr +
 *  prisliste-eurokode. gtKoder = kun distinct GT-koder (variant-telling). */
function grupperGt(rader) {
  const grupper = new Map();
  for (const r of rader) {
    const toks = tokensAv(r.model);
    const key = `${norm(r.make)}|${r.year}|${[...toks].sort().join('~')}`;
    if (!grupper.has(key)) grupper.set(key, { key, make: r.make, model: r.model, year: r.year, koder: new Set(), gtKoder: new Set() });
    const g = grupper.get(key);
    if (r.frontrute_eurocode) g.gtKoder.add(norm(r.frontrute_eurocode));
    for (const v of [r.frontrute_eurocode, r.varenr, r.pl_eurokode]) if (v) g.koder.add(norm(v));
  }
  return [...grupper.values()].map((g) => ({ ...g, koder: [...g.koder], gtKoder: [...g.gtKoder] }));
}

/** Pilkington-kodestruktur: base (≥8 alfanumeriske tegn) + utstyrssuffiks.
 *  Eks: 2051AGAC (base) ↔ 2051AGACHIMVZ (full). Samme glass, ulik granularitet. */
function base8(x) { return x.length >= 8 ? x.slice(0, 8) : x; }
function baseTreff(a, b) {
  if (!a || !b) return false;
  const ba = base8(a), bb = base8(b);
  return ba === bb && ba.length >= 8;
}

function seededSample(rows, n, seed) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const idx = [...rows.keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(n, rows.length)).sort((a, b) => a - b).map((i) => rows[i]);
}

async function sok(bil) {
  const t0 = Date.now();
  const resp = await fetch(`${BASE}/api/frontrute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bil),
  });
  const ms = Date.now() - t0;
  let data = null;
  try { data = await resp.json(); } catch { /* ikke-JSON */ }
  return { ms, status: resp.status, data };
}

async function main() {
  const o = args();
  const alleGrupper = grupperGt(await hentGt());
  console.log(`GT-grupper (distinkte kjøretøy): ${alleGrupper.length}`);
  const sett = o.alle ? alleGrupper : seededSample(alleGrupper, o.n, o.seed);
  console.log(`Testsett: ${sett.length} kjøretøy (seed ${o.seed})`);

  const fordeling = {
    correct_pinpoint: 0, pinpoint_aggressiv: 0, wrong_pinpoint: 0,
    verify_med_fasit: 0, verify_uten_fasit: 0, fallback: 0, api_feil: 0,
  };
  const latencies = [];
  const detaljer = [];

  for (const [i, g] of sett.entries()) {
    let r;
    try {
      r = await sok({ merke: g.make, modell: g.model, aar: g.year });
    } catch (e) {
      fordeling.api_feil++;
      detaljer.push({ ...g, klasse: 'api_feil', feil: String(e.message).slice(0, 80) });
      continue;
    }
    latencies.push(r.ms);
    if (r.status !== 200 || !r.data || r.data.ok === false) {
      fordeling.api_feil++;
      detaljer.push({ ...g, klasse: 'api_feil', status: r.status });
      continue;
    }
    const utfall = r.data.utfall ?? (r.data.pinpoint === true ? 'PINPOINT' : r.data.pinpoint === false ? 'VERIFY' : 'FALLBACK');
    const valgtVarenr = norm(r.data.varenr ?? r.data.anbefaling?.varenr ?? '');
    const valgtEuro = norm(r.data.eurocode ?? r.data.anbefaling?.eurokode ?? r.data.kandidater?.[0]?.eurokode ?? '');
    const kandidatKoder = (r.data.kandidater ?? []).flatMap((k) => [norm(k.varenr ?? ''), norm(k.eurokode ?? '')]).filter(Boolean);
    const overlapp = kandidatKoder.filter((k) => g.koder.includes(k)).length;

    if (utfall === 'PINPOINT') {
      const treff = g.koder.includes(valgtVarenr) || g.koder.includes(valgtEuro)
        || g.koder.some((k) => baseTreff(valgtEuro, k) || baseTreff(valgtVarenr, k))
        || g.gtKoder.some((k) => baseTreff(valgtEuro, k) || baseTreff(valgtVarenr, k));
      if (!treff) fordeling.wrong_pinpoint++;
      else if (g.gtKoder.length > 1) fordeling.pinpoint_aggressiv++;
      else fordeling.correct_pinpoint++;
    } else if (utfall === 'VERIFY') {
      if (overlapp > 0) fordeling.verify_med_fasit++;
      else fordeling.verify_uten_fasit++;
    } else fordeling.fallback++;

    detaljer.push({ ...g, klasse: utfall, valgtEuro, valgtVarenr, koderAntall: g.koder.length, gyldigeKoder: g.koder, grunn: r.data.grunn ?? null });
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${sett.length} …`);
    await sleep(DELAY_MS);
  }

  latencies.sort((x, y) => x - y);
  const p = (pct) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * pct / 100))] : null;
  const pinAll = fordeling.correct_pinpoint + fordeling.pinpoint_aggressiv + fordeling.wrong_pinpoint;
  const rapport = {
    dato: new Date().toISOString(),
    base: BASE,
    n: sett.length,
    seed: o.seed,
    fordeling,
    falsk_pinpoint_rate_hard: pinAll ? +(fordeling.wrong_pinpoint / pinAll).toFixed(4) : 0,
    aggressiv_rate_av_pinpoint: pinAll ? +((fordeling.pinpoint_aggressiv + fordeling.wrong_pinpoint) / pinAll).toFixed(4) : 0,
    fasit_dekning: +(((fordeling.correct_pinpoint + fordeling.verify_med_fasit) / sett.length)).toFixed(4),
    latency_ms: { p50: p(50), p95: p(95), p99: p(99), n: latencies.length },
    gate_g1_hard: fordeling.wrong_pinpoint === 0,
    gate_g1_inkl_aggressiv: fordeling.wrong_pinpoint === 0 && fordeling.pinpoint_aggressiv === 0,
    gate_g5: p(95) != null && p(95) < 1500,
  };
  writeFileSync(join(ROOT, 'data/test-500-gt-rapport.json'), JSON.stringify(rapport, null, 2));
  writeFileSync(join(ROOT, 'data/test-500-gt-detaljer.jsonl'), detaljer.map((d) => JSON.stringify(d)).join('\n') + '\n');
  console.log('\n=== TEST-500-GT (fasit, variant-bevisst) ===');
  console.log(JSON.stringify(rapport, null, 2));
  console.log('\nHARDE FALSKE PINPOINT:');
  detaljer.filter((d) => d.klasse === 'PINPOINT' && !(
    d.gyldigeKoder.includes(d.valgtVarenr) || d.gyldigeKoder.includes(d.valgtEuro)
    || d.gyldigeKoder.some((k) => baseTreff(d.valgtEuro, k) || baseTreff(d.valgtVarenr, k))))
    .slice(0, 12)
    .forEach((d) => console.log(`  ${d.make} ${d.model} ${d.year}: valgt=${d.valgtVarenr || d.valgtEuro} gyldige=${d.gyldigeKoder.join(',')}`));
  console.log('\nAGGRESSIVE PINPOINT (flere koder):');
  detaljer.filter((d) => d.klasse === 'PINPOINT' && d.koderAntall > 1).slice(0, 8)
    .forEach((d) => console.log(`  ${d.make} ${d.model} ${d.year}: valgt=${d.valgtVarenr || d.valgtEuro} koder=${d.koderAntall}`));
}

main().catch((e) => {
  console.error('FEIL:', e.message);
  if (e.stderr) console.error('STDERR:', String(e.stderr).slice(-1500));
  process.exit(1);
});
