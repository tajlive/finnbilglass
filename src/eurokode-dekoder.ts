/** Eurokode-dekoder — strukturell parsing (SGG-standarden, verifisert mot Autoglass-prisliste).
 *  Oppbygging: [katalogkode (siffer)][posisjon (A=front/B=bak/L-R=dør/F=ventil)][egenskaper][versjon]
 */

const POSISJON: Record<string, string> = {
  A: 'frontrute',
  B: 'bakrute',
  F: 'ventilrute',
  L: 'dorrute-venstre',
  R: 'dorrute-hoyre',
  S: 'siderute',
};

const FARGETONE: Array<{ kode: string; farge: string; re: RegExp }> = [
  { kode: 'GY', farge: 'gronn-gul (GY)', re: /GY/ },
  { kode: 'GN', farge: 'gronn (GN)', re: /GN/ },
  { kode: 'GG', farge: 'gronn-gronn (GG)', re: /GG/ },
  { kode: 'BL', farge: 'bla (BL)', re: /BL/ },
  { kode: 'BZ', farge: 'bronse (BZ)', re: /BZ/ },
  { kode: 'CL', farge: 'klar (CL)', re: /CL/ },
];

export interface Dekodet {
  kode: string;
  posisjon: string | null;
  fargetone: string | null;
  egenskaper: string[];
  raa: string;
}

export function dekodeEurokode(kode: string | null | undefined): Dekodet {
  if (!kode) return { kode: kode ?? '', posisjon: null, fargetone: null, egenskaper: [], raa: '' };
  const raa = kode.toUpperCase();
  const m = raa.match(/^(\d{3,5})(.*)$/);
  const rest = m ? m[2] : raa;

  const posBokstav = rest.charAt(0);
  const posisjon = POSISJON[posBokstav] ?? null;

  // Egenskapsdel = ALT etter posisjonsbokstaven (posisjonsbokstaven er ikke egenskap)
  const eg = rest.slice(1);
  const egenskaper: string[] = [];
  if (/C/.test(eg)) egenskaper.push('coated');    // C/CS = coating
  if (/S/.test(eg)) egenskaper.push('sensor');    // S = sensorgel/sensor
  if (/A/.test(eg)) egenskaper.push('antenne');   // A = antenne i glasset
  if (/EL/.test(eg)) egenskaper.push('elektrisk');
  if (/M/.test(eg)) egenskaper.push('sensorgel'); // M = sensortape/gel-type
  if (/H/.test(eg)) egenskaper.push('oppvarmet'); // H = varmetråder

  const fargetone = FARGETONE.find((f) => f.re.test(eg))?.farge ?? null;

  return { kode, posisjon, fargetone, egenskaper: [...new Set(egenskaper)], raa };
}

/** Katalogkode = ledende siffer-sekvens (identifiserer modellen). */
export function katalogKode(kode: string | null | undefined): string | null {
  if (!kode) return null;
  const m = kode.match(/^(\d{3,5})/);
  return m ? m[1] : null;
}
