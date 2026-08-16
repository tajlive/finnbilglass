#!/usr/bin/env node
/**
 * scrape-frontrute-kataloger.mjs
 *
 * Scraper for eurocode-frontrute-kataloger (fritt tilgjengelige kilder).
 * Prioritet 1: frontruter med egenskaper + kalibreringsflagg per eurokode.
 *
 * Kilder:
 *  A) Guardian Automotive (Glavista) — sitemap → 4 621 windscreen-produktsider
 *     guardianautomotiveglass.com/en/windscreen/<eurokode>-<modell>
 *     Data: eurokode (mpn), Glavista-nr (gtin13), OE-numre, tinting, properties,
 *           product group, cert (43R/43R-DOT), calibration required, tilbehør, varianter.
 *  B) Pilkington IE — windscreens/c-2.html?page=1..404 → produktsider id-N.html
 *     Data: data-product-code = eurokode, tittel m/ egenskaps-beskrivelse.
 *
 * Output: data/scrape/<kilde>/<eurokode>.json (én fil per kode) + progress-state.
 * Resumable: ferdige koder hoppes over ved re-kjøring.
 *
 * Bruk:
 *   node scripts/scrape-frontrute-kataloger.mjs --source glavista [--limit 10] [--delay 1.5]
 *   node scripts/scrape-frontrute-kataloger.mjs --source pilkington-ie [--limit 10] [--delay 5]
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'data', 'scrape');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------- CLI ----------
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const SOURCE = arg('source', 'glavista');
const LIMIT = parseInt(arg('limit', '0'), 10); // 0 = alle
const DELAY = parseFloat(arg('delay', SOURCE === 'pilkington-ie' ? '5' : '1.5'));

// ---------- Hjelpere ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}
function normEurocode(code) {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
const stripTags = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function saveJson(kilde, kode, data) {
  const dir = path.join(OUT_DIR, kilde);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${kode}.json`), JSON.stringify(data, null, 2));
}
async function exists(kilde, kode) {
  try { await access(path.join(OUT_DIR, kilde, `${kode}.json`)); return true; } catch { return false; }
}

// ---------- Kilde A: Guardian/Glavista ----------
const GLAVISTA_SITEMAP = 'https://www.glavista.com/sitemap-guardian-en-products.xml';

async function glavista() {
  console.log('[glavista] Henter sitemap…');
  const xml = await get(GLAVISTA_SITEMAP);
  // Sitemap peker til guardianautomotiveglass.com, men der er sertifikatet utgått (CERT_HAS_EXPIRED).
  // Samme katalog lever på www.glavista.com — bytt domene.
  const urls = [...xml.matchAll(/<loc>(https:\/\/www\.guardianautomotiveglass\.com\/en\/windscreen\/[^<]+)<\/loc>/g)]
    .map((m) => m[1].replace('https://www.guardianautomotiveglass.com', 'https://www.glavista.com'));
  console.log(`[glavista] ${urls.length} windscreen-URLer i sitemap`);
  if (LIMIT > 0) urls.length = Math.min(urls.length, LIMIT);

  let ok = 0, skip = 0, err = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    // eurokode fra slug: .../windscreen/<kode>-<modell>
    const slug = url.split('/').pop();
    const kode = normEurocode(slug.split('-')[0]);
    if (!kode) { err++; continue; }
    if (await exists('glavista', kode)) { skip++; continue; }

    try {
      const html = await get(url);
      const data = parseGlavista(html, url, kode);
      await saveJson('glavista', kode, data);
      ok++;
      if (ok % 25 === 0) console.log(`[glavista] ${ok} nye (skip ${skip}, feil ${err}) — siste: ${kode}`);
    } catch (e) {
      err++;
      console.error(`[glavista] FEIL ${url}: ${e.message}`);
    }
    await sleep(DELAY * 1000);
  }
  console.log(`[glavista] Ferdig: ${ok} nye, ${skip} eksisterende, ${err} feil.`);
}

function parseGlavista(html, url, kodeFraUrl) {
  const meta = (prop) => {
    const m = html.match(new RegExp(`itemprop="${prop}" content="([^"]*)"`));
    return m ? m[1].trim() : '';
  };
  const mpn = normEurocode(meta('mpn')) || kodeFraUrl;
  const gtin = meta('gtin13');
  const brand = meta('brand');
  const desc = meta('description'); // "Eurocode: XOE Number: a, bGlavista Number: Y"

  // Navn fra h1 (produktsiden har ikke itemprop=name på samme måte som kort)
  const h1M = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  const navn = h1M ? stripTags(h1M[1]) : '';

  // OE-numre fra description
  let oe = [];
  const oeM = desc.match(/OE Number: ([^G]*?)Glavista Number:/);
  if (oeM) oe = oeM[1].split(',').map((s) => s.trim()).filter(Boolean);

  // Tinting / Properties / Product group (produktkort-felter kan mangle på produktsiden → fallback til variant-seksjon)
  const liTxt = [...html.matchAll(/card-detail__list-description">([^<]*)<\/span><span class="card-detail__list-value">([^<]*)</g)]
    .map((m) => [stripTags(m[1]).replace(':', '').trim(), stripTags(m[2]).trim()]);
  const felt = Object.fromEntries(liTxt);

  // product-features-blokker (produktside): Glavista Number, New Product, Calibration required, Suggested retail price, …
  const features = {};
  for (const m of html.matchAll(/product-features__description">([^<]*)<\/span><span class="product-features__value">([^<]*)<\/span>/g)) {
    features[stripTags(m[1]).replace(':', '').trim()] = stripTags(m[2]).trim();
  }

  // Certifikater
  const cert = [];
  if (html.includes('certificado-43R.png')) cert.push('43R');
  if (html.includes('certificado-43R-DOT.png')) cert.push('43R-DOT');

  // Alle eurokoder nevnt på siden (hoved + varianter/similar)
  const koder = new Set([normEurocode(mpn)]);
  for (const m of html.matchAll(/itemprop="mpn" content="([^"]+)"/g)) koder.add(normEurocode(m[1]));
  for (const m of html.matchAll(/card-product__ref">\s*([A-Z0-9]+)/g)) koder.add(normEurocode(m[1]));

  // Monterings-tilbehør
  const tilbehor = html.includes('MOUNTING ACCESSORIES:') ? 'ja' : '';

  return {
    kilde: 'glavista',
    eurokode: normEurocode(mpn),
    url,
    merke: brand,
    modell: navn,
    glavistaNr: gtin || features['Glavista Number'] || '',
    oeNummer: oe,
    tinting: felt.Tinting || '',
    properties: felt.Properties || '',
    produktgruppe: felt['Product group'] || '',
    calibration: features['Calibration required'] || '',
    nyhet: features['New Product'] || '',
    veiledendePris: features['Suggested retail price'] || '',
    cert,
    alleKoder: [...koder],
    monteringTilbehor: tilbehor,
    hentet: new Date().toISOString(),
  };
}

// ---------- Kilde B: Pilkington IE ----------
const PILK_CAT = 'https://www.pilkingtonautomotiveglass.ie/windscreens/c-2.html';
const PILK_TOTAL_SIDER = 404; // verifisert 2026-08-16 (side 404 = 7 produkter, 405 = 0)

async function pilkingtonIe() {
  console.log('[pilkington-ie] Samler produktside-URLer (404 kategorisider)…');
  const urls = new Set();
  let maxSide = PILK_TOTAL_SIDER;
  if (LIMIT > 0) maxSide = Math.min(maxSide, Math.ceil(LIMIT / 12));
  for (let p = 1; p <= maxSide; p++) {
    const cat = await get(`${PILK_CAT}?page=${p}`);
    for (const m of cat.matchAll(/products\/(id-\d+\.html)/g)) {
      urls.add(`https://www.pilkingtonautomotiveglass.ie/products/${m[1]}`);
    }
    if (p % 50 === 0) console.log(`[pilkington-ie] kategori-side ${p}: ${urls.size} produkter samlet`);
    await sleep(DELAY * 1000);
  }
  const liste = [...urls];
  console.log(`[pilkington-ie] ${liste.length} produktsider samlet`);
  if (LIMIT > 0) liste.length = Math.min(liste.length, LIMIT);

  let ok = 0, skip = 0, err = 0;
  for (let i = 0; i < liste.length; i++) {
    const url = liste[i];
    const id = url.split('/').pop().replace('.html', '');
    if (await exists('pilkington-ie', id)) { skip++; continue; }
    try {
      const html = await get(url);
      const data = parsePilkingtonIe(html, url);
      if (!data.eurokode) { err++; console.error(`[pilkington-ie] ingen eurokode i ${url}`); continue; }
      await saveJson('pilkington-ie', id, data);
      ok++;
      if (ok % 25 === 0) console.log(`[pilkington-ie] ${ok} nye (skip ${skip}, feil ${err}) — siste: ${data.eurokode}`);
    } catch (e) {
      err++;
      console.error(`[pilkington-ie] FEIL ${url}: ${e.message}`);
    }
    await sleep(DELAY * 1000);
  }
  console.log(`[pilkington-ie] Ferdig: ${ok} nye, ${skip} eksisterende, ${err} feil.`);
}

function parsePilkingtonIe(html, url) {
  const codeM = html.match(/data-product-code="([^"]+)"/);
  const eurokode = normEurocode(codeM ? codeM[1] : '');
  const titleM = html.match(/<title>([^<]*)<\/title>/);
  const tittel = titleM ? titleM[1].replace(/ - Pilkington Automotive Glass$/, '').trim() : '';
  const catM = html.match(/<title>([^<]*)<\/title>/);
  const erFrontrute = html.includes('windscreens/c-2.html') || /;?\s*WS\b/i.test(tittel);
  return {
    kilde: 'pilkington-ie',
    eurokode,
    url,
    id: url.split('/').pop().replace('.html', ''),
    tittel,
    frontrute: erFrontrute,
    hentet: new Date().toISOString(),
  };
}

// ---------- Main ----------
await mkdir(OUT_DIR, { recursive: true });
console.log(`Scrape-kjøring: kilde=${SOURCE}, limit=${LIMIT || 'alle'}, delay=${DELAY}s`);
console.log(`Output: ${OUT_DIR}`);
if (SOURCE === 'glavista') await glavista();
else if (SOURCE === 'pilkington-ie') await pilkingtonIe();
else console.error(`Ukjent kilde: ${SOURCE} (glavista | pilkington-ie)`);
