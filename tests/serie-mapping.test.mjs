// Regresjonstest: serie-mapping W-koder (Mercedes) og E/F/G-koder (BMW).
// Tom 2026-08-16: «MB bruker W foran serie, f.eks. W123, W124» — SVV sender
// rene W-koder som modellnavn; serieKey må gjenkjenne dem direkte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serieKey, normaliserKatalogModell } from '../src/serie-mapping.ts';

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

test('Mercedes varebiler: siffer-betegnelse → SPRINTER/VITO (UR67407-saken)', () => {
  // SVV gir «208 CDI» (Sprinter W901, typebetegnelse C) — siffer-ledet uten klassebokstav.
  assert.equal(serieKey('MERCEDES', '208 CDI', 2002), 'W901');
  assert.equal(serieKey('MERCEDES', '308 CDI', 2008), 'W906');
  assert.equal(serieKey('MERCEDES', '311 CDI', 2015), 'W906');
  assert.equal(serieKey('MERCEDES', '108 CDI', 2002), 'W638'); // VITO
  assert.equal(serieKey('MERCEDES', '115 CDI', 2010), 'W639'); // VITO
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
  assert.equal(serieKey('VW', 'CRAFTER', 2015), null);
  assert.equal(serieKey('OPEL', 'MONTEREY', 1996), null);
});

test('VW: generasjoner → romertall (katalog-form «GOLF IV»)', () => {
  const cases = [
    ['GOLF', 1976, 'GOLF I'],
    ['GOLF', 1985, 'GOLF II'],
    ['GOLF', 1994, 'GOLF III'],
    ['GOLF', 1999, 'GOLF IV'],
    ['GOLF', 2005, 'GOLF V'],
    ['GOLF', 2010, 'GOLF VI'],
    ['GOLF', 2015, 'GOLF VII'],
    ['GOLF', 2020, 'GOLF VIII'],
    ['PASSAT', 2005, 'PASSAT'],
    ['PASSAT', 2020, 'PASSAT B9'],
    ['POLO', 2005, 'POLO'],
    ['TOURAN', 2010, 'TOURAN'],
    ['TIGUAN', 2020, 'TIGUAN'],
  ];
  for (const [modell, aar, forventet] of cases) {
    assert.equal(serieKey('VW', modell, aar), forventet, `${modell} ${aar}`);
  }
});

test('Opel: generasjoner → bokstav (katalog-form «VECTRA C»)', () => {
  assert.equal(serieKey('OPEL', 'VECTRA', 1990), 'VECTRA A');
  assert.equal(serieKey('OPEL', 'VECTRA', 1998), 'VECTRA B');
  assert.equal(serieKey('OPEL', 'VECTRA', 2005), 'VECTRA C');
  assert.equal(serieKey('OPEL', 'CORSA', 1995), 'CORSA B');
  assert.equal(serieKey('OPEL', 'CORSA', 2002), 'CORSA C');
  assert.equal(serieKey('OPEL', 'CORSA', 2008), 'CORSA D');
  assert.equal(serieKey('OPEL', 'KADETT', 1986), 'KADETT E');
  assert.equal(serieKey('OPEL', 'OMEGA', 1998), 'OMEGA B');
  assert.equal(serieKey('OPEL', 'ZAFIRA', 2000), 'ZAFIRA A');
  assert.equal(serieKey('OPEL', 'ZAFIRA', 2008), 'ZAFIRA B');
});

test('MINI: modell + år → R/F-kode', () => {
  assert.equal(serieKey('MINI', 'COOPER', 2005), 'R50');
  assert.equal(serieKey('MINI', 'COOPER', 2008), 'R56');
  assert.equal(serieKey('MINI', 'COOPER', 2016), 'F56');
  assert.equal(serieKey('MINI', 'COOPER D CLUBMAN', 2010), 'R55');
  assert.equal(serieKey('MINI', 'COOPER CLUBMAN', 2018), 'F54');
  assert.equal(serieKey('MINI', 'COOPER COUNTRYMAN ALL4', 2012), 'R60');
  assert.equal(serieKey('MINI', 'COOPER COUNTRYMAN', 2018), 'F60');
  assert.equal(serieKey('MINI', 'F56', 2016), 'F56');
});

test('Nissan: modell + år → P/K/N-kode', () => {
  assert.equal(serieKey('NISSAN', 'PRIMERA', 1993), 'P10');
  assert.equal(serieKey('NISSAN', 'PRIMERA', 1998), 'P11');
  assert.equal(serieKey('NISSAN', 'MICRA', 1995), 'K11');
  assert.equal(serieKey('NISSAN', 'MICRA', 2005), 'K12');
  assert.equal(serieKey('NISSAN', 'ALMERA', 2002), 'N16');
});

test('Toyota: SUPRA MK + LAND CRUISER J-serier', () => {
  assert.equal(serieKey('TOYOTA', 'SUPRA', 1990), 'SUPRA MK3');
  assert.equal(serieKey('TOYOTA', 'SUPRA', 1998), 'SUPRA MK4');
  assert.equal(serieKey('TOYOTA', 'LAND CRUISER', 2000), 'LANDCRUISER FJ100');
  assert.equal(serieKey('TOYOTA', 'LANDCRUISER', 2010), 'LANDCRUISER FJ200');
  assert.equal(serieKey('TOYOTA', 'LAND CRUSER', 2022), 'LANDCRUISER J250');
});

test('normaliserKatalogModell: GT-modell-strenger → serie-form', () => {
  assert.equal(normaliserKatalogModell('GOLF IV 3+5D CC+STV'), 'GOLF IV');
  assert.equal(normaliserKatalogModell('GOLF V'), 'GOLF V');
  assert.equal(normaliserKatalogModell('VECTRA A SED+5D CC'), 'VECTRA A');
  assert.equal(normaliserKatalogModell('CORSA B 3/5D'), 'CORSA B');
  assert.equal(normaliserKatalogModell('KADETT D'), 'KADETT D');
  assert.equal(normaliserKatalogModell('OMEGA B 4D+5D STVOGN'), 'OMEGA B');
  assert.equal(normaliserKatalogModell('ZAFIRA A MPV'), 'ZAFIRA A');
  assert.equal(normaliserKatalogModell('F56'), 'F56');
  assert.equal(normaliserKatalogModell('PRIMERA P11'), 'P11');
  assert.equal(normaliserKatalogModell('SUPRA MK3'), 'SUPRA MK3');
  assert.equal(normaliserKatalogModell('LANDCRUISER FJ100'), 'LANDCRUISER FJ100');
  // Uten kode → null (ingen serie-tilknytning)
  assert.equal(normaliserKatalogModell('1 HBK'), null);
  assert.equal(normaliserKatalogModell('ASTRA CC+STV'), null);
  assert.equal(normaliserKatalogModell('GOLF PLUS'), null);
});
