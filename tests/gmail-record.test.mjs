import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordMessage } from '../src/routes/gmail-sync.ts';

function dbFixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec([
    'CREATE TABLE ops_messages(id TEXT PRIMARY KEY,inquiry_id INTEGER,request_id TEXT,direction TEXT,recipient TEXT,subject TEXT,body TEXT,status TEXT,provider_id TEXT UNIQUE,actor TEXT,created_at INTEGER,updated_at INTEGER);',
    'CREATE TABLE ops_mail_details(provider_id TEXT PRIMARY KEY,source TEXT,rfc_message_id TEXT,headers_json TEXT,attachments_json TEXT);',
  ].join('\n'));
  const statement = (sql, values = []) => ({
    bind: (...args) => statement(sql, args),
    first: async () => raw.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: raw.prepare(sql).run(...values).changes } }),
  });
  const db = {
    prepare: sql => statement(sql),
    batch: async queries => {
      raw.exec('BEGIN');
      try {
        const result = [];
        for (const query of queries) result.push(await query.run());
        raw.exec('COMMIT');
        return result;
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  const env = {
    ENVIRONMENT: 'production', FINNBILGLASS_DB: db,
    OPS_INBOUND_ADDRESS: 'support@finnbilglass.no', SUPPORT_FROM_EMAIL: 'support@finnbilglass.no',
  };
  return { raw, env };
}

function message(id, from, to) {
  return {
    id, labelIds: ['INBOX'], threadId: 'thread1',
    payload: { headers: [
      { name: 'From', value: from }, { name: 'To', value: to },
      { name: 'Subject', value: '[FBG-31] Camera mount' },
    ] },
  };
}

test('A multi-recipient support message is retained unassigned, not lost or auto-linked', async () => {
  const { raw, env } = dbFixture();
  try {
    const mail = message('msg1', 'customer@example.com', 'support@finnbilglass.no, someone@example.com');
    assert.equal(await recordMessage(env, mail, 'mailbox@gmail.com'), true);
    const stored = raw.prepare('SELECT * FROM ops_messages').all();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].inquiry_id, null);
    assert.equal(stored[0].recipient, 'customer@example.com');
    assert.equal(await recordMessage(env, mail, 'mailbox@gmail.com'), false);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM ops_messages').get().n, 1);
  } finally { raw.close(); }
});

test('Unrelated personal Gmail messages cannot be imported into the support ledger', async () => {
  const { raw, env } = dbFixture();
  try {
    const unrelated = message('msg2', 'friend@example.com', 'personal@gmail.com');
    assert.equal(await recordMessage(env, unrelated, 'personal@gmail.com'), false);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM ops_messages').get().n, 0);
  } finally { raw.close(); }
});
