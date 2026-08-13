#!/usr/bin/env node
// Eurokode-dekoder — strukturell parsing av Eurocode (SGG-standarden).
// Kilde: observerte mønstre i Autoglass-prislisten (PROSEKT 16.05.2026) + standardoppbygging.
//
// Eurocode-oppbygging (forenklet, verifisert mot data):
//   [katalogkode][posisjon][egenskaper...][designversjon]
//   Eks: 8579AGSGYAVZ1B → 8579=VW T5-familie, A=front, GS?=grønn?, S=sensor, GY=fargetone, A=antenne
//        8579ACSGYAVZ1B → C=COATED (coating)
//        8579AGSVZ1B    → ingen GY-fargetone, ingen A-antenne
//        26493GN=8579LGSV2FD → L=venstre dørrute; 26494GN=8579RGSV2FD → R=høyre
//        26499GN=8579BGSV1H  → B=bakrute

// Posisjoner (første bokstav etter katalogkoden)
const POSISJON = {
  A: 'frontrute',
  B: 'bakrute',
  F: 'ventilrute',
  L: 'dorrute-venstre',
  R: 'dorrute-hoyre',
  S: 'siderute',
};

// Egenskaper som kan forekomme i egenskapsdelen (suffiks etter posisjon)
const EGENSKAP = [
  { kode: 'CS', betydning: 'coated', re: /CS/i },
  { kode: 'C', betydning: 'coated', re: /(?<![A-Z])C(?=[A-Z])/ },
  { kode: 'S', betydning: 'sensor', re: /(?<![A-Z])S(?=[A-Z])/ },
  { kode: 'A', betydning: 'antenne', re: /(?<![A-Z])A(?=[A-Z])/ },
  { kode: 'H', betydning: 'oppvarmet', re: /(?<![A-Z])H(?=[A-Z])/ },
  { kode: 'EL', betydning: 'elektrisk', re: /EL/ },
  { kode: 'M', betydning: 'sensorgel', re: /(?<![A-Z])M(?=[A-Z])/ },
  { kode: 'V', betydning: 'stoyskjermet', re: /(?<![A-Z])V(?=[A-Z])/ },
];

const FARGETONE = [
  { kode: 'GY', farge: 'gronn-gul (GY)', re: /GY/ },
  { kode: 'GN', farge: 'gronn (GN)', re: /GN/ },
  { kode: 'GG', farge: 'gronn-gronn (GG)', re: /GG/ },
  { kode: 'BL', farge: 'bla (BL)', re: /BL/ },
  { kode: 'BZ', farge: 'bronse (BZ)', re: /BZ/ },
  { kode: 'CL', farge: 'klar (CL)', re: /CL/ },
];

/**
 * Dekoder en eurokode til strukturert beskrivelse.
 * @param {string} kode
 * @returns {{ kode: string, posisjon: string|null, fargetone: string|null, egenskaper: string[], raa: string }}
 */
export function dekodeEurokode(kode) {
  if (!kode) return { kode, posisjon: null, fargetone: null, egenskaper: [], raa: '' };
  const raa = kode.toUpperCase();
  // Katalogkode = ledende sifre (typisk 4)
  const m = raa.match(/^(\d{3,5})(.*)$/);
  const rest = m ? m[2] : raa;

  const posBokstav = rest.charAt(0);
  const posisjon = POSISJON[posBokstav] ?? null;

  // Egenskapsdel = ALT etter posisjonsbokstaven (posisjonsbokstaven er ikke en egenskap)
  const eg = rest.slice(1);
  const egenskaper = [];
  if (/C/.test(eg)) egenskaper.push('coated');     // C/CS = coating
  if (/S/.test(eg)) egenskaper.push('sensor');     // S = sensorgel/sensor
  if (/A/.test(eg)) egenskaper.push('antenne');    // A = antenne i glasset
  if (/EL/.test(eg)) egenskaper.push('elektrisk');
  if (/M/.test(eg)) egenskaper.push('sensorgel');  // M = sensortape/gel-type
  if (/H/.test(eg)) egenskaper.push('oppvarmet');  // H = varmetråder
  // V er del av versjonssuffiks (VZ1B o.l.) — IKKE en egenskap

  const fargetone = FARGETONE.find((f) => f.re.test(eg))?.farge ?? null;

  return {
    kode,
    posisjon,
    fargetone,
    egenskaper: [...new Set(egenskaper)],
    raa,
  };
}

// --- CLI: node eurokode-dekoder.mjs <kode> [kode2 ...] ---
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const k of process.argv.slice(2)) {
    console.log(JSON.stringify(dekodeEurokode(k), null, 2));
  }
}
