#!/usr/bin/env node
/**
 * kandidat-maaling — måler det kundereisen faktisk bruker, per bil og rutetype.
 *
 * Kaller de EKTE endepunktene (ingen kopi av logikken):
 *   POST /api/frontrute      — frontruteresolveren (egen vei, ikke valgtreet)
 *   POST /api/glass/valg     — valgtreet for alle andre rutetyper
 *
 * Registrerer per bil og rutetype:
 *   - unike kandidat-ID-er (variantId/varenr) FØR visningsgrense
 *   - spørsmål og alternativer (felt + verdier, fra treet)
 *   - utfall (utfall/pinpoint/anbefaling) og antall kandidater
 *   - tekniske feil og svartid
 *
 * Bruk:
 *   node --import tsx scripts/kandidat-maaling.mjs --limit 117 --ut reports/maaling-etter.json
 *   BASE_URL=... node --import tsx scripts/kandidat-maaling.mjs --limit 5
 *
 * Skriver aldri til D1 og oppretter aldri henvendelser.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const LIMIT = Number(arg('limit', '0')) || Infinity;
const UT = arg('ut', 'reports/kandidat-maaling.json');
const MANIFEST = arg('manifest', 'data/finn-100.jsonl');
const PAUSE_MS = Number(arg('pause', '250'));

if (/finnbilglass\.no$/.test(new URL(BASE).host)) {
  console.error('NEKTER: prod-adresse. Målingen skal kjøre mot staging eller lokal build.');
  process.exit(2);
}

const biler = readFileSync(MANIFEST, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .slice(0, LIMIT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Finnbilglass-Maaling/1.0' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const tekst = await res.text();
    let data = null;
    try { data = JSON.parse(tekst); } catch { /* ikke JSON */ }
    return { status: res.status, data, ms: Date.now() - t0, feil: res.ok ? null : tekst.slice(0, 200) };
  } catch (e) {
    return { status: 0, data: null, ms: Date.now() - t0, feil: String(e).slice(0, 200) };
  }
}

/** Unike kandidat-ID-er fra et svar, uansett om svaret er resolver eller valgtre. */
function kandidatIder(data) {
  const kandidater = data?.kandidater ?? [];
  const ider = new Set();
  for (const k of kandidater) {
    const id = k?.variantId || (k?.varenr ? `${k.varenr}:${k.eurokode ?? ''}` : null);
    if (id) ider.add(String(id));
  }
  return [...ider];
}

/** Spørsmål og alternativer fra valgtreet (felt → verdier). */
function sporsmaal(tre) {
  const ut = [];
  for (const type of tre?.typer ?? []) {
    const grener = [];
    const gaa = (noder, dybde) => {
      for (const n of noder ?? []) {
        if (depth0(n)) grener.push({ felt: n.felt, verdi: n.verdi, antall: n.antall, dybde });
        gaa(n.barn, dybde + 1);
      }
    };
    // Bare toppnivået per type er nok til å sammenligne før/etter; barnas
    // struktur rapporteres som antall løv.
    for (const n of type.barn ?? []) grener.push({ felt: n.felt, verdi: n.verdi, antall: n.antall });
    ut.push({
      kind: type.kind,
      kandidater: type.antall,
      automatisk: type.automatisk ?? {},
      steg: grener.length,
      alternativer: grener,
      lov: antallLov(type),
    });
  }
  return ut;
}

function depth0() { return true; }

function antallLov(type) {
  if (!type.barn?.length) return 1;
  let n = 0;
  const gaa = (noder) => {
    for (const x of noder ?? []) {
      if (x.barn?.length) gaa(x.barn);
      else n += 1;
    }
  };
  gaa(type.barn);
  return n;
}

const resultat = [];
for (const bil of biler) {
  const rad = { bil: { regnr: bil.regnr ?? null, merke: bil.merke, modell: bil.modell, aar: bil.aar ?? null }, frontrute: null, valgtre: null };

  // 1) Frontruteresolveren (egen vei)
  const land = await post('/api/frontrute', { merke: bil.merke, modell: bil.modell, aar: bil.aar ?? null });
  rad.frontrute = {
    status: land.status,
    ms: land.ms,
    feil: land.feil,
    utfall: land.data?.utfall ?? null,
    pinpoint: land.data?.pinpoint ?? null,
    antall: land.data?.kandidater?.length ?? 0,
    ider: kandidatIder(land.data),
  };

  await sleep(PAUSE_MS);

  // 2) Valgtreet (alle rutetyper)
  const tre = await post('/api/glass/valg', { merke: bil.merke, modell: bil.modell, aar: bil.aar ?? null });
  rad.valgtre = {
    status: tre.status,
    ms: tre.ms,
    feil: tre.feil,
    dekning: tre.data?.dekning ?? null,
    antallKandidater: tre.data?.antallKandidater ?? null,
    ukjentPlassering: tre.data?.ukjentPlassering ?? null,
    typer: sporsmaal(tre.data),
  };

  resultat.push(rad);
  console.log(
    `${(bil.merke + ' ' + bil.modell).padEnd(34).slice(0, 34)} ` +
    `frontrute ${String(rad.frontrute.antall).padStart(2)} (${rad.frontrute.utfall ?? rad.frontrute.feil ?? 'feil'}) ` +
    `| valgtre ${String(rad.valgtre.antallKandidater ?? 0).padStart(2)} kandidater, ` +
    `${rad.valgtre.typer.length} rutetyper, ${rad.valgtre.typer.reduce((a, t) => a + t.steg, 0)} steg`,
  );

  await sleep(PAUSE_MS);
}

const oppsummering = {
  base: BASE,
  manifest: MANIFEST,
  biler: resultat.length,
  frontrute: {
    kall: resultat.length,
    tekniskeFeil: resultat.filter((r) => r.frontrute.status !== 200).length,
    medKandidater: resultat.filter((r) => r.frontrute.antall > 0).length,
    unikeKandidaterTotalt: resultat.reduce((a, r) => a + r.frontrute.ider.length, 0),
    p50ms: median(resultat.map((r) => r.frontrute.ms)),
    p95ms: persentil(resultat.map((r) => r.frontrute.ms), 0.95),
  },
  valgtre: {
    kall: resultat.length,
    tekniskeFeil: resultat.filter((r) => r.valgtre.status !== 200).length,
    medKandidater: resultat.filter((r) => (r.valgtre.antallKandidater ?? 0) > 0).length,
    unikeKandidaterTotalt: resultat.reduce((a, r) => a + (r.valgtre.antallKandidater ?? 0), 0),
    rutetyper: sum(resultat.map((r) => r.valgtre.typer.length)),
    steg: sum(resultat.map((r) => r.valgtre.typer.reduce((a, t) => a + t.steg, 0))),
    p50ms: median(resultat.map((r) => r.valgtre.ms)),
    p95ms: persentil(resultat.map((r) => r.valgtre.ms), 0.95),
  },
};

function sum(a) { return a.reduce((x, y) => x + y, 0); }
function median(a) { return persentil(a, 0.5); }
function persentil(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

writeFileSync(UT, JSON.stringify({ oppsummering, resultat }, null, 2), 'utf8');
console.log('\n' + JSON.stringify(oppsummering, null, 2));
console.log(`\nskrevet: ${UT}`);
