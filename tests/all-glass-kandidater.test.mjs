/**
 * ALL-GLASS-kandidater — regresjonstester for de fire blokkerende funnene i
 * V6.6.0-D.2-kontrollen (docs/v660-d2-qa-2026-11-03.md):
 *
 *   F1 Posisjonsfilter brukte nøkkelord i varenavn → 0 kandidater for alle
 *      klasser. Katalograder som «MERCEDES CLA-CLASSE 4D COUPE 13-» heter ikke
 *      «FRONTRUTE», men ER en frontrute (eurokode 5524A…).
 *   F2 Familie-regexen /CLA/ matchet E-CLASS/C-CLASSE/S-CLASSE/A-CLASS, slik at
 *      en CLA-forespørsel fikk frontruter til helt andre Mercedes-modeller.
 *   F3 Åpne årsintervaller («91-») ble tolket som uendelige og matchet en
 *      2005-bil; generasjonshint ble aldri brukt.
 *   F4 Interne kandidatfelt (klassifisering, matchReason, source) gikk ut til
 *      kunden. Svaret skal være en hviteliste, ikke en svarteliste.
 *
 * Katalogradene under er SYNTHETISKE men formatert som produksjonskatalogen
 * (auto-glass.no-prislisten). Ingen produksjonsdata skrives eller leses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClassDCandidates,
  matchClassDCandidates,
  posisjonsTekst,
  aarIntervall,
  GENERASJONER,
} from '../src/fitment-v1/catalogue-candidates.ts';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.ts';
import worker from '../src/index.ts';

const KATALOG = [
  // CLA-frontrute UTEN ordet «front» i navnet (ekte katalograder ser slik ut)
  { varenr: '5524AGAC', varenavn: 'MERCEDES CLA-CLASSE 4D COUPE 13-', eurokode: '5524AGACMUVZ', kommentar: 'REGNSENSOR' },
  { varenr: '30195GN', varenavn: 'MERCEDES CLA-CLASSE 4D COUPE 13-', eurokode: '5381LGSC4FD', kommentar: null },
  { varenr: '30201GN', varenavn: 'MERCEDES CLA-CLASS 4D CPE 13-', eurokode: '5381BGSCJZ', kommentar: null },
  // Samme merke, HELT andre modeller — skal aldri svare på en CLA-forespørsel
  { varenr: 'E210AGN', varenavn: 'MERCEDES W210 E-CLASS 4D SED 95-02', eurokode: '6210AGNGN', kommentar: null },
  { varenr: 'W203AGN', varenavn: 'MERCEDES C-CLASSE W203 4D SED 00-07', eurokode: '6220AGNGN', kommentar: null },
  { varenr: 'W220AGN', varenavn: 'MERCEDES S-CLASSE W220 4D SED 98-05', eurokode: '6230AGNGN', kommentar: null },
  { varenr: 'W169AGN', varenavn: 'MERCEDES W169 A-CLASS 5D 04-12', eurokode: '6240AGNGN', kommentar: null },
  // Transporter: T4 (1990–2003) med åpent intervall, T5 fra 2003, gammel rad
  { varenr: '21416YP', varenavn: 'VW TRANSPORTER 91-', eurokode: '8416BGSP', kommentar: null },
  { varenr: '7901CL', varenavn: 'VW TRANSPORTER,80-', eurokode: '8401BGSP', kommentar: null },
  { varenr: '2525GYA', varenavn: 'VW TRANSP+CARAVELLE T5 2003-', eurokode: '8579AGSGYAVZ1B', kommentar: null },
  { varenr: '26503GN', varenavn: 'VW TRANSPORTER  DOUBLE CAB  03-', eurokode: '8579BGSP', kommentar: null },
  // Tilbehør — aldri glass
  { varenr: '1736PY', varenavn: 'VW TRANSPORTER T5 03- PYNTELIST', eurokode: '8579ASMST', kommentar: null },
];

const index = buildClassDCandidates(KATALOG);
const varenr = (liste) => liste.map((c) => c.varenr);

test('F1: plassering kommer fra klassifiserGlass, ikke fra nøkkelord i navnet', () => {
  const frontruter = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016, { glassklasse: 'frontrute' });
  // Raden heter «… 4D COUPE 13-» — den inneholder ikke «FRONT», men eurokoden
  // 5524A… gjør den til frontrute. Før fiksen ga dette 0 kandidater.
  assert.ok(varenr(frontruter).includes('5524AGAC'), 'CLA-frontruten må være kandidat');
  for (const c of frontruter) {
    assert.equal(c.posisjon.type, 'frontrute');
    assert.equal(posisjonsTekst(c), 'Frontrute');
  }
  const dor = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016, { glassklasse: 'door' });
  assert.ok(varenr(dor).includes('30195GN'), 'dør/sideglass skal svare på dørklassen');
  assert.ok(!varenr(dor).includes('5524AGAC'), 'en frontrute er ikke en dørrute');
});

test('F2: familie-regexen er ordavgrenset — CLA-forespørsel gir aldri E-/C-/S-/A-CLASS', () => {
  const alle = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016);
  for (const c of alle) {
    assert.equal(c.familie, 'CLA', `feil familie i CLA-svaret: ${c.varenavn}`);
  }
  const varenumre = varenr(alle);
  for (const feil of ['E210AGN', 'W203AGN', 'W220AGN', 'W169AGN']) {
    assert.equal(varenumre.includes(feil), false, `${feil} (annen Mercedes-familie) lekker inn i CLA-svaret`);
  }
  assert.ok(alle.length > 0, 'CLA må ha kandidater');
  // Samme merke, annen familie: A-CLASS skal fortsatt svare på A-CLASS.
  const aKlasse = matchClassDCandidates(index, 'MERCEDES', 'A-CLASS', 2010);
  assert.deepEqual(varenr(aKlasse), ['W169AGN']);
});

test('F3: åpent intervall «91-» matcher ikke en 2005-bil', () => {
  const treff = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005));
  assert.equal(treff.includes('21416YP'), false, 'T4-ruten (91-) er ikke en T5-rute');
  assert.equal(treff.includes('7901CL'), false, '1980-raden er ikke en 2005-rute');
  assert.ok(treff.includes('2525GYA'), 'T5-frontruten (2003-) skal matche');
  assert.ok(treff.includes('26503GN'), '03--raden skal matche');
});

test('F3: generasjonsvindu klemmer åpent intervall begge veier', () => {
  assert.ok(varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 1995)).includes('21416YP'));
  // 2004-bil: T4-raden er slutt (2003), T5-raden gjelder
  const treff2004 = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2004));
  assert.equal(treff2004.includes('21416YP'), false);
  assert.ok(treff2004.includes('2525GYA'));
});

test('rad uten produksjonsintervall er ikke kandidat for en årspesifikk bil', () => {
  const indeks = buildClassDCandidates([{ varenr: 'X1', varenavn: 'VW GOLF 4D FRONTRUTE', eurokode: '5000AGN' }]);
  assert.equal(matchClassDCandidates(indeks, 'VW', 'GOLF', 2016).length, 0);
  assert.equal(matchClassDCandidates(indeks, 'VW', 'GOLF', null).length, 1);
});

test('tilbehørsrader (pyntelist/klips) er aldri glasskandidat', () => {
  assert.equal(varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005)).includes('1736PY'), false);
});

test('varenr-mønster: list, gummilist og klips-kit filtreres bort', () => {
  const indeks = buildClassDCandidates([
    { varenr: '2525GY', varenavn: 'VW TRANSPORTER T5 03- FRONTRUTE', eurokode: '8579AGSGY' },
    { varenr: '2525GU', varenavn: 'VW TRANSPORTER T5 03- FRONTRUTE', eurokode: '8579AGSGY' },
    { varenr: '2525K', varenavn: 'VW TRANSPORTER T5 03- KLIPS', eurokode: '8579AGSGY' },
  ]);
  assert.deepEqual(varenr(matchClassDCandidates(indeks, 'VW', 'TRANSPORTER', 2005)), ['2525GY']);
});

test('årsintervall-parseren tar tosifret og firesifret form, og avviser «4D»', () => {
  assert.deepEqual(aarIntervall('VW TRANSPORTER 91-'), { fra: 1991, til: null });
  assert.deepEqual(aarIntervall('BMW 3 SERIE 4D SED 83-90'), { fra: 1983, til: 1990 });
  assert.deepEqual(aarIntervall('TESLA MODEL 3 2019-'), { fra: 2019, til: null });
  assert.deepEqual(aarIntervall('VW GOLF 4D COUPE'), { fra: null, til: null });
});

test('generasjonstabellen er enig med generation-registry (kan ikke gli fra hverandre)', () => {
  const register = buildDefaultGenerationRegistry();
  const modellTilFamilie = {
    TRANSPORTER: 'TRANSPORTER',
    CLA: 'CLA',
    GOLF: 'GOLF',
    PASSAT: 'PASSAT',
    POLO: 'POLO',
    CORSA: 'CORSA',
    ASTRA: 'ASTRA',
    VECTRA: 'VECTRA',
    COOPER: 'MINI',
  };
  // Registeret kan ha flere rader per generasjon (facelift-split). Kandidat-
  // tabellen bruker HELE produksjonsintervallet, altså omsluttet intervall.
  const forventet = new Map();
  for (const rad of register) {
    const familie = modellTilFamilie[String(rad.model).toUpperCase()];
    if (!familie) continue;
    const utenParen = String(rad.generation).replace(/\(.*\)/, '').trim();
    const token = utenParen.split(/\s+/).slice(-1)[0];
    if (!token) continue;
    const nokkel = `${familie}|${token}`;
    const fra = rad.productionInterval.from;
    const til = rad.productionInterval.to;
    const naa = forventet.get(nokkel) ?? { fra: Infinity, til: -Infinity, sett: 0, apen: false };
    naa.fra = Math.min(naa.fra, fra);
    naa.apen = naa.apen || til == null;
    if (til != null) naa.til = Math.max(naa.til, til);
    naa.sett += 1;
    forventet.set(nokkel, naa);
  }
  let kontrollert = 0;
  for (const [nokkel, forv] of forventet) {
    const [familie, token] = nokkel.split('|');
    const vindu = (GENERASJONER[familie] ?? []).find((v) => v.token === token);
    assert.ok(vindu, `${familie} ${token} finnes i registeret men mangler i GENERASJONER`);
    assert.equal(vindu.fra, forv.fra, `${familie} ${token}: startår avviker`);
    assert.equal(vindu.til, forv.apen ? null : forv.til, `${familie} ${token}: sluttår avviker`);
    kontrollert++;
  }
  assert.ok(kontrollert >= 20, `for få vinduer kontrollert (${kontrollert}) — testen er vaktløs`);
});

// ── API-kontrakt: hviteliste i offentlig svar (F4) ─────────────────────────

function falskDb(rader) {
  return {
    prepare(sql) {
      const kjor = () => ({
        all: async () => ({ results: rader }),
        first: async () => rader[0] ?? null,
        run: async () => ({ success: true }),
      });
      return { bind: () => kjor(), ...kjor() };
    },
  };
}

const ENV = { ENVIRONMENT: 'test', FINNBILGLASS_DB: falskDb(KATALOG) };

function kallGlasskandidater(body) {
  const request = new Request('https://finnbilglass.no/api/glass/kandidater', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, ENV);
}

test('F4: kandidatsvaret inneholder ikke intern diagnostikk når listen er ikke-tom', async () => {
  const res = await kallGlasskandidater({ merke: 'MERCEDES', modell: 'CLA 200 D', aar: 2016, glassklasse: 'door' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.kandidater.length > 0, 'testen er vaktløs uten data (F4 måles på ikke-tom liste)');
  const FORBUDT = ['klassifisering', 'matchReason', 'source', 'pris', 'listepris', 'innkjøpspris', 'ubeKreftetPris', 'vin', 'merke', 'familie', 'generasjon'];
  for (const k of data.kandidater) {
    for (const felt of FORBUDT) {
      assert.equal(felt in k, false, `${felt} lekker i offentlig kandidat`);
    }
    assert.equal(typeof k.posisjon, 'string', 'posisjon skal være kundetekst, ikke intern struktur');
    assert.equal(typeof k.varenr, 'string');
  }
  assert.equal(data.bilKilde, 'klientopplysning');
  assert.equal(data.bil, null, 'uten regnr er bilen ikke registerverifisert');
  assert.equal(data.fitmentAuthority, 'ingen — menneskelig bekreftelse kreves');
  assert.equal(JSON.stringify(data).includes('EXACT'), false);
});

test('F5: merke/modell/aar brukes, og avvises eksplisitt når de er ufullstendige', async () => {
  const utenModell = await kallGlasskandidater({ merke: 'VW' });
  assert.equal(utenModell.status, 400);
  const ugyldigAar = await kallGlasskandidater({ merke: 'VW', modell: 'TRANSPORTER', aar: 1800 });
  assert.equal(ugyldigAar.status, 400);
  const ok = await kallGlasskandidater({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005 });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.ok(data.kandidater.length > 0, 'merke/modell/aar skal faktisk gi kandidater');
});

test('«Vet ikke» (ukjent klasse) gir kandidater, ikke HTTP 400', async () => {
  for (const klasse of ['unknown', 'ukjent', 'vet_ikke']) {
    const res = await kallGlasskandidater({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, glassklasse: klasse });
    assert.equal(res.status, 200, `${klasse} skal ikke gi 400`);
    const data = await res.json();
    assert.ok(data.kandidater.length > 0);
    assert.equal(data.glassklasse, null, 'ukjent klasse skal ikke filtrere');
  }
  const ugyldig = await kallGlasskandidater({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, glassklasse: 'hood' });
  assert.equal(ugyldig.status, 400, 'en faktisk ugyldig klasse skal fortsatt avvises');
});

test('selection.kind og selection.door brukes (frontend-objektet, ikke bare flate felt)', async () => {
  const res = await kallGlasskandidater({
    merke: 'MERCEDES',
    modell: 'CLA 200 D',
    aar: 2016,
    selection: { kind: 'door', side: 'left', door: 'unknown' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.kandidater.length > 0);
  assert.equal(data.glassklasse, 'dor');
  for (const k of data.kandidater) {
    assert.equal(/frontrute/i.test(k.varenavn) && /AGAC/.test(k.eurokode || ''), false);
  }
});
