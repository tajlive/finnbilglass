import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordTreff, likePrefiks, modelTokensAv, tierPris } from '../src/matcher.ts';

// ── ordTreff ────────────────────────────────────────────────────────────────
test('ordTreff: eksakt ord-treff', () => {
  assert.equal(ordTreff('VW TRANSP+CARAVELLE T5 2003-', 'T5'), true);
  assert.equal(ordTreff('TOYOTA YARIS', 'YARIS'), true);
  assert.equal(ordTreff('VOLVO V70', 'V70'), true);
});

test('ordTreff: prefiks-treff for ord ≥4 tegn (katalogforkortelser)', () => {
  assert.equal(ordTreff('VW TRANSP+CARAVELLE T5 2003-', 'TRANSPORTER'), true); // TRANSP ⊂ TRANSPORTER
  assert.equal(ordTreff('VW TRANSPORTER 2018', 'TRANSP'), true); // motsatt vei
  assert.equal(ordTreff('VW TRANSP+CARAVELLE', 'CARAVELLE'), true); // CARAV
});

test('ordTreff: korte tokens krever EKSAKT — CLA matcher IKKE CLASS/ACCLAIM/S-CLASS', () => {
  assert.equal(ordTreff('MERCEDES S-CLASS W222', 'CLA'), false);
  assert.equal(ordTreff('MERCEDES CLA 200 D', 'CLA'), true);
  assert.equal(ordTreff('PLYMOUTH ACCLAIM', 'CLA'), false);
  assert.equal(ordTreff('MERCEDES C-CLASS', 'CLA'), false);
});

test('ordTreff: tomme input', () => {
  assert.equal(ordTreff('', 'X'), false);
  assert.equal(ordTreff('BMW 320', ''), false);
  assert.equal(ordTreff(null, 'X'), false);
});

// ── likePrefiks ─────────────────────────────────────────────────────────────
test('likePrefiks: 5-tegns seed-prefiks for å treffe forkortelser', () => {
  assert.equal(likePrefiks('TRANSPORTER'), 'TRANS');
  assert.equal(likePrefiks('CARAVELLE'), 'CARAV');
  assert.equal(likePrefiks('T5'), 'T5'); // kort → uendret
  assert.equal(likePrefiks('X 5 SERIES'), 'X 5 SERIES'); // kort første token → hele strengen
});

// ── modelTokensAv ───────────────────────────────────────────────────────────
test('modelTokensAv: fjerner duplikat merke-token', () => {
  const t = modelTokensAv('NISSAN LEAF', 'NISSAN');
  assert.ok(!t.includes('NISSAN'));
  assert.ok(t.includes('LEAF'));
});

test('modelTokensAv: BMW M-prefiks-alias (M550D → 550D)', () => {
  const t = modelTokensAv('M550D', 'BMW');
  assert.ok(t.includes('550D'), 'katalogen skriver uten M');
  assert.ok(t.includes('M550D'), 'original-token beholdes');
});

test('modelTokensAv: matcher.ts beholder effekt-tokens (vin-resolveren filtrerer dem)', () => {
  // matcher.ts sin modellTokensAv er rå token-utvinning; KW/effekt-filtrering
  // skjer i vin-resolver.ts sin strengere variant — dette er dokumentert atferd.
  const t = modelTokensAv('ID.4 PRO 150 KW', 'VW');
  assert.ok(t.includes('ID'), 'ID.4 → ID');
  assert.ok(t.includes('PRO'));
});

// ── tierPris (Tom 2026-08-13: listepris × 0,60 → rund NED til tier) ─────────
test('tierPris: ×0,60 rundet ned til nærmeste tier', () => {
  // 9980 × 0,60 = 5988 → tier 5490
  assert.equal(tierPris(9980), 5490);
  // 6650 × 0,60 = 3990 → tier 3990
  assert.equal(tierPris(6650), 3990);
  // 9150 × 0,60 = 5490 → tier 5490
  assert.equal(tierPris(9150), 5490);
  // 11650 × 0,60 = 6990 → tier 6990
  assert.equal(tierPris(11650), 6990);
  // 14150 × 0,60 = 8490 → tier 8490
  assert.equal(tierPris(14150), 8490);
});

test('tierPris: over høyeste tier → null (spesial/pris på forespørsel)', () => {
  // 15000 × 0,60 = 9000 > 8490 → spesial (Tom: 5. prisgruppe «pris på forespørsel»)
  assert.equal(tierPris(15000), null);
  assert.equal(tierPris(20000), null); // 12000 → spesial
  // Grensetilfelle: 14152 × 0,60 = 8491,2 > 8490 → spesial; 14150 × 0,60 = 8490 → tier 8490
  assert.equal(tierPris(14152), null);
});

test('tierPris: under laveste tier eller ugyldig → null', () => {
  assert.equal(tierPris(6000), null); // 3600 < 3990
  assert.equal(tierPris(0), null);
  assert.equal(tierPris(null), null);
  assert.equal(tierPris(-5), null);
});
