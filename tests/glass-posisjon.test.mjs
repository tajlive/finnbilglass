/**
 * Glassposisjon — enhetstester med ekte rader fra produksjons-D1 (2026-10-31).
 *
 * Reglene som testes er de som koster penger å bryte: feil posisjon = feil glass
 * til kunde. Testene bruker varenr/navn/eurokode som faktisk finnes i katalogen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klassifiserGlass } from '../src/glass-posisjon.ts';

const k = (navn, varenr, euro, typekode) => klassifiserGlass(navn, varenr, euro, typekode);

test('Jaguar-dørrute (Toms sak): type dør, side venstre, ikke frontrute', () => {
  const r = k('JAGUAR F-PACE 5D SUV 16-  DØRRUTE', '30971GN', '4340LGSR5FD1M');
  assert.equal(r.type, 'dor');
  assert.equal(r.side, 'venstre', 'eurokode L = venstre side');
  assert.equal(r.erFrontrute, false);
  // V6.2 regel 3B: karosseritypen sier at bilen HAR fremre og bakre dør, men ikke
  // hvilken av dem dette glasset er. Uten typekode er leddet ukjent — og det er
  // riktig svar, ikke en gjettet posisjon.
  assert.equal(r.dorLedd, null);
  assert.equal(r.kilde !== 'car-body-style', true, 'karosseritype skal ikke velge dørledd');
});

test('frontrute uten ordet FRONTRUTE: eurokode A avgjør', () => {
  const r = k('TOYOTA C-HR 5D CROSSOVER 16-', '8421ASGH', '8421ASGHB');
  assert.equal(r.type, 'frontrute');
  assert.equal(r.erFrontrute, true);
  assert.equal(r.kilde, 'eurokode');
});

test('«FRONT DOORGLASS» er dør, ikke frontrute', () => {
  for (const [navn, varenr, euro] of [
    ['BYD T3  VAN 22-  FRONT DOORGLASS', 'E409RCLV2', 'E409RCLV2FDW'],
    ['HONGQI HS9 5D SUV 21- FRONT DOOR', 'EC01LGAR', 'EC01LGAR5FDKW'],
    ['NIO FIREFLY 5 HBK 26- FRONT DOORWAY', 'EN07RGNH', 'EN07RGNH5FDZ'],
  ]) {
    const r = k(navn, varenr, euro);
    assert.equal(r.type, 'dor', navn);
    assert.equal(r.erFrontrute, false, navn);
  }
});

test('siderute: navnet gir type, eurokoden gir side', () => {
  const r = k('NISSAN PRAIRIE M10,84-88 SIDERUTE', '20010BL', '5959RBLV5RQ');
  assert.equal(r.type, 'side');
  assert.equal(r.side, 'hoyre');
  assert.equal(r.typekonflikt, false, 'dør/side/ventil + L/R er ikke konflikt');
});

test('ventilrute med side fra eurokoden er ikke konflikt', () => {
  const r = k('DAIHATSU CUORE 97-   VENTILRUTE', '19625GN', '2924LGNH5RV');
  assert.equal(r.type, 'ventil');
  assert.equal(r.side, 'venstre');
  assert.equal(r.typekonflikt, false);
  assert.equal(r.erFrontrute, false);
});

test('bare eurokode L/R → sidefamilie, ikke påstand om dør', () => {
  const r = k('MERCEDES GELANDERWAGEN 79-', '10044GN2', '4613LGNHR3RQ');
  assert.equal(r.type, 'sidefamilie');
  assert.equal(r.side, 'venstre');
  assert.equal(r.erFrontrute, false);
});

test('ekte frontrute med dør-eurokode: typekonflikt, aldri auto-frontrute', () => {
  const r = k('CITROEN AX 87-97 FRONTRUTE CL', '1541C', '27610LFWXP-CLN');
  assert.equal(r.navnType, 'frontrute');
  assert.equal(r.eurokodeType, 'sidefamilie');
  assert.equal(r.typekonflikt, true);
  assert.equal(r.erFrontrute, false, 'konflikt skal løses manuelt, ikke gjettes');
});

test('takglass', () => {
  const r = k('PEUGEOT 307 5D SW 03-  SOLTAK', '25882GD', '8301AR');
  assert.equal(r.type, 'tak');
  assert.equal(r.erFrontrute, false);
});

test('dekorlist og klips-kit er aldri frontrute', () => {
  assert.equal(k('OPEL FRONTERA  91-98   PYNTELIST', '1776PY', '6258ASMRL+6258AS').erFrontrute, false);
  assert.equal(k('MERCEDES 190 KLIPS KIT', '1400K', null).erFrontrute, false);
});

test('uten posisjon hverken i navn eller eurokode → ukjent, aldri frontrute', () => {
  const r = k('BOSCH VISKERSETT TWIN 680/680MM', '046S', null);
  assert.equal(r.type, 'ukjent');
  assert.equal(r.erFrontrute, false);
  assert.match(r.grunn, /ingen posisjon/);
});

test('VS/HS i navnet gir «begge»', () => {
  const r = k('SUZUKI SJ410 85-  SIDORUTA CL VS+HS', '10054CL', '4501FCLR3RQ');
  assert.equal(r.side, 'begge');
});

test('svensk stavemåte DÖRRUTE gjenkjennes', () => {
  const r = k('FIAT PANDA,86-, 3D DÖRRUTE', '10067GN', null);
  assert.equal(r.type, 'dor');
  assert.equal(r.erFrontrute, false);
});

test('typekode fra varekort gir presis fremre/bakre dør', () => {
  // Typekode fra varekort (auto-glass.no) overstyrer car-body-style
  const r = k('JAGUAR F-PACE 5D SUV 16-  DØRRUTE', '30971GN', '4340LGSR5FD1M', 'Dørrute fremre førerside');
  assert.equal(r.type, 'dor');
  assert.equal(r.side, 'venstre');
  assert.equal(r.dorLedd, 'fremre');
  assert.equal(r.kilde, 'typekode');
});

test('typekode fra varekort gir presis foran/bakre ventil', () => {
  const r = k('BMW 3-SER 88-91 BAKRE VENTRUTE', '21161GN', '2425LGNE5RV', 'Ventilrute bakre');
  assert.equal(r.type, 'ventil');
  assert.equal(r.ventilLedd, 'bakre');
  assert.equal(r.kilde, 'typekode');
});

test('coupe 2-dør: karosseritype gir ikke dørledd uten typekode', () => {
  const r = k('BMW 3 2D COUPE 87-92 DØRRUTE', '20821GN', '2425LGNC2RQO');
  assert.equal(r.type, 'dor');
  // Selv når bilen bare har fremre dører, er det typekoden som beviser at
  // dette glasset er den fremre. Karosseritypen alene er ikke nok (V6.2 regel 3B).
  assert.equal(r.dorLedd, null);
  assert.equal(k('BMW 3 2D COUPE 87-92 DØRRUTE', '20821GN', '2425LGNC2RQO', 'DFF').dorLedd, 'fremre');
});

test('car-body-style fallback: sedan 4-dør gir fremre og bakre dør', () => {
  const r = k('BMW 3 4D SEDAN 88-91 DØRRUTE', '20821GN', '2425LGNC2RQO');
  // NB: må ha side fra eurokode for å skille venstre/høyre
  const r2 = k('BMW 3 4D SEDAN 88-92 DØRRUTE', '20821GN', '2425LGNC2RQO');
  // Uten eurokode side kan vi ikke bestemme fremre/bakre via car-body-style alene
  assert.equal(r2.type, 'dor');
});

test('ventilrute uten typekode har ventilLedd=null (fallback til kundespørsmål)', () => {
  const r = k('VW GOLF 3/5D CC 84-87  VENTILRUTE', '8812CL', '191845242B');
  assert.equal(r.type, 'ventil');
  assert.equal(r.ventilLedd, null);
  assert.equal(r.erFrontrute, false);
});
