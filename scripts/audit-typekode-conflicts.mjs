#!/usr/bin/env node
/**
 * Bulk-konfliktskanning for typekoder — skrivebeskyttet.
 *
 * Leser ALLE koblede prislisterader fra staging-D1 (ikke et utvalg på 25) og
 * klassifiserer hver rad med de samme funksjonene produksjonen bruker:
 * `fraTypekode()` og `klassifiserGlass()`.
 *
 * Skriver:
 *   reports/typekode-conflicts-summary.json
 *   reports/typekode-conflicts-sample.csv
 *
 * Rører ingen D1-rader. Ingen kundedata i utskriften.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fraTypekode, klassifiserGlass } from '../src/glass-posisjon.ts';

const DB = process.env.AUDIT_DB || 'finnbilglass-staging-catalog';
const SIDE = 1500;

function d1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  const json = JSON.parse(out.slice(start, end + 1));
  return json[0]?.results ?? [];
}

/** Klassifiserer én rad. Rekkefølgen er prioritet — første treff vinner. */
function klassifiser(rad) {
  const tp = fraTypekode(rad.typekode);
  const kg = klassifiserGlass(rad.varenavn, rad.varenr, rad.eurokode, rad.typekode);
  const navn = String(rad.varenavn || '').toUpperCase();

  if (!tp || !tp.gyldig) return { klasse: 'UNKNOWN_TYPE', grunn: `typekode «${rad.typekode}»` };
  if (/(?:PY|GU)[A-Z]{0,4}$/.test(String(rad.varenr || '').toUpperCase()) || /KLIPS|PAKNING|PYNTELIST|GUMMILIST/.test(navn)) {
    return { klasse: 'NON_GLASS_PRODUCT', grunn: 'list/klips/pakning' };
  }
  if (kg.typekodeKonflikt) return { klasse: 'TYPE_CONFLICT', grunn: kg.grunn };
  if (kg.typekonflikt) return { klasse: 'EUROCODE_CONFLICT', grunn: kg.grunn };

  // Dør: navnet sier fremre/bakre motsatt av typekoden
  if (tp.type === 'dor' && tp.dorLedd) {
    if (/FREMRE|FRAMME|FORAN/.test(navn) && tp.dorLedd === 'bakre') return { klasse: 'FRONT_REAR_CONFLICT', grunn: 'navn: fremre, typekode: bakre' };
    if (/BAKRE|BAK(?![A-ZÆØÅ])/.test(navn) && tp.dorLedd === 'fremre') return { klasse: 'FRONT_REAR_CONFLICT', grunn: 'navn: bakre, typekode: fremre' };
  }
  // Ventil vs vanlig dørrute
  if (tp.type === 'ventil' && /DØRRUTE|DORRUTE|DOORGLASS/.test(navn) && !/VENTIL|VENTRUTE/.test(navn)) {
    return { klasse: 'VENTIL_DOOR_CONFLICT', grunn: 'typekode ventil, navn dørrute' };
  }
  if (tp.type === 'dor' && /VENTILRUTE|VENTRUTE/.test(navn)) {
    return { klasse: 'VENTIL_DOOR_CONFLICT', grunn: 'typekode dørrute, navn ventil' };
  }
  // Fysisk side kan ikke avgjøres uten dokumentert styretype. Det er usikkerhet,
  // ikke konflikt — raden er ikke feil, den er uavklart.
  if (tp.side) return { klasse: 'SIDE_UNCERTAIN_STEERING', grunn: 'styretype ikke dokumentert' };

  return { klasse: 'NO_CONFLICT', grunn: tp.grunn };
}

function main() {
  const total = d1('SELECT COUNT(*) AS n FROM glass_prisliste p JOIN glass_typekode t ON t.varenr = UPPER(p.varenr)')[0].n;
  console.log(`koblede rader i ${DB}: ${total}`);

  const telling = {};
  const perKode = {};
  const sample = [];
  let lest = 0;

  for (let offset = 0; offset < total; offset += SIDE) {
    const rader = d1(
      `SELECT p.varenr, p.varenavn, p.eurokode, p.rad_type, t.typekode, t.typekode_beskrivelse, t.kilde
         FROM glass_prisliste p
         JOIN glass_typekode t ON t.varenr = UPPER(p.varenr)
        ORDER BY p.varenr
        LIMIT ${SIDE} OFFSET ${offset}`,
    );
    for (const rad of rader) {
      lest += 1;
      const { klasse, grunn } = klassifiser(rad);
      telling[klasse] = (telling[klasse] || 0) + 1;
      perKode[rad.typekode] ??= {};
      perKode[rad.typekode][klasse] = (perKode[rad.typekode][klasse] || 0) + 1;
      // Maks 60 per klasse, slik at utvalget viser alle konflikttypene
      // i stedet for å fylles av den vanligste.
      const perKlasse = (sample.filter((x) => x.klasse === klasse).length);
      if (klasse !== 'NO_CONFLICT' && perKlasse < 60) {
        sample.push({ varenr: rad.varenr, eurokode: rad.eurokode, typekode: rad.typekode, klasse, grunn });
      }
    }
    console.log(`  lest ${lest}/${total}`);
  }

  if (lest !== total) {
    console.error(`AVVIK: leste ${lest}, forventet ${total}`);
  }

  mkdirSync('reports', { recursive: true });
  const oppsummering = {
    generert: new Date().toISOString(),
    database: DB,
    koblede_rader: total,
    analysert: lest,
    avvik: lest - total,
    konfliktklasser: telling,
    per_typekode: perKode,
    andel_uten_konflikt: Number(((telling.NO_CONFLICT || 0) / total * 100).toFixed(2)),
    andel_usikker_side: Number(((telling.SIDE_UNCERTAIN_STEERING || 0) / total * 100).toFixed(2)),
  };
  writeFileSync('reports/typekode-conflicts-summary.json', JSON.stringify(oppsummering, null, 2));

  const head = 'varenr;eurokode;typekode;klasse;grunn\n';
  writeFileSync(
    'reports/typekode-conflicts-sample.csv',
    head + sample.map((x) => [x.varenr, x.eurokode, x.typekode, x.klasse, x.grunn.replace(/;/g, ',')].join(';')).join('\n') + '\n',
  );

  console.log('\nklasser:');
  for (const [k, v] of Object.entries(telling).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${String(v).padStart(6)}  ${(v / total * 100).toFixed(2)} %`);
  }
}

main();
