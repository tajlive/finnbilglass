// glass-kandidat-vurdering: skiller ukjent, dokumentert mengde og konflikt.
// Disse testene låser kontrakten som valgtre, resultat og servervalidering deler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vurderFelt, feltVerdier } from '../src/glass-kandidat-vurdering.ts';

function kand({ varenr = 'X1', varenavn = 'TEST', type = 'dor', side = null, dorLedd = null, ventilLedd = null, konflikt = false } = {}) {
  return {
    eurokode: varenr,
    varenr,
    varenavn,
    features: [],
    source: 'GT_AUTO_PRISLISTE',
    klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE',
    matchReason: '',
    merke: 'TEST',
    familie: 'TEST',
    aarFra: 2000,
    aarTil: null,
    generasjon: null,
    posisjon: { type, side, dorLedd, ventilLedd, konflikt },
  };
}

// ── vurderFelt — den felles avgjørelsen ──────────────────────────────────

test('vurderFelt: null mengde er ukjent, uansett valg', () => {
  assert.equal(vurderFelt(null, 'left', false), 'ukjent');
  assert.equal(vurderFelt([], 'left', false), 'ukjent');
  assert.equal(vurderFelt(['left'], null, false), 'ukjent');
  assert.equal(vurderFelt(['left'], 'unknown', false), 'ukjent');
});

test('vurderFelt: konflikt vinner over alt', () => {
  assert.equal(vurderFelt(['left'], 'left', true), 'konflikt');
  assert.equal(vurderFelt(null, null, true), 'konflikt');
});

test('vurderFelt: medlemskap avgjør støtte/motstrid', () => {
  assert.equal(vurderFelt(['left'], 'left', false), 'stotte');
  assert.equal(vurderFelt(['left'], 'right', false), 'motstrid');
});

test('vurderFelt: begge sider støtter begge, men ikke andre felt', () => {
  assert.equal(vurderFelt(['left', 'right'], 'left', false), 'stotte');
  assert.equal(vurderFelt(['left', 'right'], 'right', false), 'stotte');
  assert.equal(vurderFelt(['left', 'right'], 'front', false), 'motstrid');
});

test('vurderFelt: SED+STV støtter sedan og stasjonsvogn, ikke coupé', () => {
  assert.equal(vurderFelt(['sedan', 'estate'], 'sedan', false), 'stotte');
  assert.equal(vurderFelt(['sedan', 'estate'], 'estate', false), 'stotte');
  assert.equal(vurderFelt(['sedan', 'estate'], 'coupe', false), 'motstrid');
});

// ── feltVerdier — konkrete verdimengder ──────────────────────────────────

test('feltVerdier: side «begge» er en dokumentert mengde, ikke null', () => {
  assert.deepEqual(feltVerdier(kand({ side: 'begge' }), 'side').verdier, ['left', 'right']);
});

test('feltVerdier: side null er ukjent', () => {
  assert.deepEqual(feltVerdier(kand({ side: null }), 'side'), { verdier: null, konflikt: false });
});

test('feltVerdier: side venstre/høyre er entydige', () => {
  assert.deepEqual(feltVerdier(kand({ side: 'venstre' }), 'side').verdier, ['left']);
  assert.deepEqual(feltVerdier(kand({ side: 'hoyre' }), 'side').verdier, ['right']);
});

test('feltVerdier: dørledd fremre/bakre er entydige', () => {
  assert.deepEqual(feltVerdier(kand({ dorLedd: 'fremre' }), 'door').verdier, ['front']);
  assert.deepEqual(feltVerdier(kand({ dorLedd: 'bakre' }), 'door').verdier, ['rear']);
  assert.deepEqual(feltVerdier(kand({ dorLedd: null }), 'door').verdier, null);
});

test('feltVerdier: SED+STV gir konkret mengde, ikke null', () => {
  assert.deepEqual(feltVerdier(kand({ varenavn: 'VOLVO V70 4D SED+5D STV 08-' }), 'body').verdier, ['sedan', 'estate']);
});

test('feltVerdier: karosseri mangler gir ukjent', () => {
  assert.deepEqual(feltVerdier(kand({ varenavn: 'VOLVO V70 4D 08-' }), 'body').verdier, null);
});

test('feltVerdier: kildekonflikt gjør feltet ubeviselig', () => {
  assert.deepEqual(feltVerdier(kand({ side: 'venstre', konflikt: true }), 'side'), { verdier: null, konflikt: true });
});
