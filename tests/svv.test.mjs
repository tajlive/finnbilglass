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

test('svvLookup: import-deteksjon med bruktimport-objekt + land', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2019-03-01' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'BMW' }], handelsbetegnelse: ['BMW X3'] } } },
          forstegangsGodkjenning: {
            gyldigFraDato: '2018-11-01',
            fortollingOgMva: { fortollingsreferanse: '2018-11-01-1234', beskrivelse: 'DE BMW X3 XDRIVE20D' },
            bruktimport: { importland: { landkode: 'DE', landNavn: 'TYSKLAND' }, kilometerstand: 35000 },
          },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.import, true);
  assert.equal(bil.importLand, 'TYSKLAND'); // SVVs landNavn vinner over fortollings-beskrivelse
  assert.equal(bil.aar, 2019);
});

test('svvLookup: fortollingsbeskrivelse med landkode alene er IKKE import (Tesla EF 93128-saken)', async () => {
  // Tesla Model Y levert NY i Norge: fortollingen starter med «GB» som tollformat-kode
  // (11GB/12GB-feltkoder), ikke Storbritannia. Bruktimport mangler, COC-gap 1 mnd.
  mockFetch(200, {
    kjoretoydataListe: [
      {
        kjoretoyId: { understellsnummer: 'XP7YGCEK8PB151026' },
        forstegangsregistrering: { registrertForstegangNorgeDato: '2023-06-28' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: {
            tekniskeData: { generelt: { merke: [{ merke: 'TESLA' }], handelsbetegnelse: ['Model Y'] } },
            kjoretoyklassifisering: { nasjonalGodkjenning: { nasjonaltGodkjenningsAr: 2023 } },
          },
          forstegangsGodkjenning: {
            gyldigFraDato: '2023-05-30',
            forstegangRegistrertDato: '2023-06-28',
            fortollingOgMva: { fortollingsreferanse: '4440012300219586', beskrivelse: 'GB Model Y 2023 Europe 11GB TESLA 12GB MODEL Y 13AK 1 20KK NE 20MK ADDR 21' },
          },
        },
      },
    ],
  });
  const bil = await svvLookup('EF93128', 'hemmelig');
  assert.equal(bil.import, false); // GB i fortollingen er feltkode, ikke importbevis
  assert.equal(bil.importLand, null);
  assert.equal(bil.aar, 2023);
});

test('svvLookup: fortollingsreferanse alene med liten COC-gap → IKKE importbil (JD79487-saken)', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2017-03-20' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'VOLKSWAGEN' }], handelsbetegnelse: ['VW CADDY'] } } },
          forstegangsGodkjenning: { gyldigFraDato: '2017-01-13', fortollingOgMva: { fortollingsreferanse: '0101112017010953' } },
        },
      },
    ],
  });
  const bil = await svvLookup('JD79487', 'hemmelig');
  assert.equal(bil.import, false); // vanlig norsk-levert nybil
  assert.equal(bil.importLand, null);
});

test('svvLookup: stort COC-gap uten land → importbil (bruktimport-signal)', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2020-06-01' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'AUDI' }], handelsbetegnelse: ['AUDI A4'] } } },
          forstegangsGodkjenning: { gyldigFraDato: '2015-01-01', fortollingOgMva: { fortollingsreferanse: 'x' } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.import, true); // ~65 mnd gap = brukt i utlandet først
  assert.equal(bil.importLand, null);
});

test('svvLookup: ukjent importland-kode beholdes rå', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2020-01-01' },
        godkjenning: {
          tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'OPEL' }], handelsbetegnelse: ['OPEL CORSA'] } } },
          forstegangsGodkjenning: { fortollingOgMva: { fortollingsreferanse: 'x', beskrivelse: 'ZZ OPEL CORSA' }, bruktimport: { importland: { landkode: 'ZZ' } } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.import, true); // bruktimport-objekt = bevis
  assert.equal(bil.importLand, 'ZZ'); // ikke i LAND_NAVN → rå kode
});

test('svvLookup: bruktimport-objekt fra SVV → import + riktig årsmodell (JD94062-saken)', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        kjoretoyId: { understellsnummer: 'JMBXDGG2WEZ012146' },
        forstegangsregistrering: { registrertForstegangNorgeDato: '2025-06-03' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: {
            tekniskeData: { generelt: { merke: [{ merke: 'MITSUBISHI' }], handelsbetegnelse: ['MITSUBISHI OUTLANDER'] } },
            kjoretoyklassifisering: { nasjonalGodkjenning: { nasjonaltGodkjenningsAr: 2014 } },
          },
          forstegangsGodkjenning: {
            gyldigFraDato: '2025-06-03', // COC utstedt ved import — gap 0 mnd
            fortollingOgMva: { fortollingsreferanse: '3650412500000182', beskrivelse: 'MITSUBISHI OUTLANDER 2.0 PHEV2014 MODELKM STAND 105250' },
            bruktimport: {
              importland: { landkode: 'NLD', landNavn: 'NEDERLAND' },
              kilometerstand: 105291,
            },
          },
        },
      },
    ],
  });
  const bil = await svvLookup('JD94062', 'hemmelig');
  assert.equal(bil.aar, 2014); // årsmodell fra nasjonaltGodkjenningsAr, IKKE registreringsår 2025
  assert.equal(bil.import, true); // SVVs bruktimport-objekt = autoritativt bevis
  assert.equal(bil.importLand, 'NEDERLAND'); // SVVs eget landNavn vinner over kode-mapping
  assert.equal(bil.forstegangsregistrert, '2025-06-03'); // norsk førstegangsregistrering uendret
});

test('svvLookup: nasjonaltGodkjenningsAr uten bruktimport → år oppdatert, import fortsatt false', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2025-01-15' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: {
            tekniskeData: { generelt: { merke: [{ merke: 'TOYOTA' }], handelsbetegnelse: ['TOYOTA COROLLA'] } },
            kjoretoyklassifisering: { nasjonalGodkjenning: { nasjonaltGodkjenningsAr: 2024 } },
          },
          forstegangsGodkjenning: { gyldigFraDato: '2024-11-01', fortollingOgMva: { fortollingsreferanse: 'x' } },
        },
      },
    ],
  });
  const bil = await svvLookup('XX12345', 'hemmelig');
  assert.equal(bil.aar, 2024); // nasjonaltGodkjenningsAr vinner
  assert.equal(bil.import, false); // liten COC-gap + ingen landkode + ingen bruktimport
});

test('svvLookup: forstegangRegistrertDato vinner over nasjonaltGodkjenningsAr (JD79487-mønster)', async () => {
  mockFetch(200, {
    kjoretoydataListe: [
      {
        forstegangsregistrering: { registrertForstegangNorgeDato: '2017-03-20' },
        registrering: { registreringsstatus: { kodeVerdi: 'REGISTRERT' } },
        godkjenning: {
          tekniskGodkjenning: {
            tekniskeData: { generelt: { merke: [{ merke: 'VOLKSWAGEN' }], handelsbetegnelse: ['VW CADDY'] } },
            kjoretoyklassifisering: { nasjonalGodkjenning: { nasjonaltGodkjenningsAr: 2016 } }, // typegodkjenning året før
          },
          forstegangsGodkjenning: { gyldigFraDato: '2017-01-13', forstegangRegistrertDato: '2017-03-20', fortollingOgMva: { fortollingsreferanse: '0101112017010953' } },
        },
      },
    ],
  });
  const bil = await svvLookup('JD79487', 'hemmelig');
  assert.equal(bil.aar, 2017); // forstegangRegistrertDato (2017) vinner over nasjAr (2016)
  assert.equal(bil.import, false); // fortsatt ikke import
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
