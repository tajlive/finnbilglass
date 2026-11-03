#!/usr/bin/env node
/**
 * Katalogklassifisering — måler hvor mange rader vi faktisk kan plassere.
 *
 * Skrivebeskyttet: leser `glass_prisliste` via wrangler (SELECT) eller fra en
 * JSON-fil, og kjører `src/glass-posisjon.ts` på hver rad. Skriver ingen data.
 *
 *   node --import tsx scripts/katalog-klassifisering.mjs            # mot prod (lesing)
 *   node --import tsx scripts/katalog-klassifisering.mjs /tmp/x.json
 *   node --import tsx scripts/katalog-klassifisering.mjs --out rapport.md
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { klassifiserGlass } from '../src/glass-posisjon.ts';

const args = process.argv.slice(2);
const filArg = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const utFil = outIdx > -1 ? args[outIdx + 1] : null;

function hentFraD1() {
  const rader = [];
  let sisteId = 0;
  for (;;) {
    const sql = `SELECT id, varenr, varenavn, kommentar, pris, eurokode, rad_type
                 FROM glass_prisliste WHERE id > ${sisteId} ORDER BY id LIMIT 8000`;
    const ut = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'finnbilglass-db', '--remote', '--command', sql, '--json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const start = ut.indexOf('[');
    if (start < 0) throw new Error('fikk ikke JSON fra wrangler');
    const batch = JSON.parse(ut.slice(start))[0].results;
    if (!batch?.length) break;
    rader.push(...batch);
    sisteId = batch[batch.length - 1].id;
    if (batch.length < 8000) break;
  }
  return rader;
}

const alle = filArg ? JSON.parse(readFileSync(filArg, 'utf8')) : hentFraD1();

const KLASSER = ['frakt', 'emballasje', 'alias'];
const typer = new Map();
const kilder = new Map();
const konflikter = [];
const eksempler = new Map();
let sideSatt = 0;
let dorLeddSatt = 0;
let kandidater = 0;
let ikkeGlass = 0;

for (const r of alle) {
  if (KLASSER.includes(r.rad_type)) continue;
  const k = klassifiserGlass(r.varenavn, r.varenr, r.eurokode);
  typer.set(k.type, (typer.get(k.type) ?? 0) + 1);
  kilder.set(k.kilde, (kilder.get(k.kilde) ?? 0) + 1);
  if (k.side) sideSatt++;
  if (k.dorLedd) dorLeddSatt++;
  if (k.erFrontrute) kandidater++;
  if (k.grunn.startsWith('list/klips')) ikkeGlass++;
  if (k.typekonflikt) konflikter.push({ ...r, k });
  if (!eksempler.has(k.type)) eksempler.set(k.type, []);
  const e = eksempler.get(k.type);
  if (e.length < 3) e.push(`${r.varenr} — ${(r.varenavn || '').slice(0, 44)}`);
}

const total = [...typer.values()].reduce((a, b) => a + b, 0);
const pct = (n) => `${((100 * n) / total).toFixed(1)} %`;
const linjer = [];
const logg = (s = '') => {
  linjer.push(s);
  console.log(s);
};

logg(`# Katalogklassifisering (${new Date().toISOString().slice(0, 10)})`);
logg('');
logg(`Rader vurdert: **${total}** (frakt/emballasje/alias holdt utenfor)`);
logg('');
logg('## Type');
logg('');
logg('| Type | Rader | Andel | Eksempler |');
logg('|---|---:|---:|---|');
for (const [type, n] of [...typer.entries()].sort((a, b) => b[1] - a[1])) {
  logg(`| ${type} | ${n} | ${pct(n)} | ${(eksempler.get(type) || []).join(' · ')} |`);
}
logg('');
logg('## Hvor typen kom fra');
logg('');
for (const [kilde, n] of [...kilder.entries()].sort((a, b) => b[1] - a[1])) logg(`- ${kilde}: ${n} (${pct(n)})`);
logg(`- side satt: ${sideSatt} (${pct(sideSatt)})`);
logg(`- dørledd (fremre/bakre) satt: ${dorLeddSatt}`);
logg(`- frontrute-kandidater: **${kandidater}** (${pct(kandidater)})`);
logg(`- avvist som list/klips/pakning: ${ikkeGlass}`);
logg('');
logg(`## Typekonflikter navn ↔ eurokode: ${konflikter.length}`);
logg('');
if (konflikter.length) {
  logg('| Varenr | Navn | Eurokode | Navn sier | Eurokode sier |');
  logg('|---|---|---|---|---|');
  for (const k of konflikter.slice(0, 25)) {
    logg(`| ${k.varenr} | ${(k.varenavn || '').slice(0, 40)} | ${k.eurokode || '—'} | ${k.k.navnType} | ${k.k.eurokodeType} |`);
  }
  if (konflikter.length > 25) logg(`\n_(+${konflikter.length - 25} flere)_`);
}
logg('');
logg('> Konflikter auto-avgjøres aldri: kunden skal få MANUAL_REVIEW, ikke et gjett.');

const rapport = linjer.join('\n') + '\n';
if (utFil) {
  writeFileSync(utFil, rapport);
  console.log(`\nSkrev ${utFil}`);
} else {
  const tmp = join(mkdtempSync(join(tmpdir(), 'katalog-')), 'rapport.md');
  writeFileSync(tmp, rapport);
  console.log(`\n(rapport: ${tmp})`);
}
