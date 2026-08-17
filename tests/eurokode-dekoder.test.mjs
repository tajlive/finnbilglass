import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dekodeEurokode, katalogKode } from '../src/eurokode-dekoder.ts';

test('dekodeEurokode: posisjonsbokstav → glassposisjon', () => {
  assert.equal(dekodeEurokode('8579AGSGYAVZ1B').posisjon, 'frontrute');
  assert.equal(dekodeEurokode('1234BGN').posisjon, 'bakrute');
  assert.equal(dekodeEurokode('1234LGN').posisjon, 'dorrute-venstre');
  assert.equal(dekodeEurokode('1234RGN').posisjon, 'dorrute-hoyre');
  assert.equal(dekodeEurokode('1234FGN').posisjon, 'ventilrute');
  assert.equal(dekodeEurokode('1234SGN').posisjon, 'siderute');
});

test('dekodeEurokode: egenskapssemantikk (Tom 2026-08-13)', () => {
  // M = regnsensor, S = solar (IKKE sensor), C = coated, A = antenne, H = oppvarmet, EL = elektrisk
  assert.ok(dekodeEurokode('1234AMGN').egenskaper.includes('sensor'), 'M = regnsensor');
  assert.ok(dekodeEurokode('8579AGSGYAVZ1B').egenskaper.includes('solar'), 'S = solar');
  assert.ok(dekodeEurokode('8579AGSGYAVZ1B').egenskaper.includes('antenne'), 'A = antenne');
  assert.ok(dekodeEurokode('8567ACCGYVZ1B').egenskaper.includes('coated'), 'C = coated');

  const h = dekodeEurokode('1234AAH').egenskaper;
  assert.ok(h.includes('oppvarmet'), 'H = oppvarmet');
  assert.ok(h.includes('antenne'), 'A = antenne');

  const el = dekodeEurokode('1234AEL').egenskaper;
  assert.ok(el.includes('elektrisk'), 'EL = elektrisk');
});

test('dekodeEurokode: S betyr solar, IKKE sensor (Tom-korreksjon)', () => {
  const d = dekodeEurokode('1234AGS');
  assert.ok(!d.egenskaper.includes('sensor'), 'S må IKKE tolkes som sensor');
  assert.ok(d.egenskaper.includes('solar'));
});

test('dekodeEurokode: fargetoner', () => {
  assert.match(dekodeEurokode('8579AGSGYAVZ1B').fargetone ?? '', /GY/);
  assert.match(dekodeEurokode('1234AGN').fargetone ?? '', /GN/);
  assert.match(dekodeEurokode('1234AGG').fargetone ?? '', /GG/);
  assert.match(dekodeEurokode('1234ABL').fargetone ?? '', /BL/);
  assert.match(dekodeEurokode('1234ABZ').fargetone ?? '', /BZ/);
  assert.match(dekodeEurokode('1234ACL').fargetone ?? '', /CL/);
  assert.equal(dekodeEurokode('1234AXYZ').fargetone, null);
});

test('dekodeEurokode: uten katalogkode → null-posisjon, aldri gjett', () => {
  // OEM-delnummer, plassholdere, 2-sifrede veteran-koder og US-koder har ingen
  // pålitelig posisjon — «B» i «BYTTNR» er IKKE bakrute.
  assert.equal(dekodeEurokode('7H0877051').posisjon, null);
  assert.equal(dekodeEurokode('BYTTNR').posisjon, null);
  assert.equal(dekodeEurokode('42C').posisjon, null);
  assert.equal(dekodeEurokode('W946GB').posisjon, null);
  assert.equal(dekodeEurokode(null).posisjon, null);
  assert.equal(dekodeEurokode(undefined).posisjon, null);
});

test('dekodeEurokode: egenskaper er unike', () => {
  const d = dekodeEurokode('1234ACSAM');
  assert.equal(new Set(d.egenskaper).size, d.egenskaper.length);
});

test('dekodeEurokode: CL (klar fargetone) er IKKE coated (Tom-regel C=coated, CL=klar)', () => {
  // 550+ veteran-koder slutter på ACL — «C» i «CL» er fargetone, ikke coating.
  const acl = dekodeEurokode('2205ACL'); // AUSTIN A40 — klart glass
  assert.ok(!acl.egenskaper.includes('coated'), 'ACL = klar fargetone, ikke coated');
  assert.match(acl.fargetone ?? '', /CL/);
  // Ekte coating beholder C etter fargetone-stripp:
  assert.ok(dekodeEurokode('8567ACCGYVZ1B').egenskaper.includes('coated')); // AUDI S6 COATED
  assert.ok(dekodeEurokode('2727ACCMV1B').egenskaper.includes('coated'));   // CITROEN C5 COATED
  assert.ok(dekodeEurokode('2426AKCS').egenskaper.includes('coated'));      // AKCS = antenne+coated+solar
  assert.ok(dekodeEurokode('2426AKCS').egenskaper.includes('solar'));       // S etter stripp = solar
});

test('katalogKode: ledende siffer-sekvens', () => {
  assert.equal(katalogKode('8579AGSGYAVZ1B'), '8579');
  assert.equal(katalogKode('1234AGN'), '1234');
  assert.equal(katalogKode('123A'), '123');
  assert.equal(katalogKode('12345AG'), '12345');
  assert.equal(katalogKode(null), null);
  assert.equal(katalogKode(''), null);
  assert.equal(katalogKode('ABC123'), null); // ingen ledende sifre
});
