import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { svvLookup, svvLookupVin, aliasMerke } from '../src/svv.ts';

// ── aliasMerke ──────────────────────────────────────────────────────────────
test('aliasMerke: SVV-navn → katalognavn', () => {
  assert.equal(aliasMerke('MERCEDES-BENZ'), 'MERCEDES');
  assert.equal(aliasMerke('MERCEDES BENZ'), 'MERCEDES');
  assert.equal(aliasMerke('VOLKSWAGEN'), 'VW');
  assert.equal(aliasMerke('OPEL VAUXHALL'), 'OPEL');
  assert.equal(aliasMerke('TOYOTA'), 'TOYOTA'); // uendret
  assert.equal(aliasMerke(' toyota '), 'TOYOTA'); // trim + upper
});

// ── svvLookup med mocket fetch ─────────────────────────────────────────────
const SVV_SVAR = {
  kjoretoydataListe: [
    {
      kjoretoyId: { understellsnummer: 'WV1ZZZ7HZ5H060934' },
      forstegangsregistrering: { registrertForstegangNorgeDato: '2005-04-20' },
      registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
      godkjenning: {
        tekniskGodkjenning: {
          tekniskeData: {
            generelt: {
              merke: [{ merke: 'VOLKSWAGEN' }],
              handelsbetegnelse: ['VW TRANSPORTER'],
            },
            karosseriOgLasteplan: { rFarge: [{ kodeNavn: 'Hvit' }] },
          },
        },
      },
    },
  ],
};

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status, body, { ok = status >= 200 && status < 300 } = {}) {
  globalThis.fetch = async () => ({
    ok,
    status,
    json: async () => body,
  });
}

test('svvLookup: full parsing av SVV-svar', async () => {
  mockFetch(200, SVV_SVAR);
  const bil = await svvLookup('SU18018', 'hemmelig');
  assert.equal(bil.merke, 'VW'); // VOLKSWAGEN → alias
  assert.equal(bil.modell, 'VW TRANSPORTER');
  assert.equal(bil.aar, 2005);
  assert.equal(bil.vin, 'WV1ZZZ7HZ5H060934');
  assert.equal(bil.farge, 'Hvit');
  assert.equal(bil.registrert, true);
  assert.equal(bil.forstegangsregistrert, '2005-04-20');
  assert.equal(bil.import, false);
  assert.equal(bil.importLand, null);
});

test('svvLookup: import-deteksjon med land', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2019-03-01' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'BMW' }], handelsbetegnelse: ['BMW X3'] } } },
          forstegangsGodkjenning: { fortollingOgMva: { fortollingsreferanse: '2018-11-01-1234', beskrivelse: 'DE BMW X3 XDRIVE20D' } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.import, true);
  assert.equal(bil.importLand, 'Tyskland'); // DE → norsk navn
  assert.equal(bil.aar, 2019);
});

test('svvLookup: ukjent importland-kode beholdes rå', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2020-01-01' },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'OPEL' }], handelsbetegnelse: ['OPEL CORSA'] } } },
          forstegangsGodkjenning: { fortollingOgMva: { fortollingsreferanse: 'x', beskrivelse: 'ZZ OPEL CORSA' } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.importLand, 'ZZ'); // ikke i LAND_NAVN → rå kode
});

test('svvLookup: ugyldig år → null', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '0000-00-00' },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'AUDI' }], handelsbetegnelse: ['AUDI A4'] } } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.aar, null);
});

test('svvLookup: 204 ingen treff → null', async () => {
  mockFetch(204, null, { ok: false });
  assert.equal(await svvLookup('XX99999', 'hemmelig'), null);
});

test('svvLookup: HTTP-feil → null (ærlig fallback)', async () => {
  mockFetch(500, {}, { ok: false });
  assert.equal(await svvLookup('SU18018', 'hemmelig'), null);
});

test('svvLookup: uten API-nøkkel → null uten nettverk', async () => {
  globalThis.fetch = async () => { throw new Error('skal ikke kalles'); };
  assert.equal(await svvLookup('SU18018', undefined), null);
});

test('svvLookup: fetch-kast → null (timeout/5xx-nett)', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.equal(await svvLookup('SU18018', 'hemmelig'), null);
});

test('svvLookup: tom liste → null', async () => {
  mockFetch(200, { kjoretoydataListe: [] });
  assert.equal(await svvLookup('SU18018', 'hemmelig'), null);
});

test('svvLookupVin: understellsnummer-endepunkt brukes', async () => {
  let bruktParam = null;
  globalThis.fetch = async (url) => {
    bruktParam = String(url).includes('understellsnummer=') ? 'understellsnummer' : 'kjennemerke';
    return { ok: true, status: 200, json: async () => ({ kjoretoydataListe: [] }) };
  };
  await svvLookupVin('WV1ZZZ7HZ5H060934', 'hemmelig');
  assert.equal(bruktParam, 'understellsnummer');
});

test('svvLookup: sender SVV-Authorization-header', async () => {
  let auth = null;
  globalThis.fetch = async (_url, opts) => {
    auth = opts.headers['SVV-Authorization'];
    return { ok: true, status: 200, json: async () => ({ kjoretoydataListe: [] }) };
  };
  await svvLookup('SU18018', 'nøkkel123');
  assert.equal(auth, 'Apikey nøkkel123');
});
