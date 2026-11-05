// Launch-gate v2 — tester som svarer på CTO-innvendingene i testplan-runde 2:
//   (1) kundegrensesnittet skal ikke lekke interne data eller admin-flater,
//   (4) testinnsendinger skal være isolerte og testmerket uansett kontaktformat,
//   (5) tilgangskontroll: offentlig host skal aldri nå /ops eller /api/ops.
//
// Testene kjører helt lokalt: worker.fetch mot en mock-D1. Ingen nettverk,
// ingen e-post (RESEND_API_KEY mangler → varselet logges som feilet), ingen
// skriving til staging eller produksjon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

/** Mock-D1 som husker bind-argumentene, slik at vi kan inspisere INSERT-raden. */
function mockDb() {
  const statements = [];
  const db = {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...v) { stmt.args = v; return stmt; },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      };
      statements.push(stmt);
      return stmt;
    },
    async batch(stmts) {
      statements.push(...stmts);
      return [{ meta: { last_row_id: 42 } }, { meta: { changes: 1 } }];
    },
  };
  return { db, statements };
}

function env(over = {}) {
  const { db } = mockDb();
  return {
    ENVIRONMENT: 'production',
    inquiries_enabled: 'true',
    FINNBILGLASS_DB: db,
    ...over,
  };
}

async function kall(path, { method = 'GET', body, host = 'finnbilglass.no', headers = {} } = {}) {
  const res = await worker.fetch(
    new Request(`https://${host}${path}`, {
      method,
      // Host må settes eksplisitt: undici fyller ikke Request.headers «host» før
      // pakken sendes, så uten dette ser hostname-isolasjonen null i enhetstester.
      headers: { 'content-type': 'application/json', host, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env(),
    { waitUntil() {} },
  );
  const tekst = await res.text();
  let data = null;
  try { data = JSON.parse(tekst); } catch { /* html */ }
  return { status: res.status, data, tekst, location: res.headers.get('Location') };
}

// ── (5) Hostname-isolasjon: admin-flaten er utilgjengelig fra offentlig domene ──

test('offentlig host: /ops leder til Access-host og lekker ikke admin-innhold', async () => {
  const r = await kall('/ops');
  assert.equal(r.status, 302);
  assert.equal(r.location, 'https://ops.finnbilglass.no/ops');
  assert.ok(!/saksbehandler|innboks|api\/ops/i.test(r.tekst), 'offentlig /ops-svar skal ikke inneholde admin-innhold');
});

test('offentlig host: /api/ops/… avvises før autentisering (403, ikke 401)', async () => {
  const r = await kall('/api/ops/r2-inventar');
  assert.equal(r.status, 403, 'hostname-sjekken skal ligge foran auth-sjekken');
});

test('ops-host uten sesjon: /api/ops/… gir 401 (ikke åpent, ikke 403)', async () => {
  const r = await kall('/api/ops/r2-inventar', { host: 'ops.finnbilglass.no' });
  assert.equal(r.status, 401);
});

// ── (1) Kundegrensesnittet skal ikke eksponere interne identifikatorer ──

test('offentlig kundesvar: ingen eurokode, innkjøpspris eller leverandørnavn i feilsvar', async () => {
  const r = await kall('/api/regnr', { method: 'POST', body: {} });
  assert.ok(r.status >= 400 && r.status < 500, `forventet klientfeil, fikk ${r.status}`);
  const tekst = r.tekst.toLowerCase();
  for (const lekkasje of ['eurokode', 'innkjøpspris', 'leverandør', 'glavista', 'autoglass']) {
    assert.ok(!tekst.includes(lekkasje), `offentlig svar lekker «${lekkasje}»`);
  }
});

// ── (4) Testmerking: kjørings-ID gjør saken testmerket uansett kontaktformat ──

async function innsending(sessionId, kontakt) {
  const { db, statements } = mockDb();
  const res = await worker.fetch(
    new Request('https://finnbilglass.no/api/inquiry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regnr: 'AB12345', navn: 'Syntetisk Test', kontakt, melding: 'test', sessionId }),
    }),
    { ENVIRONMENT: 'production', inquiries_enabled: 'true', FINNBILGLASS_DB: db },
    { waitUntil() {} },
  );
  const insert = statements.find((s) => /INSERT INTO beta_inquiries/i.test(s.sql));
  return { status: res.status, args: insert?.args ?? [] };
}

test('kjørings-ID TEST-<runId>-<testId> merker saken som test selv med telefonnummer', async () => {
  const { status, args } = await innsending('TEST-RUN-20261104-T0001', '12345678');
  assert.equal(status, 201);
  assert.equal(args[6], 1, 'is_test skal være 1 når sessionId starter med TEST-');
  assert.equal(args[4], 'TEST-RUN-20261104-T0001', 'kjørings-ID-en skal lagres som session_id');
});

test('reell kunde uten testmønster blir ikke testmerket', async () => {
  const { status, args } = await innsending('sess-abc123', 'kunde@eksempel.no');
  assert.equal(status, 201);
  assert.equal(args[6], 0, 'vanlig kunde skal aldri merkes som test');
});

test('testdomene i kontakt merkes som test uavhengig av kjørings-ID', async () => {
  const { status, args } = await innsending('sess-abc123', 'noe@example.com');
  assert.equal(status, 201);
  assert.equal(args[6], 1);
});
