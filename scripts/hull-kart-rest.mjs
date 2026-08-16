#!/usr/bin/env node
/**
 * Hull-kart fortsettelse: kjører RESTEN av svv-finn-broad med høy concurrency.
 * Leser allerede testede regnr fra hull-kart-resultater.ndjson (dedupe),
 * kjører resten med --concurrency parallellisme, appender, og skriver
 * endelig data/hull-kart-rapport.json (dedupe: siste rad per regnr vinner).
 *
 * Usage: node scripts/hull-kart-rest.mjs [--concurrency=6] [--delay=100]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

const DIR = '/Users/taj/finnbilglass/data';
const BASE = 'https://finnbilglass.no';
const INPUT = '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson';
const OUT = `${DIR}/hull-kart-resultater.ndjson`;
const TEST_UA = 'KompetanseKart-Test/1.0 (autoglass; intern kvalitetsmåling)';

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { concurrency: 6, delay: 100 };
  if (a.find((x) => x.startsWith('--concurrency='))) o.concurrency = parseInt(a.find((x) => x.startsWith('--concurrency=')).split('=')[1], 10);
  if (a.find((x) => x.startsWith('--delay='))) o.delay = parseInt(a.find((x) => x.startsWith('--delay=')).split('=')[1], 10);
  return o;
}

async function testRegnr(regnr) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/regnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': TEST_UA },
      body: JSON.stringify({ regnr }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { ok: false, status: res.status, ms: Date.now() - t0 };
    const d = await res.json();
    return {
      ok: true, ms: Date.now() - t0,
      svvTreff: !!(d.bil && d.bil.merke),
      bil: d.bil ?? null,
      resolver: d.resolver ?? null,
      utfall: d.resolver?.utfall ?? (d.bil ? 'BOM' : 'SVV_BOM'),
      varenr: d.resolver?.varenr ?? d.resolver?.kandidater?.[0]?.varenr ?? null,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

const arsGruppe = (a) => (!a ? 'ukjent' : a <= 2005 ? '≤2005' : a <= 2015 ? '2006-2015' : a <= 2020 ? '2016-2020' : '2021+');

async function main() {
  const o = parseArgs();
  const inn = readFileSync(INPUT, 'utf8').split('\n').filter((l) => l.trim());
  const testede = new Set();
  if (existsSync(OUT)) {
    for (const l of readFileSync(OUT, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r.regnr) testede.add(r.regnr); } catch {}
    }
  }
  const gjenstaende = inn.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.regnr && !testede.has(r.regnr));
  console.log(`⚡ Fortsettelse: ${inn.length} totalt, ${testede.size} testet, ${gjenstaende.length} gjenstår (concurrency ${o.concurrency})`);

  let i = 0, feil = 0;
  const worker = async () => {
    while (i < gjenstaende.length) {
      const idx = i++;
      const rec = gjenstaende[idx];
      const r = await testRegnr(rec.regnr);
      appendFileSync(OUT, JSON.stringify({ ...rec, test: r }) + '\n');
      if (!r.ok) feil++;
      if ((idx + 1) % 100 === 0) console.log(`   ${idx + 1}/${gjenstaende.length} (feil ${feil})`);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));

  // ── Endelig rapport (dedupe: siste rad per regnr vinner) ──
  const rader = new Map();
  for (const l of readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.regnr) rader.set(r.regnr, r); } catch {}
  }
  const agg = {
    total: 0, svvTreff: 0, svvBom: 0, apiFeil: 0,
    pinpoints: 0, verifys: 0, fallbacks: 0, matcherBom: 0,
    perMerke: {}, perModell: {}, perArs: {},
  };
  const bump = (obj, k) => {
    if (!obj[k]) obj[k] = { n: 0, pinpoint: 0, verify: 0, fallback: 0, bom: 0 };
    return obj[k];
  };
  for (const inRec of rader.values()) {
    const r = inRec.test;
    agg.total++;
    const merke = inRec.make || 'UKJENT';
    const modell = `${inRec.make || '?'} ${inRec.model || '?'}`;
    const ars = arsGruppe(inRec.year);
    const m = bump(agg.perMerke, merke);
    const mo = bump(agg.perModell, modell);
    const a = bump(agg.perArs, ars);
    m.n++; mo.n++; a.n++;
    if (!r.ok) { agg.apiFeil++; continue; }
    if (!r.svvTreff) { agg.svvBom++; m.bom++; mo.bom++; a.bom++; continue; }
    agg.svvTreff++;
    const u = r.utfall;
    if (u === 'PINPOINT') { agg.pinpoints++; m.pinpoint++; mo.pinpoint++; a.pinpoint++; }
    else if (u === 'VERIFY') { agg.verifys++; m.verify++; mo.verify++; a.verify++; }
    else if (u === 'FALLBACK') { agg.fallbacks++; m.fallback++; mo.fallback++; a.fallback++; }
    else { agg.matcherBom++; m.bom++; mo.bom++; a.bom++; }
  }
  const fmt = (obj) => Object.entries(obj).sort((x, y) => y[1].n - x[1].n)
    .map(([k, v]) => ({
      navn: k, n: v.n,
      pinpointPst: Math.round((v.pinpoint / v.n) * 100),
      verifyPst: Math.round((v.verify / v.n) * 100),
      fallbackPst: Math.round((v.fallback / v.n) * 100),
      bomPst: Math.round((v.bom / v.n) * 100),
      pinpoint: v.pinpoint, verify: v.verify, fallback: v.fallback, bom: v.bom,
    }));
  const rapport = {
    generert: new Date().toISOString(),
    antallTestet: agg.total,
    svvTreffPst: Math.round((agg.svvTreff / Math.max(agg.total, 1)) * 100),
    fordeling: {
      pinpoint: agg.pinpoints, pinpointPst: Math.round((agg.pinpoints / Math.max(agg.svvTreff, 1)) * 100),
      verify: agg.verifys, verifyPst: Math.round((agg.verifys / Math.max(agg.svvTreff, 1)) * 100),
      fallback: agg.fallbacks, fallbackPst: Math.round((agg.fallbacks / Math.max(agg.svvTreff, 1)) * 100),
      bom: agg.matcherBom, bomPst: Math.round((agg.matcherBom / Math.max(agg.svvTreff, 1)) * 100),
      svvBom: agg.svvBom, apiFeil: agg.apiFeil,
    },
    perMerke: fmt(agg.perMerke),
    perModell: fmt(agg.perModell).slice(0, 60),
    perArs: fmt(agg.perArs),
  };
  writeFileSync(`${DIR}/hull-kart-rapport.json`, JSON.stringify(rapport, null, 2));
  console.log('\n=== HULL-KART (ENDELIG) ===');
  console.log(JSON.stringify(rapport, null, 2));
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
