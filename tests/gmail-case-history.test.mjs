import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getEpostHistorikk } from '../src/routes/epost.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec([
    'CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY);',
    'CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY, inquiry_id INTEGER, event_type TEXT, note TEXT, created_at INTEGER, created_by TEXT, meta_json TEXT);',
    'CREATE TABLE ops_messages(id TEXT PRIMARY KEY, inquiry_id INTEGER, direction TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, provider_id TEXT, actor TEXT, created_at INTEGER);',
  ].join('\n'));
  const d1 = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => sqlite.prepare(sql).get(...args) ?? null,
            all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
          };
        },
      };
    },
  };
  return { sqlite, env: { ENVIRONMENT: 'production', FINNBILGLASS_DB: d1 } };
}

test('Operations: combines email and activity exactly once per provider, isolated by case', async () => {
  const { sqlite, env } = fixture();
  try {
    sqlite.exec('INSERT INTO beta_inquiries(id) VALUES(31),(32)');
    const events = sqlite.prepare('INSERT INTO beta_inquiry_events VALUES(?,?,?,?,?,?,?)');
    events.run('evt-resend', 31, 'reply', 'Hello customer', 10, 'operator', JSON.stringify({ provider_message_id: 'resend_1' }));
    events.run('evt-note', 31, 'note', 'Check camera mount', 13, 'operator', null);
    events.run('evt-other', 32, 'note', 'Secret case 32', 14, 'operator', null);
    const insert = sqlite.prepare('INSERT INTO ops_messages VALUES(?,?,?,?,?,?,?,?,?,?)');
    insert.run('out-1', 31, 'OUT', 'same@example.com', 'Re: case 31', 'Hello customer', 'SENT', 'resend_1', 'operator', 10);
    insert.run('in-1', 31, 'IN', 'same@example.com', 'Re: case 31', 'Here is my VIN', 'RECEIVED', 'gmail_A', 'customer', 11);
    insert.run('in-2', 32, 'IN', 'same@example.com', 'Re: case 32', 'Do not leak this', 'RECEIVED', 'gmail_B', 'customer', 15);
    const result = await getEpostHistorikk(env, 31);
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.ok, true);
    assert.equal(data.historikk.length, 3);
    assert.deepEqual(data.historikk.map(x => x.id), ['evt-note', 'in-1', 'out-1']);
    assert.equal(data.historikk.find(x => x.id === 'in-1').type, 'incoming');
    assert.doesNotMatch(JSON.stringify(data), /Do not leak|Secret case 32/);
    assert.equal(new Set(data.historikk.map(x => x.id)).size, data.historikk.length);
  } finally { sqlite.close(); }
});

test('Operations: unknown case yields 404 instead of an empty success', async () => {
  const { sqlite, env } = fixture();
  try {
    const response = await getEpostHistorikk(env, 333);
    assert.equal(response.status, 404);
  } finally { sqlite.close(); }
});
