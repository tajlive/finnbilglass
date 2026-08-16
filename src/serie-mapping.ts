/**
 * Serie-mapping: oversetter SVV-modell-strenger («C 180 CDI», «525D») til
 * katalog-interne serie-koder («W204», «E39») slik at ground_truth-rader fra
 * prislisten (som bruker W/E-koder) kan matches presist.
 *
 * Kilde: bilindustriens offisielle interne koder (Daimler/Mercedes W-serier,
 * BMW E/F/G-serier) med år-vinduer. Data er statisk og versjonert.
 *
 * Brukes av: resolveren (lagGroundTruth) + scripts/gt-generator.mjs (normalisering).
 */

export interface SerieDef {
  /** Katalog-kode som står i prislisten/GT (f.eks. «W204», «E39»). */
  kode: string;
  start: number;
  slutt: number;
}

// ── MERCEDES: SVV-klasse-prefiks → W-koder per generasjon ──
const MERCEDES_KLASSER: Record<string, SerieDef[]> = {
  // «C 180 CDI» → C-klasse
  C: [
    { kode: 'W202', start: 1993, slutt: 2000 },
    { kode: 'W203', start: 2000, slutt: 2007 },
    { kode: 'W204', start: 2007, slutt: 2014 },
    { kode: 'W205', start: 2014, slutt: 2021 },
    { kode: 'W206', start: 2021, slutt: 2035 },
  ],
  // «E 200 CDI» → E-klasse
  E: [
    { kode: 'W124', start: 1984, slutt: 1995 },
    { kode: 'W210', start: 1995, slutt: 2002 },
    { kode: 'W211', start: 2002, slutt: 2009 },
    { kode: 'W212', start: 2009, slutt: 2016 },
    { kode: 'W213', start: 2016, slutt: 2023 },
    { kode: 'W214', start: 2023, slutt: 2035 },
  ],
  // «S 63 AMG» → S-klasse
  S: [
    { kode: 'W126', start: 1979, slutt: 1991 },
    { kode: 'W140', start: 1991, slutt: 1998 },
    { kode: 'W220', start: 1998, slutt: 2005 },
    { kode: 'W221', start: 2005, slutt: 2013 },
    { kode: 'W222', start: 2013, slutt: 2020 },
    { kode: 'W223', start: 2020, slutt: 2035 },
  ],
  // «A 180» → A-klasse
  A: [
    { kode: 'W168', start: 1997, slutt: 2004 },
    { kode: 'W169', start: 2004, slutt: 2012 },
    { kode: 'W176', start: 2012, slutt: 2018 },
    { kode: 'W177', start: 2018, slutt: 2035 },
  ],
  // «B 180» → B-klasse
  B: [
    { kode: 'W245', start: 2005, slutt: 2011 },
    { kode: 'W246', start: 2011, slutt: 2019 },
    { kode: 'W247', start: 2019, slutt: 2035 },
  ],
  // «CLK 320» → CLK
  CLK: [
    { kode: 'W208', start: 1997, slutt: 2003 },
    { kode: 'W209', start: 2003, slutt: 2010 },
  ],
  // «CLA 180» → CLA
  CLA: [
    { kode: 'W117', start: 2013, slutt: 2019 },
    { kode: 'W118', start: 2019, slutt: 2035 },
  ],
  // «300 D» / «300 E» (eldre W123/W124/W210-æra)
  '300': [
    { kode: 'W123', start: 1976, slutt: 1985 },
    { kode: 'W124', start: 1986, slutt: 1995 },
    { kode: 'W210', start: 1996, slutt: 2002 },
  ],
  // «CLS 350» → CLS
  CLS: [
    { kode: 'W219', start: 2004, slutt: 2010 },
    { kode: 'W218', start: 2010, slutt: 2018 },
    { kode: 'C257', start: 2018, slutt: 2035 },
  ],
  // «SL 500» → SL
  SL: [
    { kode: 'R129', start: 1989, slutt: 2001 },
    { kode: 'R230', start: 2001, slutt: 2012 },
    { kode: 'R231', start: 2012, slutt: 2020 },
    { kode: 'R232', start: 2020, slutt: 2035 },
  ],
  // «SLK 200» → SLK/SLC
  SLK: [
    { kode: 'R170', start: 1996, slutt: 2004 },
    { kode: 'R171', start: 2004, slutt: 2011 },
    { kode: 'R172', start: 2011, slutt: 2021 },
  ],
  SLC: [{ kode: 'R172', start: 2016, slutt: 2021 }],
  // «ML 350» → ML/GLE
  ML: [
    { kode: 'W163', start: 1997, slutt: 2005 },
    { kode: 'W164', start: 2005, slutt: 2011 },
    { kode: 'W166', start: 2011, slutt: 2019 },
  ],
  GLE: [{ kode: 'W166', start: 2015, slutt: 2019 }, { kode: 'W167', start: 2019, slutt: 2035 }],
  // «GL 500» → GL/GLS
  GL: [
    { kode: 'X164', start: 2006, slutt: 2012 },
    { kode: 'X166', start: 2012, slutt: 2019 },
  ],
  GLS: [{ kode: 'X167', start: 2019, slutt: 2035 }],
  // «GLK 220» → GLK
  GLK: [{ kode: 'X204', start: 2008, slutt: 2015 }],
  // «GLA 200» → GLA
  GLA: [{ kode: 'X156', start: 2013, slutt: 2020 }, { kode: 'H247', start: 2020, slutt: 2035 }],
  // «GLC 220» → GLC
  GLC: [{ kode: 'X253', start: 2015, slutt: 2023 }, { kode: 'X254', start: 2023, slutt: 2035 }],
  // G-klasse («G 350», «G 500», «GELANDEWAGEN»)
  G: [
    { kode: 'W460', start: 1979, slutt: 1991 },
    { kode: 'W463', start: 1991, slutt: 2018 },
    { kode: 'W465', start: 2018, slutt: 2035 },
  ],
  // «190 E 2.O» → 190-serien (W201)
  '190': [{ kode: 'W201', start: 1982, slutt: 1993 }],
  // «VIANO» / «VITO» → V-klasse
  VIANO: [
    { kode: 'W638', start: 1996, slutt: 2003 },
    { kode: 'W639', start: 2003, slutt: 2014 },
    { kode: 'W447', start: 2014, slutt: 2035 },
  ],
  VITO: [
    { kode: 'W638', start: 1996, slutt: 2003 },
    { kode: 'W639', start: 2003, slutt: 2014 },
    { kode: 'W447', start: 2014, slutt: 2035 },
  ],
  // «SPRINTER»
  SPRINTER: [
    { kode: 'W901', start: 1995, slutt: 2006 },
    { kode: 'W906', start: 2006, slutt: 2018 },
    { kode: 'W907', start: 2018, slutt: 2035 },
  ],
  // «R 350» → R-klasse
  R: [{ kode: 'W251', start: 2005, slutt: 2017 }],
  // EQ (elbiler) — matcher EQE/EQS/EQC-navn direkte
  EQE: [{ kode: 'W295', start: 2022, slutt: 2035 }],
  EQS: [{ kode: 'W297', start: 2021, slutt: 2035 }],
  EQC: [{ kode: 'W293', start: 2019, slutt: 2024 }],
  EQA: [{ kode: 'H243', start: 2021, slutt: 2035 }],
  EQB: [{ kode: 'X243', start: 2021, slutt: 2035 }],
};

// ── VW: modell → generasjons-betegnelse (romertall som i katalogen: «GOLF IV») ──
// Kilde: Wikipedia (Typ-koder i parentes). Katalogen bruker romertall-formen.
const VW_GENERASJONER: Record<string, SerieDef[]> = {
  GOLF: [
    { kode: 'GOLF I', start: 1974, slutt: 1983 },
    { kode: 'GOLF II', start: 1983, slutt: 1991 },
    { kode: 'GOLF III', start: 1991, slutt: 1997 },
    { kode: 'GOLF IV', start: 1997, slutt: 2003 },
    { kode: 'GOLF V', start: 2003, slutt: 2008 },
    { kode: 'GOLF VI', start: 2008, slutt: 2012 },
    { kode: 'GOLF VII', start: 2012, slutt: 2019 },
    { kode: 'GOLF VIII', start: 2019, slutt: 2035 },
  ],
  PASSAT: [
    { kode: 'PASSAT', start: 1973, slutt: 1981 }, // B1
    { kode: 'PASSAT', start: 1981, slutt: 1988 }, // B2
    { kode: 'PASSAT', start: 1988, slutt: 1993 }, // B3
    { kode: 'PASSAT', start: 1993, slutt: 1996 }, // B4
    { kode: 'PASSAT', start: 1996, slutt: 2005 }, // B5
    { kode: 'PASSAT', start: 2005, slutt: 2010 }, // B6
    { kode: 'PASSAT', start: 2010, slutt: 2014 }, // B7
    { kode: 'PASSAT B9', start: 2014, slutt: 2035 }, // B8+B9 (katalogen bruker B9 for 2019+)
  ],
  POLO: [
    { kode: 'POLO', start: 1975, slutt: 1994 },
    { kode: 'POLO', start: 1994, slutt: 2002 },
    { kode: 'POLO', start: 2002, slutt: 2009 },
    { kode: 'POLO', start: 2009, slutt: 2017 },
    { kode: 'POLO', start: 2017, slutt: 2035 },
  ],
  TOURAN: [
    { kode: 'TOURAN', start: 2003, slutt: 2015 },
    { kode: 'TOURAN', start: 2015, slutt: 2035 },
  ],
  TIGUAN: [
    { kode: 'TIGUAN', start: 2007, slutt: 2017 },
    { kode: 'TIGUAN', start: 2017, slutt: 2035 },
  ],
};

// ── OPEL: modell → generasjons-bokstav (som i katalogen: «VECTRA C») ──
const OPEL_GENERASJONER: Record<string, SerieDef[]> = {
  VECTRA: [
    { kode: 'VECTRA A', start: 1988, slutt: 1995 },
    { kode: 'VECTRA B', start: 1995, slutt: 2002 },
    { kode: 'VECTRA C', start: 2002, slutt: 2008 },
  ],
  CORSA: [
    { kode: 'CORSA', start: 1982, slutt: 1993 }, // A
    { kode: 'CORSA B', start: 1993, slutt: 2000 },
    { kode: 'CORSA C', start: 2000, slutt: 2006 },
    { kode: 'CORSA D', start: 2006, slutt: 2014 },
    { kode: 'CORSA', start: 2014, slutt: 2035 }, // E/F
  ],
  KADETT: [
    { kode: 'KADETT D', start: 1979, slutt: 1984 },
    { kode: 'KADETT E', start: 1984, slutt: 1991 },
  ],
  ASTRA: [
    { kode: 'ASTRA', start: 1991, slutt: 1998 }, // F
    { kode: 'ASTRA', start: 1998, slutt: 2004 }, // G
    { kode: 'ASTRA', start: 2004, slutt: 2010 }, // H
    { kode: 'ASTRA', start: 2010, slutt: 2015 }, // J
    { kode: 'ASTRA', start: 2015, slutt: 2021 }, // K
    { kode: 'ASTRA', start: 2021, slutt: 2035 }, // L
  ],
  OMEGA: [
    { kode: 'OMEGA', start: 1986, slutt: 1994 }, // A
    { kode: 'OMEGA B', start: 1994, slutt: 2003 },
  ],
  INSIGNIA: [
    { kode: 'INSIGNIA', start: 2008, slutt: 2017 }, // A
    { kode: 'INSIGNIA', start: 2017, slutt: 2035 }, // B
  ],
  ZAFIRA: [
    { kode: 'ZAFIRA A', start: 1999, slutt: 2005 },
    { kode: 'ZAFIRA B', start: 2005, slutt: 2011 },
    { kode: 'ZAFIRA', start: 2011, slutt: 2035 }, // C
  ],
};

// ── MINI: modell → R/F-kode (BMW-koder, som i katalogen: «F56») ──
// Kilde: Wikipedia (Mini Hatch/Clubman/Countryman). Hatch 1.gen = R50/R53,
// 2.gen = R56, 3.gen = F56, 4.gen = F66; Clubman R55/F54; Countryman R60/F60.
const MINI_GENERASJONER: Record<string, SerieDef[]> = {
  COOPER: [
    { kode: 'R50', start: 2001, slutt: 2006 },
    { kode: 'R56', start: 2006, slutt: 2013 },
    { kode: 'F56', start: 2014, slutt: 2024 },
    { kode: 'F66', start: 2024, slutt: 2035 },
  ],
  CLUBMAN: [
    { kode: 'R55', start: 2007, slutt: 2014 },
    { kode: 'F54', start: 2015, slutt: 2024 },
  ],
  COUNTRYMAN: [
    { kode: 'R60', start: 2010, slutt: 2016 },
    { kode: 'F60', start: 2017, slutt: 2024 },
  ],
};

// ── NISSAN: modell → kode (P10/P11, K11/K12, N15/N16) ──
const NISSAN_GENERASJONER: Record<string, SerieDef[]> = {
  PRIMERA: [
    { kode: 'P10', start: 1990, slutt: 1996 },
    { kode: 'P11', start: 1996, slutt: 2001 },
    { kode: 'P12', start: 2001, slutt: 2007 },
  ],
  MICRA: [
    { kode: 'K10', start: 1982, slutt: 1992 },
    { kode: 'K11', start: 1992, slutt: 2002 },
    { kode: 'K12', start: 2002, slutt: 2010 },
    { kode: 'K13', start: 2010, slutt: 2017 },
  ],
  ALMERA: [
    { kode: 'N15', start: 1995, slutt: 2000 },
    { kode: 'N16', start: 2000, slutt: 2006 },
  ],
};

// ── TOYOTA: SUPRA MK3/MK4, LANDCRUISER J-serier ──
const TOYOTA_GENERASJONER: Record<string, SerieDef[]> = {
  SUPRA: [
    { kode: 'SUPRA MK3', start: 1986, slutt: 1993 },
    { kode: 'SUPRA MK4', start: 1993, slutt: 2002 },
  ],
  LANDCRUISER: [
    { kode: 'LANDCRUISER HJ60', start: 1980, slutt: 1990 },
    { kode: 'LANDCRUISER HJ80', start: 1990, slutt: 1997 },
    { kode: 'LANDCRUISER FJ100', start: 1998, slutt: 2007 },
    { kode: 'LANDCRUISER FJ200', start: 2007, slutt: 2021 },
    { kode: 'LANDCRUISER J250', start: 2021, slutt: 2035 },
  ],
};

// ── BMW: serie (tall-prefiks eller modell-navn) → E/F/G-koder ──
const BMW_SERIER: Record<string, SerieDef[]> = {
  '1': [
    { kode: 'E81/E87', start: 2004, slutt: 2011 },
    { kode: 'F20/F21', start: 2011, slutt: 2019 },
    { kode: 'F40', start: 2019, slutt: 2035 },
  ],
  '2': [
    { kode: 'F22', start: 2014, slutt: 2021 },
    { kode: 'G42', start: 2021, slutt: 2035 },
  ],
  '3': [
    { kode: 'E36', start: 1990, slutt: 2000 },
    { kode: 'E46', start: 1998, slutt: 2007 },
    { kode: 'E90', start: 2005, slutt: 2013 },
    { kode: 'F30/F31', start: 2012, slutt: 2019 },
    { kode: 'G20', start: 2019, slutt: 2035 },
  ],
  '4': [
    { kode: 'F32', start: 2013, slutt: 2020 },
    { kode: 'G22', start: 2020, slutt: 2035 },
  ],
  '5': [
    { kode: 'E34', start: 1988, slutt: 1996 },
    { kode: 'E39', start: 1995, slutt: 2003 },
    { kode: 'E60', start: 2003, slutt: 2010 },
    { kode: 'F10', start: 2010, slutt: 2017 },
    { kode: 'G30', start: 2017, slutt: 2035 },
  ],
  '6': [
    { kode: 'E63', start: 2003, slutt: 2010 },
    { kode: 'F12', start: 2010, slutt: 2018 },
    { kode: 'G32', start: 2017, slutt: 2035 },
  ],
  '7': [
    { kode: 'E32', start: 1986, slutt: 1994 },
    { kode: 'E38', start: 1994, slutt: 2001 },
    { kode: 'E65', start: 2001, slutt: 2008 },
    { kode: 'F01', start: 2008, slutt: 2015 },
    { kode: 'G11', start: 2015, slutt: 2035 },
  ],
  X1: [{ kode: 'E84', start: 2009, slutt: 2015 }, { kode: 'F48', start: 2015, slutt: 2035 }],
  X3: [{ kode: 'E83', start: 2003, slutt: 2010 }, { kode: 'F25', start: 2010, slutt: 2017 }, { kode: 'G01', start: 2017, slutt: 2035 }],
  X5: [{ kode: 'E53', start: 1999, slutt: 2006 }, { kode: 'E70', start: 2006, slutt: 2013 }, { kode: 'F15', start: 2013, slutt: 2018 }, { kode: 'G05', start: 2018, slutt: 2035 }],
  X6: [{ kode: 'E71', start: 2008, slutt: 2014 }, { kode: 'F16', start: 2014, slutt: 2019 }, { kode: 'G06', start: 2019, slutt: 2035 }],
  X2: [{ kode: 'F39', start: 2017, slutt: 2035 }],
  X4: [{ kode: 'F26', start: 2014, slutt: 2018 }, { kode: 'G02', start: 2018, slutt: 2035 }],
  Z4: [{ kode: 'E85', start: 2002, slutt: 2009 }, { kode: 'E89', start: 2009, slutt: 2016 }, { kode: 'G29', start: 2018, slutt: 2035 }],
  Z3: [{ kode: 'E36', start: 1995, slutt: 2002 }],
  I3: [{ kode: 'I01', start: 2013, slutt: 2022 }],
  I4: [{ kode: 'G26', start: 2021, slutt: 2035 }],
  I5: [{ kode: 'G60', start: 2023, slutt: 2035 }],
  IX: [{ kode: 'I20', start: 2021, slutt: 2035 }],
  IX1: [{ kode: 'U11', start: 2022, slutt: 2035 }],
  IX3: [{ kode: 'G08', start: 2021, slutt: 2035 }],
};

/** Finn serie-def for et (klasse, år). */
function iVindu(defs: SerieDef[] | undefined, aar: number | null): string | null {
  if (!defs || aar == null) return null;
  for (const d of defs) {
    if (aar >= d.start && aar <= d.slutt) return d.kode;
  }
  return null;
}

/** SVV-modell-streng → Mercedes-klasse-prefiks. */
function mercedesKlasse(modell: string): string | null {
  const m = (modell || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const ren = m.replace(/^AMG\s+/, ''); // «AMG A 45» → «A 45»
  // «190 E 2.O» spesialfall; «300 D» → W123/W124/W210-æra
  if (/^190\b/.test(ren)) return '190';
  if (/^300\b/.test(ren)) return '300';
  // EQ-serien: «EQE 350 4MATIC», «EQA 250», «EQB 300»
  const eq = ren.match(/^(EQE|EQS|EQC|EQA|EQB)\b/);
  if (eq) return eq[1];
  // «G 350», «G 500», «GELANDEWAGEN» — men unngå «GL»/«GLC»/«GLA»/«GLE»/«GLS»/«GLK»
  if (/^(GLC|GLA|GLE|GLS|GLK)\b/.test(ren)) return ren.split(' ')[0];
  if (/^GL\b/.test(ren)) return 'GL';
  if (/^G\b/.test(ren)) return 'G';
  if (/^GELAND\w*\b/i.test(ren)) return 'G';
  if (/^R\b/.test(ren) && /\d/.test(ren)) return 'R'; // «R 350» (R-klasse) — kun med tall
  // «M-CLASS» / «M KLASSE» / «ML» → ML (M-klasse)
  if (/^M[- ]?(?:CLASS|CLASSE|KLASSE)\b/i.test(ren) || /^ML\b/.test(ren)) return 'ML';
  const klasse = ren.match(/^(C|E|S|A|B|CLA|CLK|CLS|SL|SLK|SLC|ML|VIANO|VITO|SPRINTER)\b/);
  return klasse ? klasse[1] : null;
}

/** SVV-modell-streng → BMW-serie-nøkkel. */
function bmwSerie(modell: string): string | null {
  const m = (modell || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const i = m.match(/^(I3|I4|I5|IX1|IX2|IX3|IX)\b/);
  if (i) return i[1];
  const x = m.match(/^(X1|X2|X3|X4|X5|X6)\b/);
  if (x) return x[1];
  const z = m.match(/^(Z3|Z4)\b/);
  if (z) return z[1];
  // «M 550D» / «M550D» — M-prefiks-strip (katalog bruker «550D»)
  const mpre = m.match(/^M\s*(\d)/);
  if (mpre) return mpre[1];
  // «525D», «116I», «318D», «730D», «225XE», «540D», «3 SERIE», «5 SERIEN»…
  const tall = m.match(/^(\d)(?:\d{1,2})?/);
  if (tall) return tall[1];
  const mserie = m.match(/^(M\d)\b/);
  if (mserie) return mserie[1].replace('M', '').slice(0, 1); // M3 → 3, M5 → 5
  return null;
}

/**
 * serieKey: (merke, SVV-modell, år) → katalog-serie-kode («W204», «E39»).
 * Returnerer null når ingen serie-mapping finnes (vanlig token-matching brukes da).
 */
export function serieKey(merke: string, modell: string, aar: number | null): string | null {
  const m = (merke || '').trim().toUpperCase();
  if (m === 'MERCEDES' || m === 'MERCEDES-BENZ' || m === 'MERCEDES BENZ') {
    // SVV gir ofte ren W-kode som modellnavn: «W140», «W204», «R230», «X164», «C257».
    // Gjenkjenn den direkte — katalogen bruker samme koder («SERIE W140», «W204 STV»).
    const wk = (modell || '').toUpperCase().match(/\b([WXCR]\d{3}(?:\/\d{3})?)\b/);
    if (wk) return kanonisk(wk[1]);
    const klasse = mercedesKlasse(modell);
    if (!klasse) return null;
    const k = iVindu(MERCEDES_KLASSER[klasse], aar);
    return k ? k.split('/')[0].split('-')[0] : null; // kanonisk form
  }
  if (m === 'BMW') {
    // SVV kan også gi ren E/F/G-kode («E39», «F10»).
    const ek = (modell || '').toUpperCase().match(/\b([EFG]\d{2}(?:\/\d{2})?)\b/);
    if (ek) return kanonisk(ek[1]);
    const serie = bmwSerie(modell);
    if (!serie) return null;
    const k = iVindu(BMW_SERIER[serie], aar);
    return k ? k.split('/')[0].split('-')[0] : null; // kanonisk form
  }
  // ── VW: «GOLF», «PASSAT», «POLO», «TOURAN», «TIGUAN» + år → generasjon ──
  if (m === 'VW' || m === 'VOLKSWAGEN') {
    const M = (modell || '').toUpperCase();
    const base = M.match(/^(GOLF|PASSAT|POLO|TOURAN|TIGUAN)\b/);
    if (!base) return null;
    const k = iVindu(VW_GENERASJONER[base[1]], aar);
    return k ?? null; // «GOLF IV»-formen, direkte
  }
  // ── OPEL: «VECTRA», «CORSA», «KADETT», «ASTRA», «OMEGA», «INSIGNIA», «ZAFIRA» + år ──
  if (m === 'OPEL' || m === 'VAUXHALL' || m === 'OPEL VAUXHALL') {
    const M = (modell || '').toUpperCase();
    const base = M.match(/^(VECTRA|CORSA|KADETT|ASTRA|OMEGA|INSIGNIA|ZAFIRA)\b/);
    if (!base) return null;
    const k = iVindu(OPEL_GENERASJONER[base[1]], aar);
    return k ?? null; // «VECTRA C»-formen
  }
  // ── MINI: «COOPER», «CLUBMAN», «COUNTRYMAN» + år → R/F-kode ──
  if (m === 'MINI') {
    const M = (modell || '').toUpperCase();
    // Ren kode i navnet («F56», «R56») — katalogen bruker koden direkte.
    const mk = M.match(/\b([RF]\d{2})\b/);
    if (mk) return mk[1];
    if (M.includes('COUNTRYMAN')) return iVindu(MINI_GENERASJONER.COUNTRYMAN, aar);
    if (M.includes('CLUBMAN')) return iVindu(MINI_GENERASJONER.CLUBMAN, aar);
    return iVindu(MINI_GENERASJONER.COOPER, aar); // «COOPER», «ONE», hatch
  }
  // ── NISSAN: «PRIMERA», «MICRA», «ALMERA» + år → P/K/N-kode ──
  if (m === 'NISSAN') {
    const M = (modell || '').toUpperCase();
    const base = M.match(/^(PRIMERA|MICRA|ALMERA)\b/);
    if (!base) return null;
    const k = iVindu(NISSAN_GENERASJONER[base[1]], aar);
    return k ?? null; // «P11», «K11», «N16»
  }
  // ── TOYOTA: «SUPRA» MK3/MK4, «LAND CRUISER» J-serier ──
  if (m === 'TOYOTA') {
    const M = (modell || '').toUpperCase();
    if (M.includes('SUPRA')) {
      const k = iVindu(TOYOTA_GENERASJONER.SUPRA, aar);
      return k ?? null; // «SUPRA MK3»-formen
    }
    // «LAND CRUISER», «LANDCRUISER», «LAND CRUSER» (SVV-skrivefeil)
    if (/^LAND\s?CRU\w*/.test(M) || M.includes('LANDCRUISER')) {
      const k = iVindu(TOYOTA_GENERASJONER.LANDCRUISER, aar);
      return k ?? null; // «LANDCRUISER FJ100»-formen
    }
  }
  return null;
}

/** Normaliserer GT/katalog-modell-strenger fra prislisten til serie-kode-form.
 *  Kanonisk form: første kode («F10/11» → «F10», «W907/W910» → «W907»). */
const kanonisk = (kode: string): string => kode.split('/')[0].split('-')[0];
// Karosseri-søsken → samme serie (E87 er 5-dørs E81; F31 er stv. F30 osv.)
// + katalog-W/R-bytter (prislisten bruker W170 for SLK; offisiell kode = R170)
const KAROSSERI_ALIAS: Record<string, string> = {
  E87: 'E81', E88: 'E81', E91: 'E90', E92: 'E90', E93: 'E90',
  F11: 'F10', F31: 'F30', G21: 'G20', G31: 'G30', F21: 'F20', F13: 'F12', F33: 'F32', F36: 'F32',
  E61: 'E60', E66: 'E65', F02: 'F01', G12: 'G11',
  W129: 'R129', W170: 'R170', W230: 'R230',
};
export function normaliserKatalogModell(modell: string): string | null {
  const m = (modell || '').toUpperCase();
  // Mercedes: «W204 STV», «M KLASSE W164», «GL X164», «CLK W209 CAB», «R-CLASS W251»
  const w = m.match(/\b([WXCR]\d{3}(?:\/\d{3})?)\b/);
  if (w) return KAROSSERI_ALIAS[kanonisk(w[1])] ?? kanonisk(w[1]);
  // BMW/MINI: «SERIEN E39», «SERIE E46», «COMPACT E36», «CABRIOLET E36», «F56», «F54»
  const e = m.match(/\b([EFG]\d{2}(?:\/\d{2})?)\b/);
  if (e) return KAROSSERI_ALIAS[kanonisk(e[1])] ?? kanonisk(e[1]);
  // «G460», «X164»-lignende allerede fanget over; «I01» osv.
  const i = m.match(/\b(I\d{2})\b/);
  if (i) return KAROSSERI_ALIAS[kanonisk(i[1])] ?? kanonisk(i[1]);
  // VW: «GOLF IV 3+5D CC+STV» → «GOLF IV» (romertall-generasjon)
  const vw = m.match(/\b(GOLF|PASSAT|POLO|TOURAN|TIGUAN)\s+(I{1,3}|IV|V|VI{1,3}|VII|VIII|IX)\b/);
  if (vw) return `${vw[1]} ${vw[2]}`;
  // Opel: «VECTRA A SED+5D CC», «CORSA B 3/5D», «KADETT D», «OMEGA B» (enkelt bokstav)
  const opel = m.match(/\b(VECTRA|CORSA|KADETT|ASTRA|OMEGA|INSIGNIA|ZAFIRA)\s+([A-K])\b/);
  if (opel) return `${opel[1]} ${opel[2]}`;
  // Nissan: «PRIMERA P11 97-01», «MICRA K10», «ALMERA 3+5D CC N16»
  const nissan = m.match(/\b(P1[0-2]|K1[0-3]|N1[56])\b/);
  if (nissan) return nissan[1];
  // Toyota: «SUPRA MK3», «LANDCRUISER FJ100 / HJ80 / J250»
  const toyota = m.match(/\b(SUPRA MK[1-5])\b/) ?? m.match(/\b(LANDCRUISER\s+(?:HJ\d{2}|FJ\d{3}|J\d{3}))\b/);
  if (toyota) return toyota[1];
  return null;
}

/** Eksportert for tester. */
export const _internt = { mercedesKlasse, bmwSerie, iVindu };
