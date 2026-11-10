import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { beginWorkspaceOAuth, finishWorkspaceOAuth, storedWorkspaceRefreshToken,
  workspaceConnectionStatus } from '../src/ops-workspace-oauth.ts';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const admin = {email:'admin@finnbilglass.no',role:'ADMIN',subject:'google-admin',audience:'test'};
const operator = {...admin,role:'OPERATOR'};
const expected = 'tomarne@finnbilglass.no';
const secret = Buffer.alloc(32, 17).toString('base64url');
const goodEnv = {
  ENVIRONMENT:'staging',
  OPS_WORKSPACE_OAUTH_ENABLED:'true',
  OPS_GMAIL_TOKEN_ENCRYPTION_KEY:secret,
  OPS_GMAIL_EXPECTED_MAILBOX:expected,
  GOOGLE_OAUTH_CLIENT_ID:'existing-google-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET:'existing-test-client-secret-not-real',
};

function testDb(){
  const attempts = new Map(), tokens = new Map(), audit=[];
  const calls=[];
  const db={
    prepare(sql){
      return {bind(...params){
        return {
          async run(){
            calls.push({kind:'run',sql,params});
            if(sql.startsWith('INSERT INTO ops_workspace_oauth_attempts')){
              const [state,actor_email,verifier_ciphertext,created_at,expires_at]=params;
              attempts.set(state,{state,actor_email,verifier_ciphertext,created_at,expires_at,consumed_at:null});
              return {meta:{changes:1}};
            }
            if(sql.startsWith('UPDATE ops_workspace_oauth_attempts')){
              const [now,state,minExpiry]=params, record=attempts.get(state);
              if(!record || record.consumed_at!==null || record.expires_at<minExpiry)
                return {meta:{changes:0}};
              record.consumed_at=now;
              return {meta:{changes:1}};
            }
            throw Error('Unexpected SQL run: '+sql.slice(0,80));
          },
          async first(){
            calls.push({kind:'first',sql,params});
            if(sql.includes('FROM ops_workspace_oauth_attempts'))return attempts.get(params[0])??null;
            if(sql.includes('FROM ops_workspace_gmail_tokens'))return tokens.get('primary')??null;
            throw Error('Unexpected SQL select: '+sql.slice(0,80));
          }
        };
      }};
    },
    async batch(stmts){
      if(stmts.length!==2)throw Error('Batch must be atomic (grant + audit)');
      const [{sql,params},auditStatement] = stmts.map(x=>x);
      // The test uses the public D1 prepare().bind() shape.
      if(!sql?.includes('INSERT INTO ops_workspace_gmail_tokens') ||
         !auditStatement.sql?.includes('INSERT INTO ops_workspace_oauth_audit'))
         throw Error('Unexpected D1 batch');
      const [mailbox,refresh_ciphertext,scope,connected_by,connected_at,updated_at]=params;
      tokens.set('primary',{id:'primary',mailbox,refresh_ciphertext,scope,
        connected_by,connected_at,updated_at,status:'ACTIVE'});
      audit.push(auditStatement.params);
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
  };
  // Expose D1 statement metadata only for deterministic mocks, no external D1.
  const wrapped={prepare(sql){
    // D1 supports both db.prepare(sql).first() and db.prepare(sql).bind(...).first().
    const unbound=db.prepare(sql).bind();
    return {...unbound,bind(...params){
      const inner=db.prepare(sql).bind(...params);
      return {...inner,sql,params};
    }};
  },batch:db.batch};
  return {db:wrapped,attempts,tokens,audit,calls};
}

function env(state){return {...goodEnv,FINNBILGLASS_DB:state.db}}
function callbackUrl(authorizationUrl,code='oauth-code-synthetic-1234567'){
  const auth=new URL(authorizationUrl);
  return new URL(auth.searchParams.get('redirect_uri')+
    '?state='+auth.searchParams.get('state')+'&code='+code);
}

test('Workspace OAuth is disabled by default and can never start on production',async()=>{
  const state=testDb();
  const noFlag=await beginWorkspaceOAuth({...env(state),OPS_WORKSPACE_OAUTH_ENABLED:'false'},admin);
  assert.equal(noFlag.status,503);
  const prod=await beginWorkspaceOAuth({...env(state),ENVIRONMENT:'production'},admin);
  assert.equal(prod.status,503);
  assert.equal(state.attempts.size,0);
  assert.equal((await workspaceConnectionStatus({...env(state),ENVIRONMENT:'production'})).connected,false);
});

test('non-admin cannot start offline Gmail grant',async()=>{
  const state=testDb();
  const response=await beginWorkspaceOAuth(env(state),operator);
  assert.equal(response.status,403);
  assert.equal(state.attempts.size,0);
});

test('admin consent requires existing Workspace, exactly Gmail readonly, PKCE and one-use state',async()=>{
  const state=testDb();
  const begin=await beginWorkspaceOAuth(env(state),admin);
  assert.equal(begin.status,200);
  const payload=await begin.json();
  const auth=new URL(payload.authorizationUrl);
  assert.equal(auth.origin,'https://accounts.google.com');
  assert.equal(auth.searchParams.get('redirect_uri'),
    'https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback');
  assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(auth.searchParams.get('access_type'),'offline');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  assert.equal(auth.searchParams.get('login_hint'),expected);
  assert.equal(auth.searchParams.get('hd'),'finnbilglass.no');
  assert.ok((auth.searchParams.get('code_challenge')||'').length>=40);
  const stateId=auth.searchParams.get('state');
  assert.match(stateId,/^[a-f0-9]{64}$/);
  const row=state.attempts.get(stateId);
  assert.equal(row.actor_email,admin.email);
  assert.ok(!row.verifier_ciphertext.includes('existing-google'));
  assert.ok(row.expires_at-row.created_at===10*60*1000);
});

test('valid Workspace consent persists encrypted refresh token, never plaintext',async()=>{
  const state=testDb();const e=env(state);
  const start=await (await beginWorkspaceOAuth(e,admin)).json();
  const url=callbackUrl(start.authorizationUrl);
  const oldFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(href,init)=>{
    calls.push({url:String(href),method:init?.method||'GET'});
    if(String(href)==='https://oauth2.googleapis.com/token')
      return Response.json({access_token:'access-qa-not-real',
        refresh_token:'refresh-qa-never-in-d1-plaintext',
        scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});
    if(String(href)==='https://gmail.googleapis.com/gmail/v1/users/me/profile')
      return Response.json({emailAddress:expected,historyId:'200'});
    throw Error('Unexpected network endpoint');
  };
  try{
    const result=await finishWorkspaceOAuth(new Request(url),e,admin);
    assert.equal(result.status,303);
    assert.equal(result.headers.get('location'),'/ops/ansatte?workspace=connected');
    assert.equal(state.tokens.size,1);
    const stored=state.tokens.get('primary');
    assert.equal(stored.mailbox,expected);
    assert.notEqual(stored.refresh_ciphertext,'refresh-qa-never-in-d1-plaintext');
    assert.ok(!JSON.stringify(stored).includes('refresh-qa-never-in-d1-plaintext'));
    assert.equal(await storedWorkspaceRefreshToken(e),'refresh-qa-never-in-d1-plaintext');
    assert.equal((await workspaceConnectionStatus(e)).connected,true);
    assert.equal(state.audit.length,1);
    assert.equal(calls.length,2);
    const retry=await finishWorkspaceOAuth(new Request(url),e,admin);
    assert.equal(retry.headers.get('location'),'/ops/ansatte?workspace=failed');
    assert.equal(calls.length,2,'replayed authorization code must not trigger token exchange');
    assert.equal(state.audit.length,1);
  } finally {globalThis.fetch=oldFetch}
});

test('personal Gmail profile is denied before token storage',async()=>{
  const state=testDb();const e=env(state);
  const start=await (await beginWorkspaceOAuth(e,admin)).json();
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(href)=>String(href).includes('oauth2.googleapis.com')
    ? Response.json({access_token:'access',refresh_token:'refresh-personal',
        token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'})
    : Response.json({emailAddress:'personal@gmail.com'});
  try {
    const result=await finishWorkspaceOAuth(new Request(callbackUrl(start.authorizationUrl)),e,admin);
    assert.equal(result.status,303);
    assert.equal(result.headers.get('location'),'/ops/ansatte?workspace=failed');
    assert.equal(state.tokens.size,0);
    assert.equal(state.audit.length,0);
  } finally {globalThis.fetch=oldFetch}
});

test('missing/rejected state, wrong staff and no Google refresh grant fail without writes',async()=>{
  const state=testDb();const e=env(state);
  const start=await (await beginWorkspaceOAuth(e,admin)).json();
  const url=callbackUrl(start.authorizationUrl);
  assert.equal((await finishWorkspaceOAuth(new Request(url),e,operator)).status,303);
  const oldFetch=globalThis.fetch;let fetches=0;
  globalThis.fetch=async(href)=>{
    fetches++;
    if(String(href).includes('oauth2.googleapis.com'))
      return Response.json({access_token:'a',token_type:'Bearer',
        scope:'https://www.googleapis.com/auth/gmail.readonly'});
    throw Error('Do not fetch profile without a refresh token');
  };
  try{
    const result=await finishWorkspaceOAuth(new Request(url),e,admin);
    assert.equal(result.headers.get('location'),'/ops/ansatte?workspace=failed');
    assert.equal(fetches,1);
    assert.equal(state.tokens.size,0);
  }finally{globalThis.fetch=oldFetch}
});
