#!/usr/bin/env node
/**
 * sync-b2b-import.mjs — importerer B2B-sync-artifact til finnbilglass-D1 (idempotent).
 *
 * Leser glass_catalog.rows.jsonl, prisliste.rows.jsonl, ktype_matches.rows.jsonl
 * → batch INSERT OR IGNORE (à 400 rader) via Cloudflare D1 REST API.
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE (navn), ARTIFACT_DIR.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_NAME = process.env.D1_DATABASE ?? 'finnbilglass-db-staging';
const DIR = process.env.ARTIFACT_DIR ?? '.';
const BATCH = 400;

if (!ACCOUNT || !TOKEN) { console.error('Mangler CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID'); process.exit(2); }

async function d1(dbUuid, sql) {
  const r = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${dbUuid}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })).json();
  if (!r.success) throw new Error('D1-feil: ' + JSON.stringify(r.errors ?? r.messages));
  return r;
}

async function hentDbUuid() {
  const dbs = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).json();
  const db = (dbs.result ?? []).find((d) => d.name === DB_NAME);
  if (!db) throw new Error(`D1-database «${DB_NAME}» ikke funnet`);
  return db.uuid;
}

function les(fil) {
  const p = join(DIR, fil);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function esc(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function importer(dbUuid, tabell, kolonner, rader, primKey) {
  const sett = new Set();
  const rene = rader.filter((r) => {
    const key = primKey.map((k) => String(r[k] ?? '')).join('|');
    if (sett.has(key)) return false;
    sett.add(key);
    return true;
  });
  let inn = 0, duplikater = 0;
  for (let i = 0; i < rene.length; i += BATCH) {
    const batch = rene.slice(i, i + BATCH);
    const values = batch.map((r) => '(' + kolonner.map((k) => esc(r[k])).join(',') + ')').join(',');
    const sql = `INSERT OR IGNORE INTO ${tabell} (${kolonner.join(',')}) VALUES ${values}`;
    const res = await d1(dbUuid, sql);
    // D1 REST returnerer meta; tell innførte via changes når tilgjengelig, ellers estimer
    const changes = res.result?.[0]?.meta?.changes_written ?? batch.length;
    inn += Math.min(changes, batch.length);
    duplikater += batch.length - Math.min(changes, batch.length);
  }
  return { inn, duplikater, kandidater: rene.length };
}

async function main() {
  const dbUuid = await hentDbUuid();
  const glass = les('glass_catalog.rows.jsonl');
  const prisliste = les('prisliste.rows.jsonl');
  const ktype = les('ktype_matches.rows.jsonl');

  const g = await importer(dbUuid, 'glass_catalog',
    ['eurocode', 'brand', 'model', 'year_from', 'year_to', 'category', 'rain_sensor', 'antenna', 'hud', 'camera', 'adas', 'description', 'ktype'],
    glass, ['eurocode']);
  const p = await importer(dbUuid, 'glass_prisliste',
    ['varenr', 'varenavn', 'pris', 'eurokode', 'rad_type'],
    // Eurocode is part of the supplier identity. A shared product number and
    // display name can legitimately represent multiple glass variants.
    prisliste, ['varenr', 'varenavn', 'eurokode', 'rad_type']);
  const k = await importer(dbUuid, 'ktype_matches',
    ['ktype', 'eurocode', 'count'],
    ktype, ['ktype', 'eurocode']);

  const tot = await d1(dbUuid, "SELECT (SELECT COUNT(*) FROM glass_catalog) AS glass, (SELECT COUNT(*) FROM glass_prisliste) AS pris, (SELECT COUNT(*) FROM ktype_matches) AS ktype");
  const res = tot.result?.[0]?.results?.[0] ?? {};
  console.log(JSON.stringify({ glass: g, prisliste: p, ktype: k, totaler: res }, null, 2));
}

main().catch((e) => { console.error('FEIL:', e.message); process.exit(1); });
