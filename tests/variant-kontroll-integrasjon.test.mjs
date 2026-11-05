// Integrasjon: serverkontrollen gjennom den ekte inquiry-handleren.
//
// Bakgrunn: i produksjon ble et motstridende utstyrssvar godtatt fordi
// variant-oppslaget ikke hentet `kommentar`. Denne testen går gjennom
// worker.fetch med et realistisk databaseskjema og krever at
//   - motstrid avvises med 400
//   - INGEN sak opprettes (ingen INSERT)
//   - INGEN e-post sendes (ingen fetch til Brevo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

/** Realistisk glass_prisliste-rad, slik produksjonsskjemaet ser ut. */
const RAD = {
  varenr: '2051AGAC',
  varenavn: 'ALFA ROMEO JUNIOR 5D SUV 24- WS',
  eurokode: '2049AGACMVZ',
  pris: 10745,
  rad_type: 'glass',
  kommentar: '+++MAX55%# +++HEATED',
  variant_id: '2051AGAC:2049AGACMVZ',
};

function lagDb(rad) {
  const state = { inserts: 0 };
  const db = {
    state,
    prepare(sql) {
      let args = [];
      return {
        sql,
        get args() { return args; },
        bind(...v) { args = v; return this; },
        async first() {
          if (/FROM glass_prisliste WHERE variant_id/.test(sql)) return rad;
          if (/FROM glass_prisliste/.test(sql)) return rad;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { if (/INSERT/i.test(sql)) state.inserts += 1; return { meta: { changes: 1 } }; },
      };
    },
    async batch(statements) {
      for (const s of statements) if (/INSERT INTO beta_inquiries/i.test(s.sql)) state.inserts += 1;
      return [{ meta: { last_row_id: 99 } }, { meta: { changes: 1 } }];
    },
  };
  return db;
}

async function send(db, body, ekstra = {}) {
  const epost = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes('brevo') || String(url).includes('resend')) epost.push(String(url));
    return new Response('{}', { status: 201 });
  });
  try {
    const svar = await worker.fetch(
      new Request('https://test.invalid/api/inquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { ENVIRONMENT: 'production', inquiries_enabled: 'true', FINNBILGLASS_DB: db, ...ekstra },
      { waitUntil: () => {} },
    );
    return { status: svar.status, tekst: await svar.text(), epost };
  } finally {
    globalThis.fetch = original;
  }
}

const GRUNN = {
  navn: 'Syntetisk Test',
  kontakt: 'test@example.invalid',
  regnr: 'TEST',
  melding: 'Kun test',
  glassRequest: { selection: { kind: 'windshield' } },
};

test('utstyr: dokumentert oppvarmet + kunde «nei» avvises uten sak og uten e-post', async () => {
  const db = lagDb(RAD);
  const ut = await send(db, {
    ...GRUNN,
    variantId: '2051AGAC:2049AGACMVZ',
    glassRequest: { selection: { kind: 'windshield' }, answers: { oppvarmet: 'nei' } },
  });
  assert.equal(ut.status, 400, ut.tekst);
  assert.match(ut.tekst, /dokumentert med oppvarmet/);
  assert.equal(db.state.inserts, 0, 'ingen sak skal opprettes');
  assert.equal(ut.epost.length, 0, 'ingen e-post skal sendes');
});

test('utstyr: samme vare + «ja» godtas (manuell kontroll)', async () => {
  const db = lagDb(RAD);
  const ut = await send(db, {
    ...GRUNN,
    variantId: '2051AGAC:2049AGACMVZ',
    glassRequest: { selection: { kind: 'windshield' }, answers: { oppvarmet: 'ja' } },
  });
  assert.equal(ut.status, 201, ut.tekst);
  assert.equal(db.state.inserts, 1);
});

test('tilbehør som variant avvises uten sak', async () => {
  const db = lagDb({ ...RAD, varenr: '2735PYKIT', varenavn: 'FORD S-MAX 06-  PYNTELIST KIT  V+H', eurokode: '3568ASMML+3568AS', variant_id: '2735PYKIT:3568ASMML+3568AS', kommentar: null });
  const ut = await send(db, { ...GRUNN, variantId: '2735PYKIT:3568ASMML+3568AS' });
  assert.equal(ut.status, 400, ut.tekst);
  assert.match(ut.tekst, /ikke et glass/);
  assert.equal(db.state.inserts, 0);
});

test('ukjent variant avvises uten sak', async () => {
  const db = lagDb(null);
  const ut = await send(db, { ...GRUNN, variantId: 'FINNES:IKKE' });
  assert.equal(ut.status, 400, ut.tekst);
  assert.equal(db.state.inserts, 0);
  assert.equal(ut.epost.length, 0);
});

test('feil side avvises uten sak', async () => {
  const dor = { varenr: '2481LYPS4', varenavn: 'BMW 7 SERIEN  15- DØRRUTE BAK VS', eurokode: '2481LYPS4RDKW', pris: 8535, rad_type: 'glass', kommentar: null, variant_id: '2481LYPS4:2481LYPS4RDKW' };
  const db = lagDb(dor);
  const ut = await send(db, {
    ...GRUNN,
    variantId: '2481LYPS4:2481LYPS4RDKW',
    glassRequest: { selection: { kind: 'door', door: 'rear', side: 'right', body: 'unknown' } },
  });
  assert.equal(ut.status, 400, ut.tekst);
  assert.match(ut.tekst, /dokumentert som venstre/);
  assert.equal(db.state.inserts, 0);
});

test('GLE Coupé-only glass rejected for GLE without body evidence before saving', async () => {
  const rad = { ...RAD, varenr:'5508AGAC', varenavn:'MERCEDES GLE COUPE W167 20- WS', eurokode:'5508AGACHMVZ1L', variant_id:'5508AGAC:5508AGACHMVZ1L' };
  const db = lagDb(rad);
  const ut = await send(db, { ...GRUNN, variantId:rad.variant_id, bil:{merke:'MERCEDES',modell:'GLE 350 DE 4MATIC',aar:2021} });
  assert.equal(ut.status,400,ut.tekst);
  assert.match(ut.tekst,/karosserivariant må avklares/);
  assert.equal(db.state.inserts,0);
  assert.equal(ut.epost.length,0);
});

test('explicit SUV cannot submit documented Coupé glass', async () => {
  const rad = { ...RAD, varenr:'5508AGAC', varenavn:'MERCEDES GLE COUPE W167 20- WS', eurokode:'5508AGACHMVZ1L', variant_id:'5508AGAC:5508AGACHMVZ1L' };
  const db = lagDb(rad);
  const ut = await send(db, { ...GRUNN, variantId:rad.variant_id, bil:{merke:'MERCEDES',modell:'GLE SUV',aar:2021} });
  assert.equal(ut.status,400,ut.tekst);
  assert.equal(db.state.inserts,0);
  assert.equal(ut.epost.length,0);
});
