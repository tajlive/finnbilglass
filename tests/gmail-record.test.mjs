import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordMessage } from '../src/routes/gmail-sync.ts';

function dbFixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec([
    'CREATE TABLE ops_messages(id TEXT PRIMARY KEY,inquiry_id INTEGER,request_id TEXT,direction TEXT,recipient TEXT,subject TEXT,body TEXT,status TEXT,provider_id TEXT UNIQUE,actor TEXT,created_at INTEGER,updated_at INTEGER);',
    'CREATE TABLE ops_mail_details(provider_id TEXT PRIMARY KEY,source TEXT,rfc_message_id TEXT,headers_json TEXT,attachments_json TEXT);',
    'CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,kontakt TEXT NOT NULL);',
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
  raw.prepare('INSERT INTO beta_inquiries(id,kontakt) VALUES(?,?)').run(31, 'kunde@example.com');
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


test('Manual Gmail SENT from the approved Workspace mailbox is mirrored without broadening incoming aliases',async()=>{
  const {raw,env}=dbFixture();
  Object.assign(env,{
    OPS_WORKSPACE_OAUTH_ENABLED:'true',
    OPS_GMAIL_EXPECTED_MAILBOX:'tomarne@finnbilglass.no'
  });
  try {
    const sent=message('sent-workspace-1','tomarne@finnbilglass.no','kunde@example.com');
    sent.labelIds=['SENT'];
    sent.payload.headers.find(h=>h.name==='Subject').value='Manuell e-post til kunde';
    assert.equal(await recordMessage(env,sent,'tomarne@finnbilglass.no'),true);
    const stored=raw.prepare('SELECT direction,recipient,actor,inquiry_id FROM ops_messages').all();
    assert.equal(stored.length,1);
    assert.equal(stored[0].direction,'OUT');
    assert.equal(stored[0].recipient,'kunde@example.com');
    assert.equal(stored[0].actor,'gmail-manual');
    assert.equal(stored[0].inquiry_id,null);
    assert.equal(await recordMessage(env,sent,'tomarne@finnbilglass.no'),false,
      'same message must not be imported twice');

    // A direct personal message to the Workspace mailbox is not an OPS
    // incoming address unless an administrator explicitly configures it.
    const personal=message('personal-1','venn@example.com','tomarne@finnbilglass.no');
    personal.payload.headers.find(h=>h.name==='Subject').value='Privat melding';
    assert.equal(await recordMessage(env,personal,'tomarne@finnbilglass.no'),false);

    // The Gmail authenticated mailbox must match the approved OAuth mailbox.
    const mismatched=message('sent-unverified-1','tomarne@finnbilglass.no','kunde2@example.com');
    mismatched.labelIds=['SENT'];
    assert.equal(await recordMessage(env,mismatched,'different@finnbilglass.no'),false);
    const unknownSent=message('sent-unrelated-1','tomarne@finnbilglass.no','friend@example.com');
    unknownSent.labelIds=['SENT'];
    assert.equal(await recordMessage(env,unknownSent,'tomarne@finnbilglass.no'),false,
      'unrelated outgoing Workspace mail must not enter OPS');
    const ambiguousSent=message('sent-multi-1','tomarne@finnbilglass.no','kunde@example.com, friend@example.com');
    ambiguousSent.labelIds=['SENT'];
    assert.equal(await recordMessage(env,ambiguousSent,'tomarne@finnbilglass.no'),false,
      'multi-recipient outgoing mail is not safe to mirror');
    const forged=message('sent-personal-1','personal@gmail.com','kunde3@example.com');
    forged.labelIds=['SENT'];
    assert.equal(await recordMessage(env,forged,'tomarne@finnbilglass.no'),false);

    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM ops_messages').get().n,1);
  } finally {raw.close()}
});


test('Norwegian UTF-8 Gmail text survives base64url decoding and D1 storage unchanged',async()=>{
  const {raw,env}=dbFixture();
  try {
    const mail=message('utf8-norwegian','kunde@example.com','support@finnbilglass.no');
    mail.payload.headers.find(h=>h.name==='Subject').value='Norsk bilglassforespørsel';
    mail.payload.mimeType='text/plain';
    const original='Hei! Jeg trenger ny frontrute på en blå bil. Pris på glass og frakt? Ønsker ærlig svar.';
    mail.payload.body={data:Buffer.from(original,'utf8').toString('base64url'),size:Buffer.byteLength(original,'utf8')};
    assert.equal(await recordMessage(env,mail,'tomarne@finnbilglass.no'),true);
    const body=raw.prepare('SELECT body FROM ops_messages WHERE provider_id=?').get('gmail-utf8-norwegian').body;
    assert.equal(body,original);
    assert.doesNotMatch(body,/Ã|�/,'body must not contain mojibake or replacement characters');
  }finally{raw.close()}
});


test('Known customer with number and email is eligible but unreferenced Sent stays unassigned', async () => {
  const {raw,env}=dbFixture();
  Object.assign(env,{
    OPS_WORKSPACE_OAUTH_ENABLED:'true',
    OPS_GMAIL_EXPECTED_MAILBOX:'tomarne@finnbilglass.no'
  });
  try {
    raw.prepare('UPDATE beta_inquiries SET kontakt=? WHERE id=31').run('92867502 · kunde@example.com');
    const mail=message('customer-sent-2','tomarne@finnbilglass.no','kunde@example.com');
    mail.labelIds=['SENT'];
    mail.payload.headers.find(h=>h.name==='Subject').value='Manuelt svar uten saksreferanse';
    assert.equal(await recordMessage(env,mail,'tomarne@finnbilglass.no'),true);
    const stored=raw.prepare('SELECT inquiry_id,direction FROM ops_messages WHERE provider_id=?')
      .get('gmail-customer-sent-2');
    assert.equal(stored.inquiry_id,null);
    assert.equal(stored.direction,'OUT');
    assert.equal(await recordMessage(env,mail,'tomarne@finnbilglass.no'),false);
  } finally {raw.close();}
});
