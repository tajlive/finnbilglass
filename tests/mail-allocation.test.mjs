import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { unassignedMail, assignUnmatchedMail } from '../src/routes/mail-allocation.ts';

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec([
    'CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,kontakt TEXT);',
    'CREATE TABLE ops_messages(id TEXT PRIMARY KEY,inquiry_id INTEGER,direction TEXT,recipient TEXT,subject TEXT,body TEXT,created_at INTEGER,updated_at INTEGER);',
    'CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER,created_by TEXT,meta_json TEXT);',
  ].join('\n'));
  const prepare = (sql, values = []) => ({
    first: async () => raw.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...values) }),
    run: async () => {
      const r = raw.prepare(sql).run(...values);
      return { meta: { changes: r.changes } };
    },
    bind: (...more) => prepare(sql, more),
  });
  const db = {
    prepare: sql => prepare(sql),
    batch: async statements => {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        raw.exec('COMMIT');
        return out;
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return { raw, env: { ENVIRONMENT: 'production', FINNBILGLASS_DB: db } };
}

function req(inquiryId, reason = 'Kunden bekreftet saken per telefon') {
  return new Request('https://example.test/ops/mail/assign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inquiryId, reason }),
  });
}

test('Unassigned: only unlinked messages are listed, body is truncated', async () => {
  const { raw, env } = makeDb();
  try {
    raw.prepare('INSERT INTO ops_messages VALUES(?,?,?,?,?,?,?,?)').run('gmail-1', null, 'IN', 'customer@example.com', 'New message', 'a'.repeat(400), 1, 1);
    raw.prepare('INSERT INTO ops_messages VALUES(?,?,?,?,?,?,?,?)').run('gmail-2', 31, 'IN', 'other@example.com', 'Private', 'Never shown', 2, 2);
    const response = await unassignedMail(env);
    const body = await response.json();
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].id, 'gmail-1');
    assert.equal(body.messages[0].body.length, 280);
    assert.doesNotMatch(JSON.stringify(body), /Never shown/);
  } finally { raw.close(); }
});

test('Assignment: rejects different customer, keeps old state unchanged', async () => {
  const { raw, env } = makeDb();
  try {
    raw.exec("INSERT INTO beta_inquiries VALUES(31,'owner@example.com'),(32,'other@example.com')");
    raw.prepare('INSERT INTO ops_messages VALUES(?,?,?,?,?,?,?,?)').run('gmail-1', null, 'IN', 'owner@example.com', 'Test', 'abc', 1, 1);
    const response = await assignUnmatchedMail(env, req(32), 'gmail-1', 'staff@example.com');
    assert.equal(response.status, 409);
    assert.equal(raw.prepare("SELECT inquiry_id FROM ops_messages WHERE id='gmail-1'").get().inquiry_id, null);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM beta_inquiry_events').get().n, 0);
  } finally { raw.close(); }
});

test('Assignment: unique manual link is atomic, audited, not silently repeatable', async () => {
  const { raw, env } = makeDb();
  try {
    raw.exec("INSERT INTO beta_inquiries VALUES(31,'92867502 · owner@example.com'),(32,'owner@example.com')");
    raw.prepare('INSERT INTO ops_messages VALUES(?,?,?,?,?,?,?,?)').run('gmail-1', null, 'IN', 'owner@example.com', 'Test', 'abc', 1, 1);
    const first = await assignUnmatchedMail(env, req(31), 'gmail-1', 'operator@example.com');
    assert.equal(first.status, 200);
    assert.equal(raw.prepare("SELECT inquiry_id FROM ops_messages WHERE id='gmail-1'").get().inquiry_id, 31);
    const audit = raw.prepare('SELECT * FROM beta_inquiry_events').all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].created_by, 'operator@example.com');
    assert.match(audit[0].note, /tilordnet manuelt/);
    const second = await assignUnmatchedMail(env, req(32), 'gmail-1', 'operator@example.com');
    assert.equal(second.status, 409);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM beta_inquiry_events').get().n, 1);
  } finally { raw.close(); }
});

test('Assignment: missing reason or malformed ID rejected before writes', async () => {
  const { raw, env } = makeDb();
  try {
    assert.equal((await assignUnmatchedMail(env, req(31), '../invalid', 'staff')).status, 400);
    assert.equal((await assignUnmatchedMail(env, req(31, 'short'), 'gmail-1', 'staff')).status, 400);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM beta_inquiry_events').get().n, 0);
  } finally { raw.close(); }
});
