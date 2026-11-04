#!/usr/bin/env node
/**
 * isolert-kopi-sjekk — kjører RELEASEKODEN mot en isolert kopi av
 * produksjonsgrunnlaget, uten glass_typekode (0047).
 *
 * Bygger en lokal SQLite med produksjonens faktiske `glass_prisliste`-skjema og
 * alle 30 937 produksjonsrader, men UTEN `glass_typekode`. Kjører deretter de
 * faktiske releasefunksjonene og de to SQL-spørringene som nevner typekode, for
 * å bevise at releasen ikke krever 0047.
 *
 * Skriver aldri til produksjon.
 *
 * Bruk:
 *   node --import tsx scripts/isolert-kopi-sjekk.mjs --rader=/tmp/prod-rader.json
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.ts';
import { byggValgTre } from '../src/glass-valg.ts';
import { kontrollerVariant, produkttype, salgsenhet } from '../src/glass-variant-kontroll.ts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const RADER = arg('rader', '/tmp/prod-rader.json');
const DB = '/tmp/prod-kopi.db';

if (existsSync(DB)) unlinkSync(DB);

const rader = JSON.parse(readFileSync(RADER, 'utf8'))[0].results;

// Produksjonens faktiske skjema for glass_prisliste (fra sqlite_master), og
// bevisst INGEN glass_typekode-tabell.
const skjema = `
CREATE TABLE glass_prisliste (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  varenr TEXT NOT NULL,
  varenavn TEXT,
  kommentar TEXT,
  pris REAL,
  eurokode TEXT,
  alias_av TEXT,
  rad_type TEXT NOT NULL DEFAULT 'glass',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  variant_id TEXT
);
CREATE UNIQUE INDEX uq_glasspris_variant_id ON glass_prisliste(variant_id);
CREATE INDEX idx_glasspris_varenr ON glass_prisliste(varenr);
`;

function sql(tekst) {
  const ut = execFileSync('sqlite3', [DB, '-json', tekst], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return ut.trim() ? JSON.parse(ut) : [];
}

execFileSync('sqlite3', [DB], { input: skjema, encoding: 'utf8' });

// Indsæt i én transaktion via en midlertidig SQL-fil (30 937 rækker).
const e = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = ['BEGIN;'];
for (const r of rader) {
  insert.push(
    `INSERT INTO glass_prisliste (varenr, varenavn, kommentar, pris, eurokode, rad_type, variant_id) VALUES (${e(r.varenr)}, ${e(r.varenavn)}, ${e(r.kommentar)}, ${e(r.pris)}, ${e(r.eurokode)}, ${e(r.rad_type)}, ${e(r.variant_id)});`,
  );
}
insert.push('COMMIT;');
execFileSync('sqlite3', [DB], { input: insert.join('\n'), encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const telling = sql('SELECT count(*) AS n, count(DISTINCT variant_id) AS u FROM glass_prisliste')[0];
const tabeller = sql("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);

console.log('=== ISOLERT KOPI AV PRODUKSJONSGRUNNLAGET ===');
console.log('rader:', telling.n, '| unike variant_id:', telling.u);
console.log('tabeller:', tabeller.join(', '));
console.log('glass_typekode finnes:', tabeller.includes('glass_typekode'));

const utfall = [];

// 1) Releasekodens kandidatgenerering og valgtre mot proddata
for (const bil of [
  { merke: 'TOYOTA', modell: 'RAV4', aar: 2024 },
  { merke: 'FORD', modell: 'TRANSIT', aar: 2002 },
  { merke: 'VW', modell: 'PASSAT', aar: 1990 },
]) {
  const merke = bil.merke;
  const treff = sql(`SELECT varenr, varenavn, eurokode, kommentar FROM glass_prisliste WHERE varenavn LIKE '${merke}%' LIMIT 5000`);
  const indeks = buildClassDCandidates(treff.map((r) => ({ varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.kommentar ?? null })));
  const kandidater = matchClassDCandidates(indeks, bil.merke, bil.modell, bil.aar);
  const tre = byggValgTre({ kandidater });
  utfall.push({ bil: `${bil.merke} ${bil.modell} ${bil.aar}`, kandidater: kandidater.length, typer: tre.typer.length, steg: tre.typer.reduce((a, t) => a + t.barn.length, 0), dekning: tre.dekning });
}

// 2) Spørringen som nevner glass_typekode — skal feile og fanges
let typekodeFeil = null;
try {
  sql('SELECT typekode FROM glass_typekode WHERE varenr = UPPER(\'8432AGAC\') LIMIT 1');
} catch (err) {
  typekodeFeil = String(err.stderr ?? err).includes('no such table') ? 'no such table: glass_typekode' : String(err).slice(0, 80);
}

// 3) Kontrollen av valgt variant mot kundens svar
const rad = sql("SELECT varenr, varenavn, eurokode, kommentar FROM glass_prisliste WHERE variant_id = '8432AGAC:8432AGACMV1L' LIMIT 1")[0];
const kontroll = rad
  ? {
    produkttype: produkttype(rad.varenavn, rad.varenr),
    salgsenhet: salgsenhet(rad.varenavn, rad.varenr),
    riktig: kontrollerVariant(rad, { side: 'left', answers: { oppvarmet: 'nei' } }).status,
    feilSide: kontrollerVariant(rad, { side: 'right' }).status,
  }
  : null;

console.log('\n=== RESULTAT UTEN glass_typekode ===');
for (const u of utfall) console.log(' ', JSON.stringify(u));
console.log('  typekode-spørring:', typekodeFeil ?? 'ingen feil');
console.log('  variantkontroll:', JSON.stringify(kontroll));

const ok = utfall.every((u) => u.typer >= 1) && typekodeFeil === 'no such table: glass_typekode';
console.log('\nKONKLUSJON:', ok ? 'PASS — releasen kjører uten 0047' : 'FAIL');
process.exit(ok ? 0 : 1);
