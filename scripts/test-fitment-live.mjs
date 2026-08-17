#!/usr/bin/env node
/**
 * FITMENT TRUTH BASELINE — live drift-lane (Phase A0).
 *
 * Måler drift mellom produksjonskjeden og GOLDEN-fasiten.
 * SKAL IKKE kjøres i vanlig unit-CI (nettavhengig: prod-API + SVV).
 * Kjør eksplisitt: `npm run test:fitment:live`
 *
 * Exit-koder (skiller fitment-drift fra infrastrukturfeil):
 *   0 = ingen drift (eller kun dokumentert forventet drift)
 *   1 = fitment-drift påvist (kode/data/virkelighet er ute av synk)
 *   2 = infrastruktur-/nettverksfeil (kunne ikke teste)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL ?? 'https://finnbilglass.no';
const golden = JSON.parse(readFileSync(join(ROOT, 'data', 'fitment-golden.json'), 'utf8'));

const utfallTilDecision = (u) => (u === 'PINPOINT' ? 'AUTO_MATCH' : u === 'VERIFY' ? 'NEEDS_CONFIRMATION' : 'MANUAL_REVIEW');

async function sok(regnr) {
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr }),
  });
  if (!r.ok) return { http: r.status, data: null };
  return { http: r.status, data: await r.json() };
}

let drift = 0;
let infraFeil = 0;
const rapporter = [];

for (const f of golden.fixtures) {
  if (!f.regnr) continue;
  let svar;
  try {
    svar = await sok(f.regnr);
  } catch (e) {
    infraFeil++;
    rapporter.push({ id: f.id, status: 'INFRA_FEIL', detail: e.message });
    console.log(`⚠ ${f.id}: INFRA_FEIL — ${e.message}`);
    continue;
  }
  if (svar.http >= 500 || !svar.data) {
    infraFeil++;
    rapporter.push({ id: f.id, status: 'INFRA_FEIL', detail: `HTTP ${svar.http}` });
    console.log(`⚠ ${f.id}: INFRA_FEIL — HTTP ${svar.http}`);
    continue;
  }
  const res = svar.data?.resolver;
  const naavaerende = utfallTilDecision(res?.utfall);
  const goldenDecision = f.expectedDecision;
  const eurokode = res?.eurokode ?? null;
  const kandidater = (res?.kandidater ?? []).map((k) => k.varenr ?? k.eurokode ?? '?');

  // Sikkerhetsrekkefølge (synkende visshet): AUTO_MATCH > NEEDS_CONFIRMATION > MANUAL_REVIEW.
  const RANK = { AUTO_MATCH: 2, NEEDS_CONFIRMATION: 1, MANUAL_REVIEW: 0 };
  const eurokodeDrift = goldenDecision === 'AUTO_MATCH' && f.expectedEurocode && eurokode !== f.expectedEurocode;
  const avvik = naavaerende !== goldenDecision || eurokodeDrift;
  // Farlig drift = prod ER sikrere enn golden (falsk sikkerhet). Sikker drift = prod mer konservativ.
  const retning = RANK[naavaerende] > RANK[goldenDecision] ? 'FARLIG' : avvik ? 'SIKKER' : '—';

  rapporter.push({ id: f.id, status: avvik ? 'DRIFT' : 'OK', retning, naavaerende, goldenDecision, eurokode, kandidater });
  if (avvik) {
    drift++;
    console.log(`✗ DRIFT(${retning}) ${f.id}: prod=${naavaerende} (${res?.grunn ?? ''}) golden=${goldenDecision} eurokode=${eurokode ?? 'null'} kandidater=[${kandidater.join(', ')}]`);
  } else {
    console.log(`✓ OK ${f.id}: prod=${naavaerende} golden=${goldenDecision} (${res?.grunn ?? ''})`);
  }
}

console.log('\n=== FITMENT TRUTH BASELINE — LIVE DRIFT-RAPPORT ===');
console.log(JSON.stringify({ base: BASE, tid: new Date().toISOString(), drift, infraFeil, rapporter }, null, 2));

if (infraFeil > 0) process.exit(2);   // kunne ikke teste — infrastruktur
process.exit(drift > 0 ? 1 : 0);      // 1 = fitment-drift, 0 = OK
