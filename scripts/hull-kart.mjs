#!/usr/bin/env node
/**
 * Hull-kart 2 394: Kjør alle SVV-verifiserte finn.no-biler gjennom
 * finnbilglass.no sin fulle produksjonskjede (/api/regnr = SVV + VIN-resolver).
 *
 * Måler per merke/modell/årgang: PINPOINT / VERIFY / FALLBACK / bom.
 * Dette er fasiten på hvor kompetansen er svak — og prioriteringslisten
 * for målrettet scraping.
 *
 * Usage: node scripts/hull-kart.mjs [--input=PATH] [--delay=MS]
 * Output: data/hull-kart-resultater.ndjson + data/hull-kart-rapport.json
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = '/Users/taj/finnbilglass/data';
const BASE = 'https://finnbilglass.no';
const DEFAULT_INPUT = '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson';
const TEST_UA = 'KompetanseKart-Test/1.0 (autoglass; intern kvalitetsmåling)';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: DEFAULT_INPUT, delay: 350 };
  for (const a of args) {
    if (a.startsWith('--input=')) opts.input = a.split('=')[1];
    if (a.startsWith('--delay=')) opts.delay = parseInt(a.split('=')[1], 10);
  }
  return opts;
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
      ok: true,
      ms: Date.now() - t0,
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

function arsGruppe(aar) {
  if (!aar) return 'ukjent';
  if (aar <= 2005) return '≤2005';
  if (aar <= 2015) return '2006-2015';
  if (aar <= 2020) return '2016-2020';
  return '2021+';
}

async function main() {
  const opts = parseArgs();
  if (!existsSync(opts.input)) {
    console.error(`❌ Fant ikke input: ${opts.input}`);
    process.exit(1);
  }
  const lines = readFileSync(opts.input, 'utf8').split('\n').filter((l) => l.trim());
  console.log(`🔍 Hull-kart: ${lines.length} biler → ${BASE}/api/regnr (delay ${opts.delay}ms)`);

  const outFile = `${DIR}/hull-kart-resultater.ndjson`;
  const agg = {
    total: 0, svvTreff: 0, svvBom: 0, apiFeil: 0,
    pinpoints: 0, verifys: 0, fallbacks: 0, matcherBom: 0,
    perMerke: {}, perModell: {}, perArs: {},
  };
  const bump = (o, k) => {
    if (!o[k]) o[k] = { n: 0, pinpoint: 0, verify: 0, fallback: 0, bom: 0 };
    return o[k];
  };

  const start = Date.now();
  for (let i = 0; i < lines.length; i++) {
    let inRec;
    try { inRec = JSON.parse(lines[i]); } catch { continue; }
    if (!inRec.regnr) continue;

    const r = await testRegnr(inRec.regnr);
    appendFileSync(outFile, JSON.stringify({ ...inRec, test: r }) + '\n');
    agg.total++;

    const merke = inRec.make || 'UKJENT';
    const modell = `${inRec.make || '?'} ${inRec.model || '?'}`;
    const ars = arsGruppe(inRec.year);
    const m = bump(agg.perMerke, merke);
    const mo = bump(agg.perModell, modell);
    const a = bump(agg.perArs, ars);
    m.n++; mo.n++; a.n++;

    if (!r.ok) {
      agg.apiFeil++;
      continue;
    }
    if (!r.svvTreff) { agg.svvBom++; m.bom++; mo.bom++; a.bom++; continue; }
    agg.svvTreff++;
    const u = r.utfall;
    if (u === 'PINPOINT') { agg.pinpoints++; m.pinpoint++; mo.pinpoint++; a.pinpoint++; }
    else if (u === 'VERIFY') { agg.verifys++; m.verify++; mo.verify++; a.verify++; }
    else if (u === 'FALLBACK') { agg.fallbacks++; m.fallback++; mo.fallback++; a.fallback++; }
    else { agg.matcherBom++; m.bom++; mo.bom++; a.bom++; }

    if ((i + 1) % 100 === 0) {
      const el = ((Date.now() - start) / 60000).toFixed(1);
      console.log(`  [${i + 1}/${lines.length}] P:${agg.pinpoints} V:${agg.verifys} F:${agg.fallbacks} BOM:${agg.matcherBom} (${el}min)`);
    }
    await sleep(opts.delay);
  }

  const fmt = (o) => Object.entries(o)
    .sort((x, y) => y[1].n - x[1].n)
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
    input: opts.input,
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
  console.log('\n=== HULL-KART ===');
  console.log(JSON.stringify(rapport, null, 2));
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
