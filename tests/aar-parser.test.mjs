import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAar, matcherAar } from '../src/aar-parser.ts';

test('parseAar: 4-sifret intervall', () => {
  assert.deepEqual(parseAar('VW GOLF 1997-2003'), { start: 1997, slutt: 2003 });
  assert.deepEqual(parseAar('OPEL ASTRA 04-08'), { start: 2004, slutt: 2008 });
});

test('parseAar: åpen intervall (X-)', () => {
  assert.deepEqual(parseAar('VW TRANSP+CARAVELLE T5 2003-'), { start: 2003, slutt: Infinity });
  assert.deepEqual(parseAar('VOLVO V70 98-'), { start: 1998, slutt: Infinity });
  // «12-SEPT15»: parseren leser «12-» som åpen intervall fra 2012 (måneds-
  // suffikset gir ikke sluttår — dokumentert tolkning, ikke en bug).
  assert.deepEqual(parseAar('TOYOTA AYGO 12-SEPT15'), { start: 2012, slutt: Infinity });
});

test('parseAar: 2-sifret enkeltår', () => {
  assert.deepEqual(parseAar('FIAT 600 61'), { start: 1961, slutt: 1961 });
  assert.deepEqual(parseAar('BMW 3 79-86'), { start: 1979, slutt: 1986 });
  // Enslig 4-sifret år uten bindestrek gir null (parseren krever intervall-
  // mønster for 4 sifre; «1963» alene er ikke et uttrykt intervall).
  assert.equal(parseAar('RENAULT 4 1963'), null);
});

test('parseAar: ingen år → null', () => {
  assert.equal(parseAar(null), null);
  assert.equal(parseAar(''), null);
  assert.equal(parseAar('MERCEDES W204'), null);
  assert.equal(parseAar('SENSORGEL'), null);
});

test('parseAar: ikke forveksle modell-sifre med år', () => {
  // «200» i «CLA 200 D» er motorstørrelse, ikke år — men parseren treffer KUN
  // på år-mønstre (4-sifret heltall alene med bindestrek osv.)
  assert.equal(parseAar('MERCEDES CLA 200 D'), null);
  assert.equal(parseAar('BMW 525D'), null);
});

test('matcherAar: inneholder bilens år?', () => {
  assert.equal(matcherAar({ start: 2003, slutt: Infinity }, 2005), true);
  assert.equal(matcherAar({ start: 2003, slutt: Infinity }, 2026), true);
  assert.equal(matcherAar({ start: 2003, slutt: Infinity }, 2002), false);
  assert.equal(matcherAar({ start: 1997, slutt: 2003 }, 2000), true);
  assert.equal(matcherAar({ start: 1997, slutt: 2003 }, 2004), false);
  assert.equal(matcherAar(null, 2005), true); // ukjent intervall → ikke ekskluder
  assert.equal(matcherAar({ start: 2003, slutt: Infinity }, null), true); // ukjent år → ikke ekskluder
});
