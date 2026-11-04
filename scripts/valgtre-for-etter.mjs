#!/usr/bin/env node
/**
 * valgtre-for-etter — sammenligner valgtreet FØR og ETTER kodeendringen på
 * SAMME manifest og SAMME katalograder (lesing fra D1).
 *
 * «Før» emuleres trofast: den gamle `feltVerdi` returnerte `null` for både
 * «begge sider» og «flere karosserier», altså behandlet dem som ukjent. Det
 * tilsvarer nøyaktig en kandidat med side=null og uten karosseriord i navnet.
 * Vi kjører derfor samme bygger på to kandidatsett og sammenligner.
 *
 * Bruk:
 *   node --import tsx scripts/valgtre-for-etter.mjs --limit 110 \
 *     --ut reports/valgtre-for-etter-20261104.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.ts';
import { byggValgTre } from '../src/glass-valg.ts';
import { kropperIRad } from '../src/fitment-v1/catalogue-candidates.ts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', '110'));
const UT = arg('ut', 'reports/valgtre-for-etter.json');
const MANIFEST = arg('manifest', 'data/finn-100.jsonl');

const biler = readFileSync(MANIFEST, 'utf8').split('\n').filter((l) => l.trim()).map(JSON.parse).slice(0, LIMIT);

function d1(sql) {
  const ut = execFileSync('npx', ['wrangler', 'd1', 'execute', 'finnbilglass-db', '--remote', '--json', '--command', sql], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = ut.indexOf('[');
  if (start < 0) throw new Error('fant ikke JSON i wrangler-svaret');
  return JSON.parse(ut.slice(start)).flatMap((d) => d.results || []);
}

const KROPP_ORD = ['SED', 'SEDAN', 'STV', 'STVOGN', 'STASJON', 'STASJONSWAGON', 'STATION', 'WAGON', 'KOMBI', 'ESTATE', 'AVANT', 'TOURING', 'SPORTBACK', 'HBK', 'HATCH', 'HATCHBACK', 'CPE', 'COUPE', 'CAB', 'CABR', 'CABRIOLET', 'VAN', 'MPV', 'MINIBUSS', 'SUV', 'CROSSOVER'];

/** Emulerer gammel feltVerdi: «begge» og flerkarosseri ble behandlet som ukjent. */
function gammelKandidat(c) {
  const kropper = [...kropperIRad(c.varenavn)];
  let varenavn = c.varenavn;
  if (kropper.length > 1) {
    // Fjern karosseriordene slik at kropperIRad() gir tom mengde = ukjent.
    varenavn = varenavn.split(/\s+/).filter((o) => !KROPP_ORD.includes(o.toUpperCase())).join(' ');
  }
  return {
    ...c,
    varenavn,
    posisjon: { ...c.posisjon, side: c.posisjon.side === 'begge' ? null : c.posisjon.side },
  };
}

function sammendrag(tre) {
  const steg = tre.typer.reduce((a, t) => a + t.barn.length, 0);
  const lov = tre.typer.reduce((a, t) => a + antallLov(t), 0);
  return {
    typer: tre.typer.length,
    steg,
    lov,
    perType: tre.typer.map((t) => ({ kind: t.kind, kandidater: t.antall, steg: t.barn.length, lov: antallLov(t) })),
  };
}

function antallLov(type) {
  if (!type.barn.length) return 1;
  let n = 0;
  const gaa = (noder) => { for (const x of noder) { if (x.barn.length) gaa(x.barn); else n += 1; } };
  gaa(type.barn);
  return n;
}

const rader = [];
for (const bil of biler) {
  const merke = String(bil.merke).toUpperCase().replace(/'/g, '');
  let treff;
  try {
    treff = d1(`SELECT varenr, varenavn, eurokode, kommentar FROM glass_prisliste WHERE varenavn LIKE '${merke.replace(/[%_]/g, '')}%' LIMIT 5000`);
  } catch (e) {
    rader.push({ bil, feil: String(e).slice(0, 120) });
    continue;
  }
  const index = buildClassDCandidates(treff.map((r) => ({ varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.comment ?? r.kommentar ?? null })));
  const kandidater = matchClassDCandidates(index, bil.merke, bil.modell, bil.aar ?? null);

  const forTre = byggValgTre({ kandidater: kandidater.map(gammelKandidat) });
  const etterTre = byggValgTre({ kandidater });

  const f = sammendrag(forTre), e = sammendrag(etterTre);
  rader.push({
    bil: { regnr: bil.regnr, merke: bil.merke, modell: bil.modell, aar: bil.aar },
    kandidater: kandidater.length,
    for: f,
    etter: e,
    endring: { steg: e.steg - f.steg, lov: e.lov - f.lov },
  });
  if (e.steg !== f.steg || e.lov !== f.lov) {
    console.log(`${(bil.merke + ' ' + bil.modell).padEnd(32).slice(0, 32)} steg ${f.steg}→${e.steg} · løv ${f.lov}→${e.lov}`);
  }
}

const ok = rader.filter((r) => !r.feil);
const oppsummering = {
  manifest: MANIFEST,
  biler: rader.length,
  feil: rader.length - ok.length,
  bilerUendret: ok.filter((r) => r.endring.steg === 0 && r.endring.lov === 0).length,
  bilerEndret: ok.filter((r) => r.endring.steg !== 0 || r.endring.lov !== 0).length,
  stegFor: ok.reduce((a, r) => a + r.for.steg, 0),
  stegEtter: ok.reduce((a, r) => a + r.etter.steg, 0),
  lovFor: ok.reduce((a, r) => a + r.for.lov, 0),
  lovEtter: ok.reduce((a, r) => a + r.etter.lov, 0),
};

writeFileSync(UT, JSON.stringify({ oppsummering, rader }, null, 2), 'utf8');
console.log('\n' + JSON.stringify(oppsummering, null, 2));
console.log(`\nskrevet: ${UT}`);
