import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {localD1} from '../scripts/lib/local-d1.mjs';
import {syncIncoming,mailSyncStatus} from '../src/ops-workbench/mail-sync.ts';
import {sendMail} from '../src/mail.ts';
import {verifyResendWebhook} from '../src/ops-workbench/mail-sync.ts';
function setup(){const db=localD1(':memory:',{readOnly:false});db.exec("CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,kontakt TEXT,navn TEXT,is_test INTEGER);INSERT INTO beta_inquiries VALUES(1,'kunde@example.invalid','Testkunde',1),(2,'annen@example.invalid','Annen',1);");for(const file of ['0051_ops_workbench.sql','0053_ops_mail_sync.sql'])db.exec(readFileSync('migrations/pending/'+file,'utf8'));return{db,env:{ENVIRONMENT:'test',FINNBILGLASS_DB:db,OPS_WORKBENCH_ENABLED:'true',RESEND_API_KEY:'local-test-key',OPS_INBOUND_ADDRESS:'fbg@local.resend.app',SUPPORT_EPOST:'support@example.invalid',RESEND_WEBHOOK_SECRET:'whsec_dGVzdDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEy'}};}
function mockFetch(fn){const old=globalThis.fetch;globalThis.fetch=fn;return()=>{globalThis.fetch=old;};}
const incoming=(overrides={})=>({id:'incoming-1',from:'Kunde <kunde@example.invalid>',to:['support@example.invalid'],subject:'Re: [FBG-1] Utstyr',text:'Her er bildet.',headers:{'message-id':'<message-1@example.invalid>'},attachments:[{id:'att-1',filename:'rute.jpg',content_type:'image/jpeg',size:123}],...overrides});
test('received mail is linked by exact sender and case, deduplicated, attachments retained',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>Response.json(incoming()));try{await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);const m=await db.prepare('SELECT * FROM ops_messages').first();assert.equal(m.inquiry_id,1);assert.equal(m.body,'Her er bildet.');assert.equal((await db.prepare('SELECT count(*) n FROM ops_messages').first()).n,1);const detail=await db.prepare('SELECT * FROM ops_mail_details').first();assert.equal(JSON.parse(detail.attachments_json)[0].filename,'rute.jpg');assert.equal(detail.rfc_message_id,'<message-1@example.invalid>');assert.equal((await mailSyncStatus(env)).lastSuccess>0,true);}finally{restore();db.close();}});
test('other project receiving alias ignored before provider fetch',async()=>{const{db,env}=setup();let calls=0;const restore=mockFetch(async()=>{calls++;throw Error('no');});try{const r=await syncIncoming(env,'other',['other@local.resend.app']);assert.equal(r.ignored,true);assert.equal(calls,0);}finally{restore();db.close();}});
test('unknown or mismatching sender remains unmatched; reference alone cannot claim a case',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>Response.json(incoming({from:'annen@example.invalid'})));try{await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);assert.equal((await db.prepare('SELECT inquiry_id FROM ops_messages').first()).inquiry_id,null);}finally{restore();db.close();}});
test('HTML-only mail becomes safe text, never executable markup',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>Response.json(incoming({text:null,html:'<p>Hei &amp; takk</p><script>alert(1)</script><img src=x onerror=alert(2)>'})));try{await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);const m=await db.prepare('SELECT body FROM ops_messages').first();assert.match(m.body,/Hei & takk/);assert.doesNotMatch(m.body,/<|alert|onerror/);}finally{restore();db.close();}});
test('customer sends are archived once, prefixed, and private login codes are excluded',async()=>{const{db,env}=setup();let calls=0,last;const restore=mockFetch(async(u,init)=>{calls++;last=JSON.parse(init.body);return Response.json({id:'sent-1'});});try{const mail={to:'kunde@example.invalid',subject:'Kvittering',text:'Mottatt',html:'<p>Mottatt</p>',caseContext:{inquiryId:1,key:'receipt-1',kind:'receipt'}};assert.equal((await sendMail(env,mail)).ok,true);assert.equal((await sendMail(env,mail)).ok,true);assert.equal(calls,1);assert.match(last.subject,/\[FBG-1\]/);assert.equal((await db.prepare('SELECT count(*) n FROM ops_messages').first()).n,1);assert.equal((await db.prepare('SELECT status FROM ops_messages').first()).status,'SENT');await sendMail(env,{to:'kunde@example.invalid',subject:'Engangskode',text:'123456',html:'123456'});assert.equal((await db.prepare('SELECT count(*) n FROM ops_messages').first()).n,1);}finally{restore();db.close();}});
test('failed transport is visible and never falsely called sent',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>new Response('unavailable',{status:503}));try{const r=await sendMail(env,{to:'kunde@example.invalid',subject:'Svar',text:'Hei',html:'Hei',caseContext:{inquiryId:1,key:'failed-1',kind:'reply'}});assert.equal(r.ok,false);assert.equal((await db.prepare('SELECT status FROM ops_messages').first()).status,'FAILED');}finally{restore();db.close();}});
test('explicit sender authentication failure is quarantined despite matching name and reference',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>Response.json(incoming({authentication:{dmarc:'fail',dkim:'fail',spf:'fail'}})));try{await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);assert.equal((await db.prepare('SELECT inquiry_id FROM ops_messages').first()).inquiry_id,null);}finally{restore();db.close();}});
test('oversized provider response is bounded and sync failure is visible',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>new Response('x'.repeat(10),{headers:{'Content-Length':'100000000'}}));try{await assert.rejects(()=>syncIncoming(env,'incoming-1',['fbg@local.resend.app']),/stor/);assert.ok((await mailSyncStatus(env)).error);}finally{restore();db.close();}});
test('legacy composite contact with one email remains sendable; ambiguous contacts rejected',async()=>{const{db,env}=setup();await db.prepare("UPDATE beta_inquiries SET kontakt='kunde@example.invalid · 90000000' WHERE id=1").run();const restore=mockFetch(async()=>Response.json({id:'sent-composite'}));try{assert.equal((await sendMail(env,{to:'kunde@example.invalid',subject:'Svar',text:'Hei',html:'Hei',caseContext:{inquiryId:1,key:'composite',kind:'reply'}})).ok,true);await db.prepare("UPDATE beta_inquiries SET kontakt='kunde@example.invalid / annen@example.invalid' WHERE id=1").run();assert.equal((await sendMail(env,{to:'kunde@example.invalid',subject:'Svar',text:'Hei',html:'Hei',caseContext:{inquiryId:1,key:'ambiguous',kind:'reply'}})).ok,false);}finally{restore();db.close();}});
test('explicit authentication failure headers quarantine; forged pass never overrides server failure',async()=>{for(const data of [{headers:{'authentication-results':'mx.example; dmarc=fail header.from=example.invalid'}},{headers:{'authentication-results':'mx.example; dmarc=pass'},authentication:{dmarc:'fail'}}]){const{db,env}=setup();const restore=mockFetch(async()=>Response.json(incoming(data)));try{await syncIncoming(env,'incoming-1',['fbg@local.resend.app']);assert.equal((await db.prepare('SELECT inquiry_id FROM ops_messages').first()).inquiry_id,null);}finally{restore();db.close();}}});
test('reused sending key cannot silently confirm different content',async()=>{const{db,env}=setup();const restore=mockFetch(async()=>Response.json({id:'sent-once'}));try{const mail={to:'kunde@example.invalid',subject:'Svar',text:'Første',html:'Første',caseContext:{inquiryId:1,key:'same-content',kind:'reply'}};assert.equal((await sendMail(env,mail)).ok,true);assert.equal((await sendMail(env,{...mail,text:'Endret pris'})).ok,false);}finally{restore();db.close();}});
test('archive error after provider acceptance never reports the email as unsent',async()=>{const{db,env}=setup();const prepare=db.prepare.bind(db);db.prepare=function(sql){if(sql.includes('INSERT OR IGNORE INTO ops_mail_details'))throw Error('synthetic archive outage');return prepare(sql);};const restore=mockFetch(async()=>Response.json({id:'accepted-before-outage'}));try{const r=await sendMail(env,{to:'kunde@example.invalid',subject:'Svar',text:'Hei',html:'Hei',caseContext:{inquiryId:1,key:'archive-outage',kind:'reply'}});assert.equal(r.ok,true);assert.equal(r.providerId,'accepted-before-outage');assert.ok(r.trackingWarning);assert.equal((await db.prepare('SELECT status FROM ops_messages').first()).status,'SENT');}finally{restore();db.close();}});

// --- New tests for webhook signature verification ---
test('webhook signature verification rejects invalid signatures',async()=>{const{env}=setup();const rawBody=JSON.stringify({providerId:'test',event_type:'email.sent',message_id:'msg-1'});const headers=new Headers();headers.set('svix-id','msg-1');headers.set('svix-timestamp',String(Math.floor(Date.now()/1000)));headers.set('svix-signature','v1,invalidsignature');const result=await verifyResendWebhook(env,rawBody,headers);assert.equal(result,false);});

test('webhook signature verification accepts valid signatures',async()=>{const{env}=setup();const rawBody=JSON.stringify({providerId:'test',event_type:'email.sent',message_id:'msg-1'});const headers=new Headers();const timestamp=String(Math.floor(Date.now()/1000));headers.set('svix-id','msg-1');headers.set('svix-timestamp',timestamp);const secret=env.RESEND_WEBHOOK_SECRET;const encoder=new TextEncoder();const rawKey=Uint8Array.from(atob(secret.replace(/^whsec_/,'')),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(`msg-1.${timestamp}.${rawBody}`));const sigB64=btoa(String.fromCharCode(...new Uint8Array(signature)));headers.set('svix-signature',`v1,${sigB64}`);const result=await verifyResendWebhook(env,rawBody,headers);assert.equal(result,true);});

test('webhook signature verification rejects expired timestamps',async()=>{const{env}=setup();const rawBody=JSON.stringify({providerId:'test',event_type:'email.sent',message_id:'msg-1'});const headers=new Headers();headers.set('svix-id','msg-1');headers.set('svix-timestamp',String(Math.floor(Date.now()/1000)-400));const secret='whsec_test12345678901234567890123456789012';const encoder=new TextEncoder();const rawKey=Uint8Array.from(atob(secret.replace(/^whsec_/,'')),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(`msg-1.${headers.get('svix-timestamp')}.${rawBody}`));const sigB64=btoa(String.fromCharCode(...new Uint8Array(signature)));headers.set('svix-signature',`v1,${sigB64}`);const result=await verifyResendWebhook(env,rawBody,headers);assert.equal(result,false);});

test('webhook signature verification rejects missing secret',async()=>{const{db}=setup();const env={ENVIRONMENT:'test',FINNBILGLASS_DB:db,OPS_WORKBENCH_ENABLED:'true',RESEND_API_KEY:'local-test-key',OPS_INBOUND_ADDRESS:'fbg@local.resend.app',SUPPORT_EPOST:'support@example.invalid'};const rawBody=JSON.stringify({providerId:'test',event_type:'email.sent',message_id:'msg-1'});const headers=new Headers();headers.set('svix-id','msg-1');headers.set('svix-timestamp',String(Math.floor(Date.now()/1000)));const result=await verifyResendWebhook(env,rawBody,headers);assert.equal(result,false);});

test('Gmail sync status returns configured state',async()=>{const{db,env}=setup();const{gmailSyncStatus}=await import('../src/routes/gmail-sync');const status=await gmailSyncStatus(env);assert.equal(status.configured,false);assert.equal(status.lastSync,null);});

// --- New tests for Gmail sync cross-provider deduplication ---
test('Gmail sync skips message already stored via Resend by RFC Message-ID',async()=>{const{db,env}=setup();const{syncGmailEmails}=await import('../src/routes/gmail-sync');

// Pre-insert a message via Resend webhook flow
await db.batch([
  db.prepare(`INSERT INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at) VALUES(?,?,?,'IN',?,?,?,'RECEIVED',?,'resend',?,?)`)
    .bind('resend-msg-1', 1, 'resend-msg-1', 'kunde@example.invalid', 'Test', 'Body', 'resend-msg-1', Date.now(), Date.now()),
  db.prepare(`INSERT INTO ops_mail_details(provider_id,source,rfc_message_id,headers_json,attachments_json) VALUES(?,'resend',?,?,?)`)
    .bind('resend-msg-1', '<common-message-id@example.invalid>', '{}', '[]'),
]);

// Mock Gmail API responses
let gmailCalls = 0;
const restore = mockFetch(async(url) => {
  gmailCalls++;
  if (url.includes('/users/me/profile')) {
    return Response.json({ emailAddress: 'support@finnbilglass.no', historyId: '1000' });
  }
  if (url.includes('/users/me/history')) {
    return Response.json({ history: [], historyId: '1000', expired: false });
  }
  if (url.includes('/users/me/messages')) {
    return Response.json({ messages: [{ id: 'gmail-msg-1', threadId: 't1' }] });
  }
  if (url.includes('/users/me/messages/gmail-msg-1')) {
    return Response.json({
      id: 'gmail-msg-1',
      threadId: 't1',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'Message-ID', value: '<common-message-id@example.invalid>' },
          { name: 'From', value: 'Kunde <kunde@example.invalid>' },
          { name: 'To', value: 'support@finnbilglass.no' },
          { name: 'Subject', value: 'Re: [FBG-1] Test' }
        ],
        body: { data: Buffer.from('Gmail body').toString('base64') }
      }
    });
  }
  return new Response('Not found', { status: 404 });
});

try {
  // Add Gmail tokens to env
  env.GMAIL_SYNC_ENABLED = 'true';
  env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
  env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';

  const result = await syncGmailEmails(env);

  // Should skip because RFC Message-ID already exists via Resend
  assert.equal(result.synced, 0);
  const count = (await db.prepare('SELECT count(*) n FROM ops_messages').first()).n;
  assert.equal(count, 1);
} finally {
  restore();
  db.close();
}});

test('Gmail sync handles history expiration (404) with full resync',async()=>{const{db,env}=setup();const{syncGmailEmails}=await import('../src/routes/gmail-sync');

// Pre-set expired history ID
await db.prepare(`INSERT INTO ops_mail_sync_state(channel,last_success,last_error,history_id,updated_at) VALUES(?,?,?,?,?)`)
  .bind('gmail_sync', Date.now(), null, '999', Date.now()).run();

let gmailCalls = 0;
// Mock everything to avoid network calls
const { getGmailTokens } = await import('../src/ops-workbench/gmail-sync');
const originalGetGmailTokens = getGmailTokens;
// We can't easily mock the exported function directly without some trickery or changing code structure.
// Instead, let's mock fetch globally to handle ALL requests including the one in getGmailTokens
const restore = mockFetch(async(url, init) => {
  gmailCalls++;
  if (url === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'fake-token', expires_in: 3600, token_type: 'Bearer' });
  }
  if (url.includes('/users/me/profile')) {
    return Response.json({ emailAddress: 'support@finnbilglass.no', historyId: '2000' });
  }
  if (url.includes('/users/me/history')) {
    // Return expired response
    return new Response(JSON.stringify({ error: { code: 404, message: 'History not found' } }), { status: 404 });
  }
  if (url.includes('/users/me/messages') && !url.includes('/messages/')) {
    return Response.json({ messages: [{ id: 'gmail-msg-new', threadId: 't1' }] });
  }
  if (url.includes('/users/me/messages/gmail-msg-new')) {
    return Response.json({
      id: 'gmail-msg-new',
      threadId: 't1',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'Message-ID', value: '<new-message-id@example.invalid>' },
          { name: 'From', value: 'Kunde <kunde@example.invalid>' },
          { name: 'To', value: 'support@finnbilglass.no' },
          { name: 'Subject', value: 'Re: [FBG-1] New test' }
        ],
        body: { data: Buffer.from('New body').toString('base64') }
      }
    });
  }
  return new Response('Not found', { status: 404 });
});

try {
  env.GMAIL_SYNC_ENABLED = 'true';
  env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
  env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';

  const result = await syncGmailEmails(env);

  // Should fall back to full sync and process the message
  assert.equal(result.synced, 1);
  const count = (await db.prepare('SELECT count(*) n FROM ops_messages').first()).n;
  assert.equal(count, 1);

  // History ID should be updated
  const state = await db.prepare('SELECT history_id FROM ops_mail_sync_state WHERE channel=?').bind('gmail_sync').first();
  assert.equal(state?.history_id, '2000');
} finally {
  restore();
  db.close();
}});

test('Gmail sync status returns history ID from dedicated column',async()=>{const{db,env}=setup();const{gmailSyncStatus}=await import('../src/routes/gmail-sync');

// Insert state with history_id
await db.prepare(`INSERT INTO ops_mail_sync_state(channel,last_success,last_error,history_id,updated_at) VALUES(?,?,?,?,?)`)
  .bind('gmail_sync', Date.now(), null, '12345', Date.now()).run();

const status = await gmailSyncStatus(env);
assert.equal(status.gmailHistoryId, '12345');
assert.equal(status.lastSync !== null, true);
});
