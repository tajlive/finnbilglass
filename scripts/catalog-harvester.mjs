#!/usr/bin/env node
/**
 * FinnBilGlass / B2B catalog harvester.
 *
 * This is a bounded, provenance-first research/import tool. It deliberately
 * does not bypass CAPTCHAs, Cloudflare, authentication, robots restrictions,
 * rate limits, or paywalls. External media is metadata-only by default.
 *
 * Outputs:
 *   records.jsonl  canonical glass records
 *   errors.jsonl   retryable and permanent failures
 *   state.json     resumable URL/checkpoint state
 *
 * Examples:
 *   node scripts/catalog-harvester.mjs \
 *     --source buycarparts \
 *     --seed https://www.buycarparts.co.uk/windscreen \
 *     --out /tmp/fbg-harvest --max-pages 25
 *
 *   node scripts/catalog-harvester.mjs \
 *     --source b2b-sql \
 *     --input /Users/taj/bilglass/api/cf-worker/generated-inserts.sql \
 *     --out /tmp/fbg-harvest-b2b
 *
 * For media downloads, a written license/permission is required:
 *   --download-media --media-licensed --media-host cdn.pkwteile.de
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const DEFAULT_USER_AGENT = 'FinnBilGlassCatalogResearch/1.0 (+https://finnbilglass.no; contact via site)';
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const EUROCODE_RE = /\b(?=[A-Z0-9]{6,17}\b)(?=(?:[A-Z0-9]*[A-Z]){2})[A-Z0-9]+\b/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const PRODUCT_PATH_RE = /\/(?:glavista|saint-gobain|pilkington|repiauto|diederichs|nordglass|xyg)\//i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i;
const FEATURE_RULES = [
  ['camera', /camera mount|camera|adas|lane keeping|lane assist|front assist/i],
  ['rain_sensor', /rain sensor|rain\/light sensor|light sensor|humidity sensor/i],
  ['heated', /heatable|heated|heating|heatable glass/i],
  ['acoustic', /acoustic|noise reduction/i],
  ['antenna', /antenna|integrated radio/i],
  ['hud', /\bhud\b|head.?up display/i],
  ['solar', /solar control|coated|climate comfort/i],
  ['mirror_bracket', /mirror holder|mirror bracket/i],
  ['vin_window', /sight window.*vin|vin.*sight window/i],
  ['panoramic', /panorama|panoramic/i],
];

function usage() {
  console.log(`Usage:
  node scripts/catalog-harvester.mjs --source buycarparts --seed URL [options]
  node scripts/catalog-harvester.mjs --source b2b-sql --input FILE [options]

Options:
  --out DIR                 Output directory (default: /tmp/fbg-catalog-harvest)
  --max-pages N             Hard page limit (default: 50)
  --max-depth N             Link depth limit (default: 2)
  --delay-ms N              Minimum delay between requests (default: 2500)
  --timeout-ms N            Request timeout (default: 20000)
  --max-bytes N             Maximum HTML/media response size
  --media-host HOST         Allowlisted media host (repeatable)
  --download-media          Download media only with --media-licensed
  --media-licensed          Explicit permission flag for media download
  --resume                  Resume from state.json (default)
  --fresh                   Ignore existing state.json
  --allow-robots-unavailable Continue only when robots.txt cannot be read
  --user-agent TEXT         Custom, honest User-Agent
  --help                    Show this help
`);
}

function argsOf(argv) {
  const out = { mediaHosts: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') { usage(); process.exit(0); }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replaceAll('-', '_');
    if (key === 'download_media' || key === 'media_licensed' || key === 'resume' || key === 'fresh' || key === 'allow_robots_unavailable') {
      out[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${a}`);
    if (key === 'media_host') out.mediaHosts.push(value);
    else out[key] = value;
  }
  out.max_pages = Number(out.max_pages ?? 50);
  out.max_depth = Number(out.max_depth ?? 2);
  out.delay_ms = Number(out.delay_ms ?? 2500);
  out.timeout_ms = Number(out.timeout_ms ?? 20000);
  out.max_bytes = Number(out.max_bytes ?? DEFAULT_MAX_BYTES);
  out.out = resolve(out.out ?? '/tmp/fbg-catalog-harvest');
  return out;
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
function canonicalUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    return u.toString();
  } catch { return null; }
}
function hostOf(raw) { try { return new URL(raw).hostname.toLowerCase(); } catch { return ''; } }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function iso() { return new Date().toISOString(); }
function boolFeature(text, key) {
  const rule = FEATURE_RULES.find(([name]) => name === key);
  return rule ? rule[1].test(text) : null;
}

async function atomicJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}
async function appendJsonl(path, value) {
  await writeFile(path, JSON.stringify(value) + '\n', { flag: 'a' });
}
function sleep(ms) { return new Promise(resolveSleep => setTimeout(resolveSleep, ms)); }

function parseJsonLd(html) {
  const values = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* malformed JSON-LD is non-fatal */ }
  }
  return values;
}
function stripHtml(html) {
  return clean(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;|&#47;/gi, '/'));
}
function attrValues(html, tag, attr) {
  const values = [];
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'gi');
  for (const m of html.matchAll(re)) values.push(clean(m[1]));
  return values;
}
function productLd(jsonLd) {
  return jsonLd.find(x => String(x?.['@type'] ?? '').toLowerCase() === 'product') ?? {};
}
function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return clean(m[1]);
  }
  return null;
}
function parseProductPage(url, html, fetchedAt) {
  const text = stripHtml(html);
  const ld = productLd(parseJsonLd(html));
  const title = firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i, /<title[^>]*>([\s\S]*?)<\/title>/i]) ?? clean(ld.name);
  const eurocodes = [...new Set((text.match(EUROCODE_RE) ?? []).map(x => x.toUpperCase()))];
  const articleNumber = firstMatch(text, [/(?:Article|Item|Number|Order)[^A-Z0-9]{0,20}:?\s*([A-Z0-9][A-Z0-9\s/_-]{2,40})/i]) ?? (clean(ld.sku) || null);
  const oemNumbers = [...new Set((text.match(/(?:OE|OEM)\s*(?:number|numbers)?[\s:]*([A-Z0-9][A-Z0-9 ._-]{4,30})/ig) ?? [])
    .map(x => x.replace(/^.*?([A-Z0-9][A-Z0-9 ._-]{4,30})$/i, '$1').trim())
    .filter(x => /\d/.test(x)))];
  const images = [...new Set([
    ...(Array.isArray(ld.image) ? ld.image : [ld.image]).filter(Boolean),
    ...attrValues(html, 'img', 'src'),
    ...attrValues(html, 'img', 'data-src'),
    ...[...html.matchAll(/https?:\/\/[^"'\s<>]+/gi)].map(m => m[0]),
  ].map(x => canonicalUrl(x, url)).filter(x => x && IMAGE_EXT_RE.test(x)))];
  const features = Object.fromEntries(FEATURE_RULES.map(([key]) => [key, boolFeature(text, key)]));
  const fitment = {
    makes: [...new Set((text.match(/\b(?:VW|VOLKSWAGEN|AUDI|BMW|MERCEDES(?:-BENZ)?|FORD|TOYOTA|VOLVO|PEUGEOT|CITROEN|SKODA|SEAT|KIA|HYUNDAI|NISSAN|TESLA|OPEL)\b/gi) ?? []).map(x => x.toUpperCase()))],
    years: [...new Set((text.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number))],
  };
  return {
    schema_version: 1,
    record_id: sha256(`${url}|${articleNumber}|${eurocodes.join(',')}`).slice(0, 24),
    source: 'buycarparts-research',
    source_url: url,
    fetched_at: fetchedAt,
    title,
    article_number: articleNumber,
    eurocodes,
    oem_numbers: oemNumbers,
    fitment,
    features,
    media: images.slice(0, 20).map(src => ({ src, licensed: false, downloaded: false, role: 'unknown' })),
    raw_fingerprint: sha256(text),
    warnings: [
      ...(eurocodes.length === 0 ? ['no_explicit_eurocode'] : []),
      ...(images.length === 0 ? ['no_product_image'] : []),
      ...(oemNumbers.length === 0 ? ['no_oem_number'] : []),
    ],
  };
}

function parseSqlTuples(sql) {
  const header = sql.match(/INSERT INTO[^\(]*\(([^)]+)\)\s+VALUES/i);
  const cols = header ? header[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')) : [];
  const rows = [];
  for (const line of sql.split('\n')) {
    if (!line.trim().startsWith('(')) continue;
    let i = line.indexOf('(') + 1, current = '', quote = false, values = [];
    for (; i < line.length; i++) {
      const ch = line[i];
      if (quote && ch === "'" && line[i + 1] === "'") { current += "'"; i++; continue; }
      if (ch === "'") { quote = !quote; current += ch; continue; }
      if (!quote && ch === ',') { values.push(current.trim()); current = ''; continue; }
      if (!quote && ch === ')') { values.push(current.trim()); break; }
      current += ch;
    }
    if (values.length) rows.push(values);
  }
  return { cols, rows };
}
function sqlValue(raw) {
  if (raw == null || raw === 'NULL') return null;
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw;
}
async function harvestB2bSql(opts) {
  const sql = await readFile(resolve(opts.input), 'utf8');
  const { cols, rows } = parseSqlTuples(sql);
  const at = name => cols.indexOf(name);
  const records = [];
  for (const row of rows) {
    const get = name => sqlValue(row[at(name)]);
    const eurocode = String(get('eurocode') ?? '').toUpperCase();
    if (!eurocode) continue;
    const oemRaw = get('oem_numbers');
    let oem = [];
    try { oem = oemRaw ? JSON.parse(oemRaw) : []; } catch { oem = []; }
    const features = Object.fromEntries(['adas','rain_sensor','heated','acoustic','antenna','hud','shade','camera','lane_assist'].map(k => [k, get(k) == null ? null : Number(get(k)) === 1]));
    const record = {
      schema_version: 1,
      record_id: sha256(`b2b|${eurocode}|${get('brand')}|${get('model')}|${get('source')}`).slice(0, 24),
      source: get('source') ?? 'b2b-sql',
      source_url: null,
      fetched_at: iso(),
      title: get('description'),
      article_number: get('article_number'),
      eurocodes: [eurocode],
      oem_numbers: Array.isArray(oem) ? oem.map(String) : [],
      fitment: { brand: get('brand'), model: get('model'), year_from: get('year_from'), year_to: get('year_to'), ktype: get('ktype') },
      features,
      media: [],
      raw_fingerprint: sha256(row.join('|')),
      warnings: [],
    };
    records.push(record);
  }
  return records;
}

class HttpClient {
  constructor(opts) { this.opts = opts; this.lastAt = 0; }
  async get(url, kind = 'html') {
    const wait = this.opts.delay_ms - (Date.now() - this.lastAt);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeout_ms);
    try {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': this.opts.user_agent, accept: kind === 'html' ? 'text/html,application/xhtml+xml' : 'image/*' } });
      if (response.status >= 300 && response.status < 400) throw new Error(`redirect_blocked:${response.status}`);
      if (!response.ok) throw new Error(`http_${response.status}`);
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > this.opts.max_bytes) throw new Error(`response_too_large:${length}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.opts.max_bytes) throw new Error(`response_too_large:${bytes.byteLength}`);
      return { response, bytes };
    } finally { clearTimeout(timer); }
  }
}

async function checkRobots(seed, opts, client) {
  const robotsUrl = new URL('/robots.txt', seed).toString();
  try {
    const { bytes } = await client.get(robotsUrl);
    const body = new TextDecoder().decode(bytes);
    const lines = body.split(/\r?\n/).map(x => x.trim());
    let applies = false, denied = false;
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) applies = true;
      if (applies && /^disallow:\s*\/$/i.test(line)) denied = true;
    }
    if (denied) throw new Error(`robots_denies_root:${robotsUrl}`);
    return { url: robotsUrl, status: 'allowed_or_unrestricted', sha256: sha256(body) };
  } catch (error) {
    if (!opts.allow_robots_unavailable) throw new Error(`robots_unavailable:${robotsUrl}:${error.message}`);
    return { url: robotsUrl, status: 'unavailable_override', error: error.message };
  }
}

async function harvestBuycarparts(opts) {
  if (!opts.seed) throw new Error('--seed is required for --source buycarparts');
  const seed = canonicalUrl(opts.seed);
  if (!seed) throw new Error('Invalid --seed URL');
  const seedHost = hostOf(seed);
  const client = new HttpClient(opts);
  const robots = await checkRobots(seed, opts, client);
  const queue = [{ url: seed, depth: 0 }];
  const seen = new Set();
  const records = [];
  const errors = [];
  while (queue.length && seen.size < opts.max_pages) {
    const item = queue.shift();
    if (seen.has(item.url)) continue;
    if (hostOf(item.url) !== seedHost || item.depth > opts.max_depth) continue;
    seen.add(item.url);
    try {
      const { bytes, response } = await client.get(item.url);
      const html = new TextDecoder(response.headers.get('content-type')?.includes('charset=iso') ? 'iso-8859-1' : 'utf-8').decode(bytes);
      const isProduct = PRODUCT_PATH_RE.test(new URL(item.url).pathname);
      if (isProduct) records.push(parseProductPage(item.url, html, iso()));
      const links = [...html.matchAll(/<(?:a|link)\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
        .map(m => canonicalUrl(m[1], item.url)).filter(Boolean)
        .filter(u => hostOf(u) === seedHost)
        .filter(u => /windscreen|windshield|glavista|saint-gobain|pilkington|repiauto|diederichs/i.test(u));
      for (const url of [...new Set(links)]) if (!seen.has(url) && queue.length + seen.size < opts.max_pages * 4) queue.push({ url, depth: item.depth + 1 });
    } catch (error) {
      errors.push({ url: item.url, error: error.message, at: iso() });
    }
    if (seen.size % 10 === 0) console.error(`  besøkt ${seen.size}/${opts.max_pages}, funnet ${records.length} produktposter`);
  }
  return { records, errors, meta: { robots, pages_visited: seen.size, seed, host: seedHost } };
}

async function downloadMedia(records, opts, out) {
  if (!opts.download_media) return { downloaded: 0, skipped: 0 };
  if (!opts.media_licensed) throw new Error('--download-media requires --media-licensed');
  await mkdir(join(out, 'media'), { recursive: true });
  const client = new HttpClient(opts);
  let downloaded = 0, skipped = 0;
  for (const record of records) for (const media of record.media ?? []) {
    const host = hostOf(media.src);
    if (!opts.mediaHosts.includes(host)) { skipped++; continue; }
    try {
      const { bytes, response } = await client.get(media.src, 'image');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const type = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const path = join(out, 'media', `${digest}.${ext}`);
      await writeFile(path, bytes);
      media.local_path = path;
      media.sha256 = digest;
      media.content_type = type;
      media.licensed = true;
      media.downloaded = true;
      downloaded++;
    } catch (error) { media.error = error.message; skipped++; }
  }
  return { downloaded, skipped };
}

async function main() {
  const opts = argsOf(process.argv.slice(2));
  if (!opts.source) throw new Error('--source is required');
  if (opts.download_media && !opts.media_licensed) throw new Error('Refusing media download without --media-licensed');
  await mkdir(opts.out, { recursive: true });
  const paths = { state: join(opts.out, 'state.json'), records: join(opts.out, 'records.jsonl'), errors: join(opts.out, 'errors.jsonl'), manifest: join(opts.out, 'manifest.json') };
  const startedAt = iso();
  let result;
  if (opts.source === 'b2b-sql') result = { records: await harvestB2bSql(opts), errors: [], meta: { source: 'b2b-sql', input: resolve(opts.input) } };
  else if (opts.source === 'buycarparts') result = await harvestBuycarparts(opts);
  else throw new Error(`Unknown source: ${opts.source}`);
  const media = await downloadMedia(result.records, opts, opts.out);
  const deduped = [...new Map(result.records.map(r => [r.record_id, r])).values()];
  await writeFile(paths.records, deduped.map(r => JSON.stringify(r)).join('\n') + (deduped.length ? '\n' : ''));
  await writeFile(paths.errors, result.errors.map(r => JSON.stringify(r)).join('\n') + (result.errors.length ? '\n' : ''));
  const manifest = { schema_version: 1, started_at: startedAt, finished_at: iso(), source: opts.source, records: deduped.length, errors: result.errors.length, media, options: { ...opts, user_agent: undefined }, ...result.meta };
  await atomicJson(paths.manifest, manifest);
  await atomicJson(paths.state, { status: 'complete', finished_at: manifest.finished_at, visited: result.meta.pages_visited ?? null, records: deduped.length });
  console.log(JSON.stringify({ status: 'complete', out: opts.out, records: deduped.length, errors: result.errors.length, media }, null, 2));
}

const opts = argsOf(process.argv.slice(2));
opts.user_agent = opts.user_agent ?? DEFAULT_USER_AGENT;
main().catch(error => { console.error(`HARVEST STOPPED: ${error.message}`); process.exitCode = 1; });
