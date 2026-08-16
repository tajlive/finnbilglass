#!/usr/bin/env node
/**
 * test-500: utvider finn-100-kohorten med finn.no-annonser (bredde: 8 merker × 2 sider),
 * kjører resolver mot staging med respektfull delay, og måler:
 *   correct_pinpoint / wrong_pinpoint / verify / fallback / api_feil
 *   SVV-treffrate · latency p50/p95 (resolver-kall)
 * Skriver: data/test-500-resultater.jsonl + data/test-500-rapport.json
 *
 * Grenser: delay 1s/kall, 8 merker × 2 sider, ingen retry ved 4xx.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'data');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const DELAY_MS = Number(process.env.DELAY_MS ?? 1000);
mkdirSync(DIR, { recursive: true });

// ── Steg A: hent annonse-ID-er (kun offentlige lister, headless Chrome, lav rate) ──
function collectFinnIds() {
  const urls = [
    'https://www.finn.no/mobility/search/car?q=Volkswagen&page=1',
    'https://www.finn.no/mobility/search/car?q=Toyota&page=1',
    'https://www.finn.no/mobility/search/car?q=BMW&page=1',
    'https://www.finn.no/mobility/search/car?q=Mercedes&page=1',
    'https://www.finn.no/mobility/search/car?q=Volvo&page=1',
    'https://www.finn.no/mobility/search/car?q=Audi&page=1',
    'https://www.finn.no/mobility/search/car?q=Tesla&page=1',
    'https://www.finn.no/mobility/search/car?q=Hyundai&page=1',
    'https://www.finn.no/mobility/search/car?q=Volkswagen&page=2',
    'https://www.finn.no/mobility/search/car?q=Toyota&page=2',
    'https://www.finn.no/mobility/search/car?q=BMW&page=2',
    'https://www.finn.no/mobility/search/car?q=Mercedes&page=2',
    'https://www.finn.no/mobility/search/car?q=Volvo&page=2',
    'https://www.finn.no/mobility/search/car?q=Audi&page=2',
    'https://www.finn.no/mobility/search/car?q=Tesla&page=2',
    'https://www.finn.no/mobility/search/car?q=Hyundai&page=2',
  ];
  const ids = new Set();
  let i = 0;
  for (const u of urls) {
    i++;
    try {
      const html = execFileSync(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--virtual-time-budget=20000',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
        '--dump-dom', u,
      ], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, timeout: 90 * 1000 });
      const re = /images\.finncdn\.no\/dynamic\/default\/item\/(\d+)\//g;
      let m; let n = 0;
      while ((m = re.exec(html)) !== null) { ids.add(m[1]); n++; }
      const re2 = /\?open=(\d+)/g;
      while ((m = re2.exec(html)) !== null) ids.add(m[1]);
      console.log(`  [steg A ${i}/${urls.length}] ${u.split('?')[1] ?? u} → ${n} nye, totalt ${ids.size}`);
    } catch (e) {
      console.error(`  [steg A] chrome feilet (${u}): ${e.message.slice(0, 120)}`);
    }
  }
  return ids;
}

// ── Steg B: annonse-ID → kjennemerke (finnkode-sider, kun offentlige lister) ──
function finnkoderTilRegnr(finnkoder, already) {
  const regnrs = [];
  const seen = new Set(Object.values(already).map((a) => a.regnr));
  const koder = [...finnkoder].slice(0, 900);
  let i = 0;
  for (const kode of koder) {
    i++;
    if (regnrs.length >= 390) break;
    try {
      const html = execFileSync(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox',
        '--virtual-time-budget=8000',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
        '--dump-dom', `https://www.finn.no/mobility/item/ad.html?finnkode=${kode}`,
      ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 45 * 1000 });
      const m = html.match(/Kjennemerke[\s\S]{0,400}?([A-Z]{2}\s?\d{4,5})/i)
        ?? html.match(/\b([A-Z]{2}\s?\d{4,5})\b(?=[\s\S]{0,200}Kjennemerke)/i)
        ?? html.match(/Registrert[^<]{0,80}?([A-Z]{2}\s?\d{4,5})/i);
      if (m && !seen.has(m[1].replace(/\s/g, ''))) {
        seen.add(m[1].replace(/\s/g, ''));
        regnrs.push({ finnkode: kode, regnr: m[1].replace(/\s/g, '') });
      }
    } catch (e) {
      /* timeout/feil på enkeltannonse — fortsett */
    }
    if (i % 50 === 0) console.log(`  [steg B] ${i} annonser sjekket, ${regnrs.length} regnr funnet`);
  }
  return regnrs;
}

// ── Steg C: resolver-kjøring med latency-måling ──
function makePrefix(merke) {
  return (merke || '').toUpperCase().replace(/[^A-ZÆØÅ]/g, '').slice(0, 3);
}
async function sok(regnr) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr }),
  });
  const ms = Date.now() - t0;
  let data;
  try { data = await r.json(); } catch { data = { ok: false }; }
  return { ms, status: r.status, data };
}

async function main() {
  const already = {};
  const existingLines = readFileSync(join(ROOT, 'data/finn-100.jsonl'), 'utf8').split('\n').filter(Boolean);
  for (const l of existingLines) {
    try { const a = JSON.parse(l); if (a.regnr) already[a.regnr] = a; } catch {}
  }
  console.log(`Eksisterende kohort: ${Object.keys(already).length} regnr`);

  const ids = collectFinnIds();
  console.log(`finnkoder samlet: ${ids.size}`);
  const nye = finnkoderTilRegnr(ids, already);
  console.log(`nye regnr: ${nye.length}`);

  const alle = [...Object.values(already), ...nye];
  const fordeling = { correct_pinpoint: 0, wrong_pinpoint: 0, verify: 0, fallback: 0, api_feil: 0, svv_treff: 0 };
  const latencies = [];
  const resultater = [];

  for (const [i, a] of alle.entries()) {
    const regnr = a.regnr;
    let svar;
    try {
      const r = await sok(regnr);
      latencies.push(r.ms);
      svar = r.data;
      if (r.status !== 200) { fordeling.api_feil++; continue; }
    } catch (e) {
      fordeling.api_feil++;
      continue;
    }
    const bil = svar.bil;
    if (!bil) { fordeling.api_feil++; continue; }
    fordeling.svv_treff++;
    const utfall = svar.resolver?.utfall ?? svar.utfall ?? (svar.pinpoint === true ? 'PINPOINT' : svar.pinpoint === false ? 'VERIFY' : null) ?? (svar.kandidater ? 'VERIFY' : 'FALLBACK');
    if (utfall === 'PINPOINT') {
      const varenavn = svar.varenavn ?? '';
      const prefiks = makePrefix(bil.merke);
      if (varenavn.toUpperCase().replace(/[^A-ZÆØÅ]/g, '').slice(0, 3) === prefiks) fordeling.correct_pinpoint++;
      else fordeling.wrong_pinpoint++;
    } else if (utfall === 'VERIFY') fordeling.verify++;
    else fordeling.fallback++;
    resultater.push({ regnr, merke: bil.merke, modell: bil.modell, aar: bil.aar, utfall, latency_ms: r.ms, grunn: svar.meta?.grunn ?? svar.grunn ?? null });
    appendFileSync(join(DIR, 'test-500-resultater.jsonl'), JSON.stringify(resultater[resultater.length - 1]) + '\n');
    if ((i + 1) % 25 === 0) console.log(`  [steg C] ${i + 1}/${alle.length}`);
    await sleep(DELAY_MS);
  }

  latencies.sort((x, y) => x - y);
  const p = (pct) => latencies[Math.floor((latencies.length - 1) * pct / 100)] ?? null;
  const rapport = {
    dato: new Date().toISOString(),
    base: BASE,
    totalt: alle.length,
    svv_treff: fordeling.svv_treff,
    svv_treffrate: alle.length ? +(fordeling.svv_treff / alle.length).toFixed(3) : 0,
    fordeling,
    falsk_pinpoint_rate: fordeling.correct_pinpoint + fordeling.wrong_pinpoint
      ? +(fordeling.wrong_pinpoint / (fordeling.correct_pinpoint + fordeling.wrong_pinpoint)).toFixed(3) : 0,
    latency_ms: { p50: p(50), p95: p(95), p99: p(99), n: latencies.length },
  };
  writeFileSync(join(DIR, 'test-500-rapport.json'), JSON.stringify(rapport, null, 2));
  console.log('\n=== TEST-500 RAPPORT ===');
  console.log(JSON.stringify(rapport, null, 2));
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
