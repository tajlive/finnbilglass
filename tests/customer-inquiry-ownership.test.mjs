import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/pending/0057_customer_inquiry_ownership.sql', import.meta.url), 'utf8');

test('customer inquiry reads are scoped only by authenticated customer_id', () => {
  assert.match(source, /FROM beta_inquiries WHERE customer_id = \?/);
  assert.doesNotMatch(source, /session_id = \? OR kontakt = \?/);
  assert.doesNotMatch(source, /session_id = \?\)\s*['`,]/);
});

test('new inquiries bind customer_id only from the authenticated session', () => {
  assert.match(source, /const authenticatedCustomer = await requireAuth\(request\)/);
  assert.match(source, /authenticatedCustomer\?\.userId \?\? null/);
  assert.match(source, /INSERT INTO beta_inquiries \([^)]*customer_id/);
});

test('ownership migration adds nullable customer_id and an index without rewriting old inquiries', () => {
  assert.match(migration, /ALTER TABLE beta_inquiries ADD COLUMN customer_id TEXT/);
  assert.match(migration, /CREATE INDEX[^;]*customer_id/);
  assert.doesNotMatch(migration, /UPDATE beta_inquiries/);
});
