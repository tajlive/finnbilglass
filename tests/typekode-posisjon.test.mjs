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
import { fraTypekode, klassifiserGlass, filtrerPaPosisjon } from '../src/glass-posisjon.ts';
import { utfallFor } from '../src/routes/admin-katalog.ts';

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
  // Venstrestyrt: fører = venstre
  assert.equal(fraTypekode('DFF', 'venstre').fysiskSide, 'venstre');
  // Høyrestyrt: fører = høyre — samme kode, motsatt fysisk side
  assert.equal(fraTypekode('DFF', 'hoyre').fysiskSide, 'hoyre');
  // Passasjer på høyrestyrt bil er fysisk venstre
  assert.equal(fraTypekode('DPF', 'hoyre').fysiskSide, 'venstre');
  // Kildenbetegnelsen endres aldri av styretypen
  assert.equal(fraTypekode('DFF', 'hoyre').side, 'forer');
});

test('ukjent styretype gir ingen fysisk side — aldri gjettet', () => {
  const u = fraTypekode('DFF');
  assert.equal(u.fysiskSide, null, 'uten styretype finnes ingen fysisk side');
  assert.equal(u.fysiskSideKreverAvklaring, true);
  assert.equal(u.side, 'forer', 'fører/passasjer er kjent selv om fysisk side er ukjent');
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

test('karosseritype alene velger aldri dørledd', () => {
  // 5-dørs bil uten typekode: karosseriet sier at bilen HAR begge dører,
  // men ikke hvilken av dem dette glasset er.
  const golf = klassifiserGlass('VW GOLF V 5D DØRRUTE VS', '12345', '1234AGN', null);
  assert.equal(golf.dorLedd, null, 'uten typekode er leddet ukjent');

  const med = klassifiserGlass('VW GOLF V 5D DØRRUTE VS', '12345', '1234AGN', 'DFB');
  assert.equal(med.dorLedd, 'bakre');

  // 3-dørs bil: fortsatt ingen automatisk fremre ledd
  const tredor = klassifiserGlass('VW UP 3D DØRRUTE VS', '22345', '2234AGN', null);
  assert.equal(tredor.dorLedd, null);
});

test('katalogsøk kan aldri gi EXACT', () => {
  // Én kandidat med både pris og egenskaper er fortsatt bare et forslag.
  assert.notEqual(utfallFor(1, true, true), 'EXACT');
  assert.equal(utfallFor(1, true, true), 'PROVISIONAL');
  assert.equal(utfallFor(3, true, true), 'AMBIGUOUS');
  assert.equal(utfallFor(0, false, false), 'MANUAL_REVIEW');
});

test('konfliktstatus følger med i resultatet', () => {
  const ok = klassifiserGlass('FIAT PANDA FRONTRUTE', '10025GN', '1002AGN', 'F');
  assert.equal(ok.typekodeKonflikt, false);

  const konflikt = klassifiserGlass('FIAT PANDA BAKRUTE', '10025C', '1002AGN', 'F');
  assert.equal(konflikt.typekodeKonflikt, true, 'motstrid skal flagges i resultatet');
  assert.equal(konflikt.erFrontrute, false);
});

test('posisjonsfilter fjerner bare beviselig feil plass', () => {
  const kandidater = [
    { varenr: '1', typekode: 'DFF' },
    { varenr: '2', typekode: 'DFB' },
    { varenr: '3', typekode: 'SFB1' },
    { varenr: '4', typekode: 'SFB2' },
    { varenr: '5', typekode: null },
  ];
  // Fremre dørrute: bare DFF
  assert.deepEqual(filtrerPaPosisjon(kandidater, { glassklasse: 'dor', dorLedd: 'fremre' }).map((k) => k.varenr), ['1']);
  // Siderute uten nummer: beholder 1, 2 og 3
  assert.deepEqual(filtrerPaPosisjon(kandidater, { glassklasse: 'side' }).map((k) => k.varenr), ['3', '4']);
  // Siderute nummer 2: bare den
  assert.deepEqual(filtrerPaPosisjon(kandidater, { glassklasse: 'side', sideruteNummer: 2 }).map((k) => k.varenr), ['4']);
  // Uten ønske: alt beholdes, også rader uten plassering
  assert.equal(filtrerPaPosisjon(kandidater, null).length, 5);
  // Tomt ønske filtrerer ikke
  assert.equal(filtrerPaPosisjon(kandidater, {}).length, 5);
});
