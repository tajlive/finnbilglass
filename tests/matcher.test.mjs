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

// ── Kundepris (Tom 2026-10-29: XLS-pris eks. mva × 0,25 × 1,25) ────────────
// Den gamle 0,60-faktoren med faste trinn (3 990/5 490/6 990/8 490) er fjernet
// 2026-11-04: den viste 5 490 kr der riktig estimat er 3 357,81 kr, og sendte
// varianter over høyeste trinn til «Pris på forespørsel».
test('kundepris: listepris eks. mva × 0,25 × 1,25, avrundet til øre', () => {
  assert.equal(tierPris(10745), 3357.81);   // RAV4 8432AGACMV1L
  assert.equal(tierPris(19425), 6070.31);   // RAV4 8432AGACHMV1L
  assert.equal(tierPris(14860), 4643.75);   // RAV4 8432AGACHMV30
  assert.equal(tierPris(9980), 3118.75);    // VW T5-gulvet
  assert.equal(tierPris(1000), 312.5);
});

test('kundepris: ingen øvre eller nedre prisgrense', () => {
  // 20 000 × 0,25 × 1,25 = 6 250 — tidligere «Pris på forespørsel» (over 8 490).
  assert.equal(tierPris(20000), 6250);
  // 1 kr er nok til å regne en pris; gulvet er borte.
  assert.equal(tierPris(1), 0.31);
});

test('kundepris: ugyldig grunnlag gir null', () => {
  assert.equal(tierPris(0), null);
  assert.equal(tierPris(null), null);
  assert.equal(tierPris(-5), null);
  assert.equal(tierPris(Number.NaN), null);
});
