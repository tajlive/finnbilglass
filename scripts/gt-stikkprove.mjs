#!/usr/bin/env node
/**
 * GT-stikkprøver for ekspertgodkjenning (Gate B/C):
 * Viser representative (make, model, year) → GT-kandidater med varenavn + pris
 * slik at Tom kan verifisere mot Autoglass-kunnskapen FØR import.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { serieKey } from '../src/serie-mapping.ts';

const DATA = '/Users/taj/finnbilglass/data/gt-ekspansjon';
const MERKER = ['TESLA', 'MERCEDES', 'OPEL', 'BMW', 'VW', 'TOYOTA', 'VOLVO'];

function lesPrisliste() {
  const d = JSON.parse(readFileSync(`${DATA}/prisliste-alle-glass.json`, 'utf8'));
  return (d[0] && d[0].results) ? d[0].results : d;
}

function main() {
  const pris = lesPrisliste();
  const prisMap = new Map();
  for (const r of pris) prisMap.set(String(r.varenr), r);

  // Parse generert SQL til GT-rader
  const sql = readFileSync(`${DATA}/gt-generert.sql`, 'utf8');
  const re = /'([^']*)', '([^']*)', (\d{4}), '([^']*)'/g;
  const rader = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    rader.push({ make: m[1], model: m[2], year: Number(m[3]), varenr: m[4] });
  }

  const rapport = ['# GT-stikkprøver — ekspertgodkjenning før import', '',
    `Generert: ${new Date().toISOString()} · ${rader.length} GT-rader totalt`, ''];

  for (const merke of MERKER) {
    const mr = rader.filter((r) => r.make === merke);
    if (!mr.length) continue;
    const grupper = new Map();
    for (const r of mr) {
      const k = `${r.model}|${r.year}`;
      if (!grupper.has(k)) grupper.set(k, []);
      grupper.get(k).push(r.varenr);
    }
    // Velg grupper: 8 entydige + 8 flerkandidat (ulike år og modeller)
    const alle = [...grupper.entries()];
    const entydige = alle.filter(([, v]) => v.length === 1);
    const fler = alle.filter(([, v]) => v.length >= 2);
    const utvalg = [];
    const sett = new Set();
    for (const [k, v] of [...entydige, ...fler]) {
      const modell = k.split('|')[0];
      if (sett.has(modell)) continue;
      sett.add(modell);
      utvalg.push({ k, varenr: v });
      if (utvalg.length >= 14) break;
    }
    rapport.push(`## ${merke} (${mr.length} GT-rader, ${grupper.size} grupper)`, '');
    rapport.push('| Modell | År | Kandidater (varenr → varenavn) | SerieKey |', '|---|---|---|---|');
    for (const { k, varenr } of utvalg) {
      const [modell, yr] = k.split('|');
      const sk = serieKey(merke, modell, Number(yr));
      const beskriv = varenr.slice(0, 4).map((v) => {
        const p = prisMap.get(v);
        return p ? `${v} → ${p.varenavn}` : `${v} → MANGLER I PRISLISTEN!`;
      }).join('<br>');
      rapport.push(`| ${modell} | ${yr} | ${beskriv} | ${sk ?? '—'} |`);
    }
    rapport.push('');
  }
  writeFileSync(`${DATA}/gt-stikkprove-rapport.md`, rapport.join('\n'));
  console.log(`Skrevet: ${DATA}/gt-stikkprove-rapport.md (${rapport.length} linjer)`);
}
main();
