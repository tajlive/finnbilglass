/**
 * P0 personvern: ugyldig registreringsnummer må ikke nå D1-loggene.
 * Reell SQLite (med foreign_keys=ON) via D1-lignende adapter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE regnr_logg (id INTEGER PRIMARY KEY, regnr TEXT, regnr_norm TEXT, ua TEXT);
    CREATE TABLE sok_logg (id INTEGER PRIMARY KEY, regnr TEXT, regnr_norm TEXT, ip TEXT, land TEXT, by TEXT, asn TEXT, ua TEXT);
  `);
  let writes = 0;
  const env = {
    SVV_API_KEY: undefined,
    FINNBILGLASS_DB: {
      prepare(sql) {
        const statement = {
          args: [],
          bind(...args) { this.args = args; return this; },
          async run() {
            writes++;
            const result = db.prepare(sql).run(...this.args);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async first() { return db.prepare(sql).get(...this.args) ?? null; },
          async all() { return { results: db.prepare(sql).all(...this.args) }; },
        };
        return statement;
      },
    },
  };
  return { db, env, getWrites: () => writes };
}

async function call(env, route, body) {
  const response = await worker.fetch(new Request('https://finnbilglass.no' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.42' },
    body: JSON.stringify(body),
  }), env);
  return { status: response.status, body: await response.json() };
}

test('ugyldige kjennemerker avvises før IP-/søkelogg og SVV-oppslag', async () => {
  const cases = ['X', 'AB123', 'AB123456', 'AB!12345', 'ABC12345', '1234567', 'AB12345xyz'];
  const fixture = setup();
  try {
    for (const regnr of cases) {
      const result = await call(fixture.env, '/api/regnr', { regnr });
      assert.equal(result.status, 400, `forventet 400 for ${regnr}`);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error, 'Ugyldig registreringsnummer');
    }
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM regnr_logg').get().n, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM sok_logg').get().n, 0);
    assert.equal(fixture.getWrites(), 0);
  } finally { fixture.db.close(); }
});

test('gyldig normalisert kjennemerke logger som før og beholder API-kontrakt', async () => {
  const fixture = setup();
  try {
    const response = await call(fixture.env, '/api/regnr', { regnr: ' su-18018 ' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.lagret, true);
    assert.equal(response.body.bil, null); // API-nøkkel er bevisst ikke satt i test
    assert.equal(fixture.db.prepare('SELECT regnr_norm FROM regnr_logg').get().regnr_norm, 'SU18018');
    const log = fixture.db.prepare('SELECT regnr_norm,ip FROM sok_logg').get();
    assert.equal(log.regnr_norm, 'SU18018');
    assert.equal(log.ip, '198.51.100.42');
  } finally { fixture.db.close(); }
});

test('fire sifre er gyldig, ugyldig format stoppes uten skriv', async () => {
  const fixture = setup();
  try {
    const response = await call(fixture.env, '/api/regnr', { regnr: 'ab 1234' });
    assert.equal(response.status, 200);
    assert.equal(fixture.db.prepare('SELECT regnr_norm FROM regnr_logg').get().regnr_norm, 'AB1234');
  } finally { fixture.db.close(); }
});

test('lookupOnly=true gir gyldig oppslag uten person- eller søkelogging', async () => {
  const fixture = setup();
  try {
    const response = await call(fixture.env, '/api/regnr', {
      regnr: 'SU18018', lookupOnly: true,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.lagret, false, 'lookupOnly skal aldri rapportere DB-lagring');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM regnr_logg').get().n, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM sok_logg').get().n, 0);
    assert.equal(fixture.getWrites(), 0);
  } finally { fixture.db.close(); }
});

test('ugyldige VIN-tegn avvises, gyldig 11–17 tegn gir normal 200-kontrakt', async () => {
  const fixture = setup();
  try {
    for (const vin of ['WVWZZZ1JZYW00000I', 'O0000000000', 'Q0000000000', 'VIN!!BAD12345']) {
      const result = await call(fixture.env, '/api/vin', { vin });
      assert.equal(result.status, 400, `forventet 400 for VIN ${vin}`);
    }
    const ok = await call(fixture.env, '/api/vin', { vin: 'WV1ZZZ7HZ5H060934' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(fixture.getWrites(), 0);
  } finally { fixture.db.close(); }
});
