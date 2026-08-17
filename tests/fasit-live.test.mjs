import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Live-fasit-regresjon mot Worker (prod som default).
 * Leser data/fasit-live.json (119 maskinverifiserte L1-PINPOINT fra
 * test-500-gt prod 2026-08-16) og krever at hver fortsatt gir PINPOINT
 * med riktig glass. Nettavhengig — kjør eksplisitt:
 *   node --test tests/fasit-live.test.mjs
 *   BASE_URL=... node --test tests/fasit-live.test.mjs
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL ?? 'https://finnbilglass.no';
const DELAY = Number(process.env.FASIT_DELAY_MS ?? 80);
const fil = join(ROOT, 'data', 'fasit-live.json');

const { fasiter } = JSON.parse(readFileSync(fil, 'utf8'));

function base8(x) { return String(x).length >= 8 ? String(x).slice(0, 8) : String(x); }
function norm(x) { return String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

async function sok(bil) {
  const r = await fetch(`${BASE}/api/frontrute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bil),
  });
  if (!r.ok) return { status: r.status, data: null };
  return { status: r.status, data: await r.json() };
}

test(`live-fasit: ${fasiter.length} maskinverifiserte fasiter mot ${BASE}`, async (t) => {
  let feil = 0;
  for (const [i, f] of fasiter.entries()) {
    await sleep(DELAY);
    const body = { merke: f.merke, modell: f.modell, aar: f.aar };
    if (f.profil) body.profil = f.profil;
    const { data } = await sok(body);
    const utfall = data?.utfall ?? (data?.pinpoint === true ? 'PINPOINT' : data?.pinpoint === false ? 'VERIFY' : 'FALLBACK');
    const valgt = norm(data?.eurokode ?? data?.anbefaling?.eurokode ?? '');
    const gyldig = (f.gyldigeKoder ?? []).map(norm);
    const treff = gyldig.includes(valgt) || gyldig.some((g) => base8(g) === base8(valgt) && base8(valgt).length >= 8);
    const ok = utfall === 'PINPOINT' && treff;
    if (!ok) {
      feil++;
      if (feil <= 10) console.error(`  ✗ ${f.bil}: utfall=${utfall} valgt=${valgt} gyldige=[${gyldig.join(',')}]`);
    }
    t.diagnostic(`${i + 1}/${fasiter.length} ${ok ? '✓' : '✗'} ${f.bil}`);
  }
  assert.equal(feil, 0, `${feil}/${fasiter.length} fasiter brutt mot ${BASE}`);
});
