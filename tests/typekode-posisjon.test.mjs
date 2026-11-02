/**
 * Typekode → posisjon. Tester mot de 18 kodene som faktisk finnes i
 * `glass_typekode` (20 601 rader, staging 2026-11-02).
 *
 * Det som testes er det som koster penger å ta feil av:
 * fremre vs bakre dør, ventil vs dør, siderute-nummer, delt bakrute,
 * og at fører/passasjer aldri likestilles med venstre/høyre uten at
 * styretypen er kjent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fraTypekode, klassifiserGlass } from '../src/glass-posisjon.ts';

test('frontrute og bakrute', () => {
  assert.equal(fraTypekode('F').type, 'frontrute');
  assert.equal(fraTypekode('B').type, 'bakrute');
  assert.equal(fraTypekode('f').type, 'frontrute', 'små bokstaver skal normaliseres');
  assert.equal(fraTypekode(' F ').type, 'frontrute', 'mellomrom skal trimmes');
});

test('fremre og bakre dørrute skilles for begge sider', () => {
  const dff = fraTypekode('DFF');
  assert.equal(dff.type, 'dor');
  assert.equal(dff.dorLedd, 'fremre');
  assert.equal(dff.side, 'forer');

  const dfb = fraTypekode('DFB');
  assert.equal(dfb.dorLedd, 'bakre');
  assert.equal(dfb.side, 'forer');

  const dpf = fraTypekode('DPF');
  assert.equal(dpf.dorLedd, 'fremre');
  assert.equal(dpf.side, 'passasjer');

  const dpb = fraTypekode('DPB');
  assert.equal(dpb.dorLedd, 'bakre');
  assert.equal(dpb.side, 'passasjer');

  assert.notEqual(dff.dorLedd, dfb.dorLedd, 'DFF og DFB må aldri bli samme ledd');
});

test('ventilrute forveksles ikke med vanlig dørrute', () => {
  const dff = fraTypekode('DFF');
  const dffv = fraTypekode('DFFV');
  assert.equal(dff.type, 'dor');
  assert.equal(dffv.type, 'ventil');
  assert.notEqual(dff.type, dffv.type);
  assert.equal(dffv.ventilLedd, 'foran');
  assert.equal(fraTypekode('DFBV').ventilLedd, 'bakre');
  assert.equal(fraTypekode('DPFV').ventilLedd, 'foran');
  assert.equal(fraTypekode('DPBV').ventilLedd, 'bakre');
});

test('nummererte sideruter beholder posisjonen', () => {
  for (const n of [1, 2, 3]) {
    const f = fraTypekode(`SFB${n}`);
    const p = fraTypekode(`SPB${n}`);
    assert.equal(f.type, 'side');
    assert.equal(f.sideruteNummer, n);
    assert.equal(f.side, 'forer');
    assert.equal(p.sideruteNummer, n);
    assert.equal(p.side, 'passasjer');
  }
});

test('delt bakrute merkes som delt', () => {
  const bf = fraTypekode('BF');
  const bp = fraTypekode('BP');
  assert.equal(bf.type, 'bakrute');
  assert.equal(bf.deltBakrute, true);
  assert.equal(bf.side, 'forer');
  assert.equal(bp.side, 'passasjer');
  assert.equal(fraTypekode('B').deltBakrute, false, 'vanlig bakrute er ikke delt');
});

test('fører/passasjer er ikke det samme som venstre/høyre', () => {
  // Venstrestyrt (norsk standard): fører = venstre
  const lhd = fraTypekode('DFF', 'venstre');
  assert.equal(lhd.fysiskSide, 'venstre');
  assert.equal(lhd.fysiskSideAntatt, false);

  // Høyrestyrt: fører = høyre. Samme kode, motsatt fysisk side.
  const rhd = fraTypekode('DFF', 'hoyre');
  assert.equal(rhd.fysiskSide, 'hoyre');
  assert.equal(rhd.side, 'forer', 'kildebetegnelsen endres ikke av styretypen');
  assert.notEqual(lhd.fysiskSide, rhd.fysiskSide);

  // Ukjent styretype: aldri gjettet stille
  const ukjent = fraTypekode('DFF');
  assert.equal(ukjent.fysiskSideAntatt, true, 'antakelsen må være synlig');
});

test('ukjente koder tolkes ikke', () => {
  for (const kode of ['X', 'DF', 'SFB4', 'F1', 'ZZZ', '']) {
    assert.equal(fraTypekode(kode), null, `«${kode}» skal ikke gi posisjon`);
  }
  assert.equal(fraTypekode(null), null);
  assert.equal(fraTypekode(undefined), null);
});

test('typekode gir plassering der navnet alene ikke gjør det', () => {
  // Ekte rad fra katalogen: navnet sier ikke fremre/bakre.
  const uten = klassifiserGlass('VW GOLF 04- DØRRUTE VS', '12345', '1234AGN', null);
  assert.equal(uten.dorLedd, null, 'uten typekode er leddet ukjent');

  const med = klassifiserGlass('VW GOLF 04- DØRRUTE VS', '12345', '1234AGN', 'DFB');
  assert.equal(med.dorLedd, 'bakre');
  assert.equal(med.kilde, 'typekode');
});

test('typekode som motsier navnet gir konflikt, ikke automatisk valg', () => {
  // Navnet sier bakrute, typekoden sier frontrute → skal ikke bli erFrontrute
  const konflikt = klassifiserGlass('FIAT PANDA BAKRUTE', '10025C', '1002AGN', 'F');
  assert.equal(konflikt.typekonflikt || konflikt.grunn.includes('motsier'), true, konflikt.grunn);
  assert.equal(konflikt.erFrontrute, false, 'motstrid skal aldri gi frontrute');
});

test('riktig typekode gir frontrute uten konflikt', () => {
  const r = klassifiserGlass('FIAT PANDA FRONTRUTE', '10025GN', '1002AGN', 'F');
  assert.equal(r.type, 'frontrute');
  assert.equal(r.erFrontrute, true);
  assert.equal(r.typekode?.kode, 'F');
});
