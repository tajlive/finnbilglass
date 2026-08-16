#!/usr/bin/env node
/**
 * Målrettet finn.no-scraper per MODELL (ikke bare merke).
 * Bruker dagens finn.no-struktur: søkeside → /mobility/item/<id>-lenker (ikke <article>).
 *
 * Usage:
 *   node scripts/scrape-finn-modeller.mjs
 *     --modeller=bmw-i3,bmw-i4,nissan-leaf
 *     --per-modell=50 --sider=2 --delay=400 [--resume]
 *
 * Output per modell: data/finn-modeller/{modell}-annonser.ndjson
 * Samlet: data/finn-modeller/samlet.ndjson
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT_DIR = '/Users/taj/finnbilglass/data/finn-modeller';
const UA = 'AutoglassAS-B2B-Scraper/1.0 (+https://auto-glass.no; contact@auto-glass.no)';

function parseArgs() {
  const args = process.argv.slice(2);
  const o = { modeller: [], perModell: 50, sider: 2, delay: 400, resume: false };
  for (const a of args) {
    if (a.startsWith('--modeller=')) o.modeller = a.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (a.startsWith('--per-modell=')) o.perModell = parseInt(a.split('=')[1], 10);
    if (a.startsWith('--sider=')) o.sider = parseInt(a.split('=')[1], 10);
    if (a.startsWith('--delay=')) o.delay = parseInt(a.split('=')[1], 10);
    if (a === '--resume') o.resume = true;
  }
  return o;
}

async function fetchHtml(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'nb-NO,nb;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) { console.log('   ⚠️ 429 — venter 60s'); await sleep(60000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === 2) throw e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error('uendelig');
}

/** Søkeside → unike finnkoder via /mobility/item/<id>-lenker. */
function parseSearchPage(html) {
  const ids = new Set();
  const re = /\/mobility\/item\/(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids];
}

/** Annonseside → regnr (mest frekvente platetreff) + tittel. */
function parseAdPage(html) {
  const matches = html.match(/\b[A-Z]{2}\d{3,5}\b/g) ?? [];
  const counts = new Map();
  for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best = null, bestCount = 0;
  for (const [reg, c] of counts) if (c > bestCount) { best = reg; bestCount = c; }
  const t = html.match(/<title>([^<]*)</);
  return { regnr: best, tittel: t?.[1]?.trim() ?? '' };
}

const safe = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

async function scrapeModell(modell, opts) {
  const file = `${OUT_DIR}/${safe(modell)}-annonser.ndjson`;
  const seen = new Set();
  if (opts.resume && existsSync(file)) {
    for (const l of readFileSync(file, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r.finnkode) seen.add(r.finnkode); } catch {}
    }
    console.log(`   📂 resume: ${seen.size} finnkoder allerede`);
  }
  const ut = [];
  let stoppet = false;
  for (let side = 1; side <= opts.sider && !stoppet; side++) {
    const url = `https://www.finn.no/mobility/search/car?q=${encodeURIComponent(modell)}&page=${side}`;
    process.stdout.write(`   [side ${side}] ${url.length > 90 ? url.slice(0, 90) + '…' : url} … `);
    let html;
    try { html = await fetchHtml(url); } catch (e) { console.log(`FEIL: ${e.message}`); break; }
    const ids = parseSearchPage(html);
    console.log(`${ids.length} annonser`);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (ut.length >= opts.perModell) { stoppet = true; break; }
      try {
        const adHtml = await fetchHtml(`https://www.finn.no/mobility/item/${id}`);
        const p = parseAdPage(adHtml);
        if (p.regnr) {
          ut.push({ finnkode: id, regnr: p.regnr, modellSok: modell, tittel: p.tittel, scrapetAt: new Date().toISOString() });
        }
      } catch { /* hopp */ }
      await sleep(opts.delay);
    }
    await sleep(opts.delay);
    console.log(`   → ${ut.length}/${opts.perModell} med regnr (${safe(modell)})`);
    if (ut.length >= opts.perModell) break;
  }
  appendFileSync(file, ut.map((r) => JSON.stringify(r)).join('\n') + (ut.length ? '\n' : ''));
  return ut.length;
}

async function main() {
  const opts = parseArgs();
  if (!opts.modeller.length) {
    console.error('Bruk: --modeller=bmw-i3,nissan-leaf …');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`🚗 Målrettet scraper: ${opts.modeller.length} modeller, ${opts.perModell} annonser per modell, ${opts.sider} sider, delay ${opts.delay}ms\n`);
  let totalt = 0;
  for (const modell of opts.modeller) {
    console.log(`▶ ${modell}`);
    try { totalt += await scrapeModell(modell, opts); } catch (e) { console.error(`   ❌ ${modell}: ${e.message}`); }
  }
  console.log(`\n✅ Ferdig — ${totalt} nye annonser med regnr i ${OUT_DIR}/`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
