#!/usr/bin/env node
/**
 * resolver-sveip — måler FRONTRUTERESOLVEREN separat fra valgtreet.
 *
 * Bred-kontroll dekker bare valgtreet (CLASS_D → glass_prisliste). Frontruten
 * går gjennom /api/frontrute (resolveren) og må måles for seg, ellers blir
 * «uten kandidater» feilaktig lest som «ingen frontrute».
 *
 * Kun lesing: POST med merke/modell/år, ingen regnr, ingen saker, ingen e-post.
 *
 * Bruk: node --import tsx scripts/resolver-sveip.mjs --limit 616
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const MAN = arg('manifest', 'data/testgrunnlag/manifest-samlet.json');
const UT = arg('ut', 'reports/resolver-sveip-616.json');
const BASE = (process.env.BASE_URL ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev').replace(/\/$/, '');
const LIMIT = Number(arg('limit', '616'));
const PAUSE = Number(arg('pause', '350'));

const manifest = JSON.parse(readFileSync(MAN, 'utf8'));
const biler = manifest.biler.slice(0, LIMIT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rader = [];
for (const [i, bil] of biler.entries()) {
  const t0 = Date.now();
  let svar = null, feil = null;
  try {
    const res = await fetch(`${BASE}/api/frontrute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Finnbilglass-Sveip/1.0' },
      body: JSON.stringify({ merke: bil.merke, modell: bil.modell, aar: bil.aar }),
      signal: AbortSignal.timeout(25000),
    });
    svar = await res.json();
    if (!res.ok) feil = `HTTP ${res.status}`;
  } catch (e) { feil = String(e).slice(0, 80); }
  const antall = Array.isArray(svar?.kandidater) ? svar.kandidater.length : 0;
  rader.push({
    test_id: bil.test_id,
    bil: `${bil.merke} ${bil.modell} ${bil.aar ?? ''}`.trim(),
    frontruteKandidater: antall,
    utfall: svar?.utfall ?? null,
    grunn: svar?.grunn ?? null,
    ms: Date.now() - t0,
    feil,
  });
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${biler.length} — ${rader.filter((r) => r.frontruteKandidater > 0).length} med frontrute`);
  await sleep(PAUSE);
}

const med = rader.filter((r) => r.frontruteKandidater > 0).length;
const oppsummering = {
  base: BASE,
  manifest: MAN,
  manifestSha256: manifest.sha256,
  biler: rader.length,
  frontruteMedKandidater: med,
  frontruteUten: rader.length - med,
  tekniskeFeil: rader.filter((r) => r.feil).length,
  utfallFordeling: rader.reduce((a, r) => ({ ...a, [r.utfall ?? 'FEIL']: (a[r.utfall ?? 'FEIL'] ?? 0) + 1 }), {}),
  sha256: createHash('sha256').update(JSON.stringify(rader)).digest('hex'),
};
writeFileSync(UT, JSON.stringify({ oppsummering, rader }, null, 2), 'utf8');
console.log('\n' + JSON.stringify(oppsummering, null, 2));
