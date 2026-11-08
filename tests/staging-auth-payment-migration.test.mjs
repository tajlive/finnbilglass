import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localD1 } from '../scripts/lib/local-d1.mjs';

const baseline = readFileSync('migrations/staging-auth/0001_adopt_existing_schema.sql', 'utf8');
const payment = readFileSync('migrations/staging-auth/0002_quote_payments.sql', 'utf8');
function setup() {
  const db = localD1(':memory:', { readOnly: false });
  db.exec(`CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY, navn TEXT NOT NULL, kontakt TEXT NOT NULL);
    CREATE TABLE glass_quotes(id INTEGER PRIMARY KEY AUTOINCREMENT, inquiry_id INTEGER NOT NULL, versjon INTEGER NOT NULL,
      pris_kr INTEGER NOT NULL, pris_type TEXT NOT NULL, sendt_at INTEGER);
    INSERT INTO beta_inquiries VALUES(1,'Test','test@example.invalid');
    INSERT INTO glass_quotes(id,inquiry_id,versjon,pris_kr,pris_type,sendt_at) VALUES(1,1,1,10000,'BEKREFTET',1);`);
  return db;
}

test('staging-auth baseline captures observed schema and is additive', async () => {
  const db = setup();
  db.exec(baseline);
  const row = await db.prepare('SELECT * FROM staging_auth_schema_baseline WHERE id = 1').first();
  assert.equal(row.schema_sha256, '7962be909f26d07303bc9875e7ed0614ef92864da2c98991b8eaead672eae702');
  assert.equal(row.table_count, 25);
  assert.equal(row.index_count, 26);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staging_auth_schema_baseline').first()).n, 1);
  db.close();
});

test('payment migration applies to the observed staging-auth inquiry and quote parents', async () => {
  const db = setup();
  db.exec(baseline);
  db.exec(payment);
  const fk = await db.prepare('PRAGMA foreign_key_list(quote_payment_orders)').all();
  assert.deepEqual(fk.results.map((x) => x.table).sort(), ['beta_inquiries', 'glass_quotes']);
  const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((x) => x.name);
  assert.ok(names.includes('quote_payment_orders'));
  assert.ok(names.includes('stripe_payment_events'));
  assert.ok(names.includes('stripe_payment_refunds'));
  const quoteColumns = await db.prepare('PRAGMA table_info(glass_quotes)').all();
  assert.ok(quoteColumns.results.some((x) => x.name === 'total_kr'));
  const orderColumns = await db.prepare('PRAGMA table_info(quote_payment_orders)').all();
  assert.ok(orderColumns.results.some((x) => x.name === 'checkout_url'));
  db.close();
});

test('payment ledger enforces one order per quote and idempotent refund/event ids', async () => {
  const db = setup();
  db.exec(baseline);
  db.exec(payment);
  const insertOrder = `INSERT INTO quote_payment_orders(id,request_id,inquiry_id,quote_id,quote_version,amount_minor,amount_breakdown_json,
    acceptance_method,acceptance_note,accepted_at,accepted_by,created_at,created_by,updated_at)
    VALUES(?,?,?,?,?,?,?,'PHONE','Customer approved total in call',1,'operator@example.invalid',1,'operator@example.invalid',1)`;
  await db.prepare(insertOrder).bind('o1','request-111',1,1,1,1000000,'{"vatRate":25}').run();
  await assert.rejects(db.prepare(insertOrder).bind('o2','request-222',1,1,1,1000000,'{"vatRate":25}').run());
  await db.prepare("INSERT INTO stripe_payment_events(event_id,event_type,received_at) VALUES('evt_1','checkout.session.completed',1)").run();
  await assert.rejects(db.prepare("INSERT INTO stripe_payment_events(event_id,event_type,received_at) VALUES('evt_1','checkout.session.completed',1)").run());
  await db.prepare("INSERT INTO stripe_payment_refunds(id,order_id,idempotency_key,amount_minor,reason,requested_by,created_at,updated_at) VALUES('r1','o1','refund-111',100,'test', 'operator',1,1)").run();
  await assert.rejects(db.prepare("INSERT INTO stripe_payment_refunds(id,order_id,idempotency_key,amount_minor,reason,requested_by,created_at,updated_at) VALUES('r2','o1','refund-111',100,'test', 'operator',1,1)").run());
  db.close();
});

test('staging migrations are isolated from default catalogue migration queue', () => {
  const config = readFileSync('wrangler.toml', 'utf8');
  const stagingConfig = readFileSync('wrangler.staging.toml', 'utf8');
  const stagingAuthBinding = /binding = "FINNBILGLASS_STAGING_AUTH"[\s\S]*?migrations_dir = "migrations\/staging-auth"/;
  assert.match(config, stagingAuthBinding);
  assert.match(stagingConfig, stagingAuthBinding);
  assert.doesNotMatch(payment, /\b(?:ALTER|DROP)\s+TABLE\s+ordre\b/i);
  assert.doesNotMatch(payment, /payload_json|raw_payload/i);
});
