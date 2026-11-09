#!/usr/bin/env node
/**
 * valgtre-for-etter — ekte før/etter: KJØRER gammel og ny valgtrebygger mot
 * IDENTISKE, lagrede kandidatdata. Ingen emulering av gammel logikk.
 *
 *   OLD: scripts/_old/glass-valg-OLD.ts  (git blob fra dfbc86b, uendret logikk)
 *   NEW: src/glass-valg.ts
 *
 * Sammenligner hele valgstien per bil og rutetype:
 *   - alle stier (rutetype + felt=verdi, rekursivt)
 *   - automatiske verdier på hvert nivå
 *   - antall kandidater per node (kandidatsettets størrelse)
 *
 * Datagrunnlaget fryses til en fil med SHA-256, slik at sammenligningen kan
 * gjentas ordrett. Skriver aldri til D1.
 *
 * Bruk:
 *   node --import tsx scripts/valgtre-for-etter.mjs --limit 110 \
 *     --frys reports/valgtre-kandidater-frosset-20261104.json \
 *     --ut reports/valgtre-for-etter-20261104.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.ts';
import { byggValgTre } from '../src/glass-valg.ts';
import { byggValgTreOLD } from './_old/glass-valg-OLD.ts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', '110'));
const UT = arg('ut', 'reports/valgtre-for-etter.json');
const FRYS = arg('frys', 'reports/valgtre-kandidater-frosset.json');
const MANIFEST = arg('manifest', 'data/finn-100.jsonl');

const biler = readFileSync(MANIFEST, 'utf8').split('\n').filter((l) => l.trim()).map(JSON.parse).slice(0, LIMIT);
const manifestSha = createHash('sha256').update(readFileSync(MANIFEST)).digest('hex');

function d1(sql) {
  const ut = execFileSync('npx', ['wrangler', 'd1', 'execute', 'finnbilglass-db', '--remote', '--json', '--command', sql], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = ut.indexOf('[');
  if (start < 0) throw new Error('fant ikke JSON i wrangler-svaret');
  return JSON.parse(ut.slice(start)).flatMap((d) => d.results || []);
}

/** Fryser kandidatsettet per bil. Kjøres én gang; deretter leses filen. */
function frysInn() {
  if (existsSync(FRYS) && !process.argv.includes('--tving-frys')) return JSON.parse(readFileSync(FRYS, 'utf8'));
  const perBil = [];
  for (const bil of biler) {
    const merke = String(bil.merke).toUpperCase().replace(/[%_']/g, '');
    let rows = [];
    try {
      rows = d1(`SELECT varenr, varenavn, eurokode, kommentar FROM glass_prisliste WHERE varenavn LIKE '${merke}%' LIMIT 5000`);
    } catch { rows = []; }
    const kandidater = matchClassDCandidates(
      buildClassDCandidates(rows.map((r) => ({ varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.kommentar ?? null }))),
      bil.merke, bil.modell, bil.aar ?? null,
    );
    perBil.push({ bil, kandidater });
    console.log(`frosset: ${bil.merke} ${bil.modell} (${kandidater.length} kandidater)`);
  }
  const innhold = { manifest: MANIFEST, manifestSha256: manifestSha, biler: perBil };
  writeFileSync(FRYS, JSON.stringify(innhold, null, 2), 'utf8');
  return innhold;
}

const data = frysInn();
const dataSha = createHash('sha256').update(JSON.stringify(data.biler)).digest('hex');

/** Full sti-representasjon av et tre. */
function stier(tre) {
  const ut = [];
  for (const type of tre.typer) {
    const rot = `type:${type.kind}:n=${type.antall}:auto=${JSON.stringify(type.automatisk ?? {})}`;
    ut.push(rot);
    const gaa = (noder, prefiks) => {
      for (const n of noder ?? []) {
        const sti = `${prefiks}/${n.felt}=${n.verdi}:n=${n.antall}:auto=${JSON.stringify(n.automatisk ?? {})}`;
        ut.push(sti);
        gaa(n.barn, sti);
      }
    };
    gaa(type.barn, rot);
  }
  return ut.sort();
}

const rader = [];
for (const { bil, kandidater } of data.biler) {
  const gammel = stier(byggValgTreOLD({ kandidater }));
  const ny = stier(byggValgTre({ kandidater }));
  const bareGammel = gammel.filter((s) => !ny.includes(s));
  const bareNy = ny.filter((s) => !gammel.includes(s));

  rader.push({
    bil: { regnr: bil.regnr, merke: bil.merke, modell: bil.modell, aar: bil.aar },
    kandidater: kandidater.length,
    stierGammel: gammel.length,
    stierNy: ny.length,
    felles: gammel.length - bareGammel.length,
    bareGammel,
    bareNy,
    endret: bareGammel.length > 0 || bareNy.length > 0,
  });

  if (bareGammel.length || bareNy.length) {
    console.log(`${(bil.merke + ' ' + bil.modell).padEnd(30).slice(0, 30)} endret: +${bareNy.length} / -${bareGammel.length} stier`);
  }
}

const oppsummering = {
  manifest: MANIFEST,
  manifestSha256: manifestSha,
  datagrunnlagSha256: dataSha,
  gammelKode: 'scripts/_old/glass-valg-OLD.ts (git blob dfbc86b:src/glass-valg.ts = d8d70cfcd0ed03a48163358ff767b76d5d773ec8)',
  nyKode: 'src/glass-valg.ts',
  biler: rader.length,
  bilerMedKandidater: rader.filter((r) => r.kandidater > 0).length,
  bilerUendret: rader.filter((r) => !r.endret).length,
  bilerEndret: rader.filter((r) => r.endret).length,
  stierGammel: rader.reduce((a, r) => a + r.stierGammel, 0),
  stierNy: rader.reduce((a, r) => a + r.stierNy, 0),
};

writeFileSync(UT, JSON.stringify({ oppsummering, rader }, null, 2), 'utf8');
console.log('\n' + JSON.stringify(oppsummering, null, 2));
console.log(`\nskrevet: ${UT}`);
