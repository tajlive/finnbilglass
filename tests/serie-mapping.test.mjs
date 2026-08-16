// Regresjonstest: serie-mapping W-koder (Mercedes) og E/F/G-koder (BMW).
// Tom 2026-08-16: «MB bruker W foran serie, f.eks. W123, W124» — SVV sender
// rene W-koder som modellnavn; serieKey må gjenkjenne dem direkte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serieKey } from '../src/serie-mapping.ts';

test('Mercedes: rene W-koder gjenkjennes direkte (SVV-modellnavn)', () => {
  const cases = [
    ['W123', 1980, 'W123'], // 1976–1986 (Wikipedia)
    ['W124', 1990, 'W124'], // 1985–1996
    ['W126', 1985, 'W126'], // 1979–1992
    ['W140', 1993, 'W140'], // 1991–1998
    ['W201', 1983, 'W201'], // 1982–1993
    ['W163', 1998, 'W163'], // M-klasse 1997–2005
    ['W203', 2000, 'W203'], // C-klasse 2000–2007
    ['W210', 1998, 'W210'], // E-klasse 1995–2002
    ['W211', 2005, 'W211'], // E-klasse 2002–2009
    ['W220', 2000, 'W220'], // S-klasse 1998–2005
    ['W901', 2000, 'W901'], // Sprinter 1995–2006
    ['W638', 2000, 'W638'], // Vito 1996–2003
    ['R230', 2005, 'R230'], // SL 2001–2012
    ['X164', 2010, 'X164'], // GL 2006–2012
    ['C257', 2020, 'C257'], // CLS 2018–
    ['W204 C 200', 2010, 'W204'], // klasse-navn + W-kode
  ];
  for (const [modell, aar, forventet] of cases) {
    assert.equal(serieKey('MERCEDES', modell, aar), forventet, `${modell} ${aar}`);
  }
});

test('Mercedes: klasse-prefiks → W-kode per år', () => {
  assert.equal(serieKey('MERCEDES', 'C 180', 2005), 'W203');
  assert.equal(serieKey('MERCEDES', 'E 200 CDI', 1998), 'W210');
  assert.equal(serieKey('MERCEDES', 'S 500', 2015), 'W222');
  assert.equal(serieKey('MERCEDES', 'M-CLASS', 2002), 'W163');
  assert.equal(serieKey('MERCEDES', 'M-CLASS', 2008), 'W164');
  assert.equal(serieKey('MERCEDES', 'ML 350', 2005), 'W163');
  assert.equal(serieKey('MERCEDES', 'SPRINTER', 2000), 'W901');
  assert.equal(serieKey('MERCEDES', 'A 180', 2000), 'W168');
});

test('Mercedes: ukjent modell → null (fallback til token-matching)', () => {
  assert.equal(serieKey('MERCEDES', 'ATEGO', 2012), null);
  assert.equal(serieKey('MERCEDES', 'SUPERCAB', 1981), null);
});

test('BMW: rene E/F/G-koder gjenkjennes direkte', () => {
  assert.equal(serieKey('BMW', 'E39', 2001), 'E39');
  assert.equal(serieKey('BMW', 'F10', 2011), 'F10');
  assert.equal(serieKey('BMW', 'G20', 2020), 'G20');
  // klasse-prefiks → serie
  assert.equal(serieKey('BMW', '525D', 2001), 'E39');
  assert.equal(serieKey('BMW', '3 SERIE', 1995), 'E36');
  assert.equal(serieKey('BMW', 'X5', 2008), 'E70');
});

test('Andre merker: ingen serie-mapping (null)', () => {
  assert.equal(serieKey('VOLVO', 'V60', 2018), null);
  assert.equal(serieKey('TOYOTA', 'COROLLA', 1993), null);
});
