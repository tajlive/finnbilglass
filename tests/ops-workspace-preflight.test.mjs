import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { checkWorkspaceGmailPreflight } from '../src/ops-workspace-preflight.ts';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const keyBytes=Buffer.alloc(32,17);
const encryptionKey=keyBytes.toString('base64url');
const expected='tomarne@finnbilglass.no';

async function encryptRefresh(value) {
  const key=await webcrypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=Buffer.alloc(12,9);
  const bytes=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:Buffer.from('finnbilglass/workspace-gmail/staging')},
    key,Buffer.from(value));
  return Buffer.concat([iv,Buffer.from(bytes)]).toString('base64url');
}

function mockEnv(grant, alias) {
  return {
    ENVIRONMENT:'staging',OPS_WORKSPACE_OAUTH_ENABLED:'true',
    OPS_GMAIL_EXPECTED_MAILBOX:expected,OPS_GMAIL_TOKEN_ENCRYPTION_KEY:encryptionKey,
    GOOGLE_OAUTH_CLIENT_ID:'test-client.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET:'test-secret',
    GMAIL_SYNC_ENABLED:'false',
    ...(alias===undefined?{}:{OPS_INBOUND_ADDRESS:alias}),
    FINNBILGLASS_DB:{
      prepare(sql) {
        if (!sql.includes('ops_workspace_gmail_tokens')) throw Error('Unexpected DB read');
        return {async first() {return grant}};
      }
    }
  };
}

test('No approved grant cannot call Gmail or turn on import',async()=>{
  const prev=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('Unexpected external call')};
  try{
    const response=await checkWorkspaceGmailPreflight(mockEnv(null));
    assert.equal(response.reason,'NOT_CONNECTED');
    assert.equal(response.mailboxVerified,false);
    assert.equal(response.importEnabled,false);
    assert.equal(response.ok,false);
    assert.ok(!JSON.stringify(response).includes('test-secret'));
  } finally {globalThis.fetch=prev}
});

test('Valid AES-GCM grant refreshes and checks profile only; missing alias blocks controlled import',async()=>{
  const grant={id:'primary',mailbox:expected,status:'ACTIVE',
    connected_at:Date.now(),refresh_ciphertext:await encryptRefresh('synthetic-refresh-token')};
  const env=mockEnv(grant);
  const calls=[],prev=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));
    if(String(url)==='https://oauth2.googleapis.com/token'){
      assert.equal(options?.method,'POST');
      return Response.json({access_token:'synthetic-access-token',expires_in:3600,token_type:'Bearer'});
    }
    if(String(url)==='https://gmail.googleapis.com/gmail/v1/users/me/profile'){
      assert.equal(options?.headers?.Authorization,'Bearer synthetic-access-token');
      return Response.json({emailAddress:expected,historyId:'123456'});
    }
    throw Error('No list, message read or write API permitted in preflight');
  };
  try{
    const result=await checkWorkspaceGmailPreflight(env);
    assert.deepEqual(result,{
      ok:false,reason:'ALIAS_NOT_CONFIGURED',mailboxVerified:true,
      aliasConfigured:false,importEnabled:false
    });
    assert.deepEqual(calls,['https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/profile']);
    assert.ok(!JSON.stringify(result).includes('123456'));
  }finally{globalThis.fetch=prev}
});

test('Matching Workspace profile with configured company-address format passes metadata preflight',async()=>{
  const grant={id:'primary',mailbox:expected,status:'ACTIVE',
    connected_at:Date.now(),refresh_ciphertext:await encryptRefresh('synthetic-refresh-token')};
  const env=mockEnv(grant,'post@finnbilglass.no');
  const prev=globalThis.fetch;
  globalThis.fetch=async(url)=>String(url).includes('oauth2.googleapis.com')
    ? Response.json({access_token:'synthetic-access-token',expires_in:3600,token_type:'Bearer'})
    : Response.json({emailAddress:expected,historyId:'98765'});
  try{
    const result=await checkWorkspaceGmailPreflight(env);
    assert.equal(result.reason,'PROFILE_VERIFIED');
    assert.equal(result.ok,true);
    assert.equal(result.aliasConfigured,true);
    assert.equal(result.importEnabled,false);
  }finally{globalThis.fetch=prev}
});

test('Another Gmail mailbox fails closed even if OAuth refresh succeeds',async()=>{
  const grant={id:'primary',mailbox:expected,status:'ACTIVE',
    connected_at:Date.now(),refresh_ciphertext:await encryptRefresh('synthetic-refresh-token')};
  const env=mockEnv(grant,'post@finnbilglass.no');
  const prev=globalThis.fetch;
  globalThis.fetch=async(url)=>String(url).includes('oauth2.googleapis.com')
    ? Response.json({access_token:'synthetic-access-token',expires_in:3600,token_type:'Bearer'})
    : Response.json({emailAddress:'personal@gmail.com',historyId:'98765'});
  try{
    const result=await checkWorkspaceGmailPreflight(env);
    assert.equal(result.reason,'WRONG_MAILBOX');
    assert.equal(result.mailboxVerified,false);
    assert.equal(result.ok,false);
    assert.equal(result.importEnabled,false);
  }finally{globalThis.fetch=prev}
});

test('A failed refresh token and an external address cannot pass preflight',async()=>{
  const grant={id:'primary',mailbox:expected,status:'ACTIVE',
    connected_at:Date.now(),refresh_ciphertext:await encryptRefresh('synthetic-refresh-token')};
  const env=mockEnv(grant,'personal@gmail.com');
  const prev=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    return Response.json({error:'invalid_grant'}, {status:400});
  };
  try{
    const result=await checkWorkspaceGmailPreflight(env);
    assert.equal(result.reason,'TOKEN_REFRESH_FAILED');
    assert.equal(result.aliasConfigured,false);
    assert.deepEqual(calls,['https://oauth2.googleapis.com/token']);
  }finally{globalThis.fetch=prev}
});
