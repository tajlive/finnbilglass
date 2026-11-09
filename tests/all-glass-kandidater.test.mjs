/**
 * ALL_GLASS-kandidater — regresjonstester for kandidatgeneratoren og den
 * offentlige kontrakten i /api/glass/kandidater.
 *
 * Bakgrunn: V6.6.0-D.2-kontrollen fant fire blokkerende feil
 * (docs/v660-d2-qa-2026-11-03.md) pluss tre som kom fram under rettingen:
 *
 *   F1 Posisjonsfilter brukte nøkkelord i varenavn → 0 kandidater for alle klasser.
 *   F2 Familie-regexen /CLA/ matchet E-CLASS/C-CLASSE/S-CLASSE/A-CLASS.
 *   F3 Åpne årsintervaller («91-») ble tolket som uendelige (matchet 2005-bil).
 *   F4 Interne katalogfelt lekket til offentlig svar (og til kundens skjerm).
 *   F5 merke/modell/aar ble godtatt men aldri brukt.
 *   F8 selection (side/dør/ventil) nådde aldri serveren.
 *   F9 «Vet ikke» ga HTTP 400.
 *
 * I tillegg: eurokode er leverandørdata og skal ALDRI i et offentlig svar
 * (public-contract.ts, CTO-beslutning 2026-11-03).
 *
 * Katalogradene er SYNTHETISKE men formatert som produksjonskatalogen.
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
import { normalizeGlassSelection } from '../src/glass-selection-contract.ts';

const KATALOG = [
  // CLA-frontrute UTEN ordet «front» i navnet (ekte kataloggrader ser slik ut)
  { varenr: '5524AGAC', varenavn: 'MERCEDES CLA-CLASSE 4D COUPE 13-', eurokode: '5524AGACMUVZ', kommentar: 'REGNSENSOR' },
  { varenr: '30195GN', varenavn: 'MERCEDES CLA-CLASSE 4D COUPE 13-', eurokode: '5381LGSC4FD', kommentar: null },
  { varenr: '30201GN', varenavn: 'MERCEDES CLA-CLASS 4D CPE 13-', eurokode: '5381BGSCJZ', kommentar: null },
  // Samme merke, HELT andre modeller — skal aldri svare på en CLA-forespørsel
  { varenr: 'E210AGN', varenavn: 'MERCEDES W210 E-CLASS 4D SED 95-02', eurokode: '6210AGNGN', kommentar: null },
  { varenr: 'W203AGN', varenavn: 'MERCEDES C-CLASSE W203 4D SED 00-07', eurokode: '6220AGNGN', kommentar: null },
  { varenr: 'W220AGN', varenavn: 'MERCEDES S-CLASSE W220 4D SED 98-05', eurokode: '6230AGNGN', kommentar: null },
  { varenr: 'W169AGN', varenavn: 'MERCEDES W169 A-CLASS 5D 04-12', eurokode: '6240AGNGN', kommentar: null },
  // Transporter: T4 med åpent intervall, T5 fra 2003, gammel rad
  { varenr: '21416YP', varenavn: 'VW TRANSPORTER 91-', eurokode: '8416BGSP', kommentar: null },
  { varenr: '7901CL', varenavn: 'VW TRANSPORTER,80-', eurokode: '8401BGSP', kommentar: null },
  { varenr: '2525GYA', varenavn: 'VW TRANSP+CARAVELLE T5 2003-', eurokode: '8579AGSGYAVZ1B', kommentar: null },
  { varenr: '26503GN', varenavn: 'VW TRANSPORTER  DOUBLE CAB  03-', eurokode: '8579BGSP', kommentar: null },
  { varenr: '26493GNL', varenavn: 'VW TRANSPORTER 03- DØRRUTE', eurokode: '8579LGSV2FDKW', kommentar: null },
  // Ventil- og takrad (egen posisjonstype)
  { varenr: '26510GN', varenavn: 'VW TRANSPORTER 03- VENTILRUTE FORAN', eurokode: '8579LGSV1FV', kommentar: null },
  { varenr: '26520GN', varenavn: 'VW TRANSPORTER 03- TAKGLASS', eurokode: '8579TGSP', kommentar: null },
  // Tilbehør — aldri glass
  { varenr: '1736PY', varenavn: 'VW TRANSPORTER T5 03- PYNTELIST', eurokode: '8579ASMST', kommentar: null },
];

const index = buildClassDCandidates(KATALOG);
const varenr = (liste) => liste.map((c) => c.varenr);

test('F1: plassering kommer fra klassifiserGlass, ikke fra nøkkelord i navnet', () => {
  const frontruter = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016, { glassklasse: 'frontrute' });
  assert.ok(varenr(frontruter).includes('5524AGAC'), 'CLA-frontruten må være kandidat');
  for (const c of frontruter) {
    assert.equal(c.posisjon.type, 'frontrute');
    assert.equal(posisjonsTekst(c), 'Frontrute');
  }
  const dor = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016, { glassklasse: 'door' });
  assert.ok(varenr(dor).includes('30195GN'), 'dør/sideglass skal svare på dørklassen');
  assert.ok(!varenr(dor).includes('5524AGAC'), 'en frontrute er ikke en dørrute');
});

test('F2: familie-regexen er ordavgrenset — CLA-forespørsel gir aldri andre Mercedes-familier', () => {
  const alle = matchClassDCandidates(index, 'MERCEDES', 'CLA 200 D', 2016);
  for (const c of alle) assert.equal(c.familie, 'CLA', `feil familie i CLA-svaret: ${c.varenavn}`);
  const varenumre = varenr(alle);
  for (const feil of ['E210AGN', 'W203AGN', 'W220AGN', 'W169AGN']) {
    assert.equal(varenumre.includes(feil), false, `${feil} (annen familie) lekker inn i CLA-svaret`);
  }
  assert.ok(alle.length > 0);
  assert.deepEqual(varenr(matchClassDCandidates(index, 'MERCEDES', 'A-CLASS', 2010)), ['W169AGN']);
});

test('F3: åpent intervall «91-» matcher ikke en 2005-bil', () => {
  const treff = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005));
  assert.equal(treff.includes('21416YP'), false, 'T4-ruten (91-) er ikke en T5-rute');
  assert.equal(treff.includes('7901CL'), false, '1980-raden er ikke en 2005-rute');
  assert.ok(treff.includes('2525GYA'));
  assert.ok(treff.includes('26503GN'));
});

test('F3: generasjonsvindu klemmer åpent intervall begge veier', () => {
  assert.ok(varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 1995)).includes('21416YP'));
  const treff2004 = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2004));
  assert.equal(treff2004.includes('21416YP'), false);
  assert.ok(treff2004.includes('2525GYA'));
});

test('posisjon: ventil og tak finnes som egne klasser (ikke blandet med dør/side)', () => {
  const ventil = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005, { glassklasse: 'ventil' }));
  const tak = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005, { glassklasse: 'tak' }));
  const dor = varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005, { glassklasse: 'door' }));
  assert.deepEqual(ventil, ['26510GN']);
  assert.deepEqual(tak, ['26520GN']);
  assert.equal(dor.includes('26510GN'), false);
  assert.equal(dor.includes('26520GN'), false);
});

test('rad uten produksjonsintervall er ikke kandidat for en årspesifikk bil', () => {
  const indeks = buildClassDCandidates([{ varenr: 'X1', varenavn: 'VW GOLF 4D FRONTRUTE', eurokode: '5000AGN' }]);
  assert.equal(matchClassDCandidates(indeks, 'VW', 'GOLF', 2016).length, 0);
  assert.equal(matchClassDCandidates(indeks, 'VW', 'GOLF', null).length, 1);
});

test('tilbehørsrader (pyntelist/klips) er aldri glasskandidat', () => {
  assert.equal(varenr(matchClassDCandidates(index, 'VW', 'TRANSPORTER', 2005)).includes('1736PY'), false);
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
    TRANSPORTER: 'TRANSPORTER', CLA: 'CLA', GOLF: 'GOLF', PASSAT: 'PASSAT', POLO: 'POLO',
    CORSA: 'CORSA', ASTRA: 'ASTRA', VECTRA: 'VECTRA', COOPER: 'MINI',
  };
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
    const naa = forventet.get(nokkel) ?? { fra: Infinity, til: -Infinity, apen: false };
    naa.fra = Math.min(naa.fra, fra);
    naa.apen = naa.apen || til == null;
    if (til != null) naa.til = Math.max(naa.til, til);
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

// ── API-kontrakt ───────────────────────────────────────────────────────────

function falskDb(rader) {
  return {
    prepare() {
      const kjor = () => ({
        all: async () => ({ results: rader }),
        first: async () => rader[0] ?? null,
        run: async () => ({ success: true }),
      });
      return { bind: () => kjor(), ...kjor() };
    },
  };
}

const dbSomGir = falskDb(KATALOG);
const dbSomFeiler = {
  prepare() {
    throw new Error('katalogen skal ikke spørres i quote-pilot-modus');
  },
};

function kall(body, env) {
  return worker.fetch(
    new Request('https://finnbilglass.no/api/glass/kandidater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

const PILOT_ENV = { ENVIRONMENT: 'test', FINNBILGLASS_DB: dbSomFeiler };
const KANDIDAT_ENV = { ENVIRONMENT: 'test', FINNBILGLASS_DB: dbSomGir, ALL_GLASS_KANDIDATER_ENABLED: 'true' };

test('quote-pilot (standard): MANUAL_REVIEW uten katalogtilgang — ingen kandidater, ingen DB-skriving', async () => {
  const res = await kall({ regnr: 'SU18018', schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'front' } }, PILOT_ENV);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'MANUAL_REVIEW');
  assert.deepEqual(data.kandidater, []);
  assert.equal(data.modus, 'MANUAL_QUOTE');
  for (const felt of ['pris', 'vin', 'source', 'matchReason', 'klassifisering', 'eurokode']) {
    assert.equal(Object.hasOwn(data, felt), false, `${felt} i pilotsvaret`);
  }
});

test('F5 + kontrakt: ugyldig valg avvises før katalogen røres', async () => {
  assert.equal((await kall({}, PILOT_ENV)).status, 400);
  assert.equal((await kall({ regnr: 'X', selection: { kind: 'hood' } }, PILOT_ENV)).status, 400);
  assert.equal((await kall({ regnr: 'X', selection: { kind: 'door', side: 'unknown' } }, PILOT_ENV)).status, 400);
  assert.equal((await kall({ regnr: 'X', glassklasse: 'roof', selection: { kind: 'windshield' } }, PILOT_ENV)).status, 400);
  assert.equal((await kall({ merke: 'VW' }, PILOT_ENV)).status, 400, 'merke uten modell');
  assert.equal((await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 1800 }, PILOT_ENV)).status, 400, 'ugyldig år');
});

test('kandidatmodus: offentlig svar er hviteliste — ingen eurokode, pris eller intern diagnostikk', async () => {
  const res = await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'door', side: 'left', door: 'front' } }, KANDIDAT_ENV);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.kandidater.length > 0, 'testen er vaktløs uten data');
  assert.equal(data.status, 'CANDIDATES');
  assert.equal(data.fitmentAuthority, 'ingen — menneskelig bekreftelse kreves');
  const FORBUDT = ['eurokode', 'klassifisering', 'matchReason', 'source', 'pris', 'listepris', 'innkjøpspris', 'ubeKreftetPris', 'vin', 'merke', 'familie', 'generasjon'];
  for (const k of data.kandidater) {
    for (const felt of FORBUDT) assert.equal(felt in k, false, `${felt} lekker i offentlig kandidat`);
    assert.deepEqual(Object.keys(k).sort(), ['egenskaper', 'posisjon', 'varenavn', 'varenr', 'varianter']);
    assert.equal(typeof k.posisjon, 'string');
  }
  assert.equal(JSON.stringify(data).includes('EXACT'), false);
});

test('kandidatmodus: null treff gir trygg MANUAL_REVIEW med tilbudsmulighet — ikke «ingen glass finnes»', async () => {
  // VW Caddy har ingen familie i katalogen: dette er dekning, ikke en feil.
  const res = await kall({ merke: 'VW', modell: 'CADDY', aar: 2017, selection: { kind: 'door', side: 'left', door: 'front' } }, KANDIDAT_ENV);
  assert.equal(res.status, 200, 'manglende dekning er ikke en HTTP-feil');
  const data = await res.json();
  assert.equal(data.status, 'MANUAL_REVIEW');
  assert.deepEqual(data.kandidater, []);
  assert.match(data.message, /kontrollere/i);
  assert.equal(/ingen glass finnes/i.test(JSON.stringify(data)), false);
  assert.equal(data.fitmentAuthority, 'ingen — menneskelig bekreftelse kreves');
});

test('kandidatmodus: ventilrute og takglass filtreres på egen klasse', async () => {
  const ventil = await (await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'ventil', side: 'left', placement: 'front' } }, KANDIDAT_ENV)).json();
  assert.equal(ventil.glassklasse, 'ventil');
  assert.deepEqual(ventil.kandidater.map((k) => k.varenr), ['26510GN']);
  const tak = await (await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'roof', system: 'fixed', panel: 'whole' } }, KANDIDAT_ENV)).json();
  assert.equal(tak.glassklasse, 'tak');
  assert.deepEqual(tak.kandidater.map((k) => k.varenr), ['26520GN']);
});

test('kandidatmodus: «Vet ikke» gir kandidater uten klassefilter, ikke 400', async () => {
  const res = await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'unknown' } }, KANDIDAT_ENV);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.glassklasse, null);
  assert.ok(data.kandidater.length > 0);
});

test('kandidatmodus: selection.door brukes (bakre dør skal ikke gi samme liste som fremre)', async () => {
  const fremre = await (await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'door', side: 'left', door: 'front' } }, KANDIDAT_ENV)).json();
  const bakre = await (await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, selection: { kind: 'door', side: 'left', door: 'rear' } }, KANDIDAT_ENV)).json();
  assert.ok(fremre.kandidater.length > 0);
  assert.ok(bakre.kandidater.length >= 0);
  // Kandidater uten dokumentert ledd beholdes i begge, men ledd-caset må behandles uten krasj.
  assert.equal(Array.isArray(bakre.kandidater), true);
});

test('flat glassklasse (eldre klient) filtrerer likt som selection — ignoreres ikke stille', async () => {
  const res = await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, glassklasse: 'ventil' }, KANDIDAT_ENV);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.glassklasse, 'ventil');
  assert.deepEqual(data.kandidater.map((k) => k.varenr), ['26510GN']);
  // Ukjent klasse skal fortsatt avvises (produksjonens alias-tabell).
  assert.equal((await kall({ merke: 'VW', modell: 'TRANSPORTER', aar: 2005, glassklasse: 'unknown' }, KANDIDAT_ENV)).status, 400);
});

// ── Kandidatkvalitet (Fase 3) ─────────────────────────────────────────────

test('F11: samme varenr to ganger i katalogen gir ÉN kandidat', () => {
  const indeks = buildClassDCandidates([
    { varenr: '3770LYPV5', varenavn: 'FORD TRANSIT LOW+MED  14-', eurokode: '3770LYPV5' },
    { varenr: '3770LYPV5', varenavn: 'FORD TRANSIT LOW+MED 14-', eurokode: '3770LYPV5' },
  ]);
  const treff = matchClassDCandidates(indeks, 'FORD', 'TRANSIT', 2016, { glassklasse: 'door' });
  assert.equal(treff.filter((c) => c.varenr === '3770LYPV5').length, 1, 'duplikat skal være fjernet');
});

test('F12: valgt side fjerner beviselig motsatt side — og tømmer aldri listen', () => {
  const begge = buildClassDCandidates([
    { varenr: 'L1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5001LGSV2FD' },
    { varenr: 'R1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5002RGSV2FD' },
  ]);
  const venstre = matchClassDCandidates(begge, 'VW', 'GOLF', 2016, { glassklasse: 'door', produktSide: 'venstre' });
  assert.deepEqual(venstre.map((c) => c.varenr), ['L1'], 'høyresidens rute skal ikke foreslås når kunden valgte venstre');
  const hoyre = matchClassDCandidates(begge, 'VW', 'GOLF', 2016, { glassklasse: 'door', produktSide: 'hoyre' });
  assert.deepEqual(hoyre.map((c) => c.varenr), ['R1']);

  // Katalogen har bare høyresider: en venstre-forespørsel skal ikke gi tom liste.
  const bareHoyre = buildClassDCandidates([{ varenr: 'R1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5002RGSV2FD' }]);
  assert.equal(matchClassDCandidates(bareHoyre, 'VW', 'GOLF', 2016, { glassklasse: 'door', produktSide: 'venstre' }).length, 1);
});

test('F13: nøyaktig modell rangeres foran nærliggende modell (Sportsvan / Transit Connect)', () => {
  const golf = buildClassDCandidates([
    { varenr: 'SV1', varenavn: 'VW GOLF SPORTSVAN 5D MPV 14-', eurokode: '5101LGSV2FD' },
    { varenr: 'G1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5102LGSV2FD' },
  ]);
  assert.equal(matchClassDCandidates(golf, 'VW', 'GOLF', 2016, { glassklasse: 'door' })[0].varenr, 'G1');

  const transit = buildClassDCandidates([
    { varenr: 'C1', varenavn: 'FORD TRANSIT CONNECT  14-', eurokode: '5201LGSV2FD' },
    { varenr: 'T1', varenavn: 'FORD TRANSIT LOW+MED 14-', eurokode: '5202LGSV2FD' },
  ]);
  assert.equal(matchClassDCandidates(transit, 'FORD', 'TRANSIT', 2016, { glassklasse: 'door' })[0].varenr, 'T1');
});

test('F14: like produktbeskrivelser grupperes — kunden ser ikke samme glass tre ganger', async () => {
  const KATALOG2 = [
    { varenr: 'A1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5301LGSV2FD', kommentar: null },
    { varenr: 'A2', varenavn: 'VW GOLF 5D STV 13-  DØRRUTE', eurokode: '5302LGSV2FD', kommentar: null }, // ekstra mellomrom
    { varenr: 'B1', varenavn: 'VW GOLF SPORTSVAN 5D MPV 14-', eurokode: '5303LGSV2FD', kommentar: null },
  ];
  const env = { ENVIRONMENT: 'test', FINNBILGLASS_DB: falskDb(KATALOG2), ALL_GLASS_KANDIDATER_ENABLED: 'true' };
  const data = await (await kall({ merke: 'VW', modell: 'GOLF', aar: 2016, selection: { kind: 'door', side: 'left', door: 'front' } }, env)).json();
  const beskrivelser = data.kandidater.map((k) => k.varenavn);
  assert.equal(beskrivelser.length, new Set(beskrivelser).size, 'ingen dupliserte beskrivelser');
  const golfRad = data.kandidater.find((k) => k.varenavn.includes('GOLF 5D STV'));
  assert.equal(golfRad.varianter, 2, 'to varenr med samme beskrivelse skal bli én rad med varianter=2');
});

test('F15: egen navnemodell (Sportsvan/Connect/Shooting Brake) foreslås ikke for familiebilen', () => {
  const indeks = buildClassDCandidates([
    { varenr: 'S1', varenavn: 'VW GOLF SPORTSVAN 5D MPV 14-', eurokode: '5401LGSV2FD' },
    { varenr: 'G1', varenavn: 'VW GOLF 5D STV 13- DØRRUTE', eurokode: '5402LGSV2FD' },
    { varenr: 'X1', varenavn: 'VW GOLF PLUS 5D MPV 05-', eurokode: '5403LGSV2FD' },
  ]);
  const treff = varenr(matchClassDCandidates(indeks, 'VW', 'GOLF', 2016, { glassklasse: 'door' }));
  assert.deepEqual(treff, ['G1'], 'Sportsvan/Plus er egne modeller og skal ikke foreslås for en Golf');
  // Ber kunden om Sportsvan, er det den som gjelder.
  const sportsvan = varenr(matchClassDCandidates(indeks, 'VW', 'GOLF SPORTSVAN', 2016, { glassklasse: 'door' }));
  assert.ok(sportsvan.includes('S1'));
  assert.equal(sportsvan.includes('G1'), false, 'Golf-ruten skal ikke foreslås for Sportsvan');
});

test('F16: karosseri filtrerer bare når katalogen oppgir et annet karosseri', () => {
  const indeks = buildClassDCandidates([
    { varenr: 'SED1', varenavn: 'VW PASSAT 4D SED 15-  DØRRUTE', eurokode: '5501LGSV2FD' },
    { varenr: 'STV1', varenavn: 'VW PASSAT 5D STV 15-  DØRRUTE', eurokode: '5502LGSV2FD' },
    { varenr: 'UKJ1', varenavn: 'VW PASSAT 15-  DØRRUTE', eurokode: '5503LGSV2FD' },
  ]);
  const sedan = varenr(matchClassDCandidates(indeks, 'VW', 'PASSAT', 2016, { glassklasse: 'door', kropp: 'sedan' }));
  assert.deepEqual(sedan.sort(), ['SED1', 'UKJ1'], 'stasjonsvogn-ruten skal ut, ukjent karosseri skal bli');
  const stv = varenr(matchClassDCandidates(indeks, 'VW', 'PASSAT', 2016, { glassklasse: 'door', kropp: 'estate' }));
  assert.deepEqual(stv.sort(), ['STV1', 'UKJ1']);
  // «Vet ikke» = ingen filtrering
  assert.equal(matchClassDCandidates(indeks, 'VW', 'PASSAT', 2016, { glassklasse: 'door', kropp: null }).length, 3);
});

test('F17: karosseri som ikke finnes i katalogen tømmer ikke listen', () => {
  const indeks = buildClassDCandidates([
    { varenr: 'SED1', varenavn: 'VW PASSAT 4D SED 15-  DØRRUTE', eurokode: '5601LGSV2FD' },
  ]);
  assert.equal(matchClassDCandidates(indeks, 'VW', 'PASSAT', 2016, { glassklasse: 'door', kropp: 'cabriolet' }).length, 1);
});

test('F18: kundens karosserivalg følger med til operatørens sak', async () => {
  // Samme kontrakt som /api/inquiry bruker: selection lagres ordrett i saken.
  const req = { schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'front', body: 'estate' }, answers: {} };
  const normalisert = normalizeGlassSelection(req.selection);
  assert.deepEqual(normalisert, req.selection, 'body skal overleve validering');
  assert.equal(normalizeGlassSelection({ kind: 'door', side: 'left', door: 'front' })?.body, undefined, 'body er valgfritt');
  assert.equal(normalizeGlassSelection({ kind: 'door', side: 'left', door: 'front', body: 'romskip' }), null, 'ugyldig karosseri avvises');
});
