// Årsmatrise: samme inndata, to kodeversjoner. Konstruerte tilfeller er merket.
import { vinModelYear } from '../src/vin-resolver.ts';
const V = (c) => 'XXXXXXXXX' + c + 'XXXXXXXXXX';
const cases = [
  ['ZZ33141 ekte VIN (siffer 1, reg 2021)',      'W1N1673171A365845', 2021],
  ['siffer 1, reg 2002 (grense ok)',             V('1'), 2002],
  ['siffer 1, reg 2012 (10 år, grense)',         V('1'), 2012],
  ['siffer 1, reg 2013 (11 år, forkastes)',      V('1'), 2013],
  ['siffer 5, reg 2006',                         V('5'), 2006],
  ['siffer 9, reg 2009',                         V('9'), 2009],
  ['bokstav K, reg 2024 (import 2019)',          V('K'), 2024],
  ['bokstav A, reg 2010',                        V('A'), 2010],
  ['bokstav A, reg 1995 (1980-syklusen)',        V('A'), 1995],
  ['bokstav R, reg 2024',                        V('R'), 2024],
  ['mangler VIN',                                null, 2021],
  ['for kort VIN',                               'ABC123', 2021],
  ['ugyldig tegn i pos 10',                      V('I'), 2021],
  ['ingen registreringsår',                      V('K'), null],
];
for (const [navn, vin, hint] of cases) {
  const r = vinModelYear(vin, hint);
  console.log(`${String(r).padStart(5)} | hint ${String(hint).padStart(4)} | ${navn}`);
}
