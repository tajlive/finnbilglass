/**
 * Glassposisjon — enhetstester med ekte rader fra produksjons-D1 (2026-10-31).
 *
 * Reglene som testes er de som koster penger å bryte: feil posisjon = feil glass
 * til kunde. Testene bruker varenr/navn/eurokode som faktisk finnes i katalogen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klassifiserGlass } from '../src/glass-posisjon.ts';

const k = (navn, varenr, euro) => klassifiserGlass(navn, varenr, euro);

test('Jaguar-dørrute (Toms sak): type dør, side venstre, ikke frontrute', () => {
  const r = k('JAGUAR F-PACE 5D SUV 16-  DØRRUTE', '30971GN', '4340LGSR5FD1M');
  assert.equal(r.type, 'dor');
  assert.equal(r.side, 'venstre', 'eurokode L = venstre side');
  assert.equal(r.erFrontrute, false);
  // «fremre» finnes ikke i våre data — bare i varekortets typekode
  assert.equal(r.dorLedd, null);
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
