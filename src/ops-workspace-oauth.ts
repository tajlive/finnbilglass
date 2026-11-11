/** Existing Google Workspace connection: one ADMIN-consented Gmail read-only OAuth.
 * No new Google project/Workspace, no Gmail sending, no personal inbox import.
 * Refresh tokens are AES-GCM encrypted at rest in staging EU D1.
 */
import type { Env } from './types';
import type { OpsStaff } from './ops-staff';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STAGING_CALLBACK = 'https://ops-staging.finnbilglass.no/api/ops/manual/workspace/oauth/callback';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type WorkspaceEnv = Env & {
  OPS_WORKSPACE_OAUTH_ENABLED?: string;
  OPS_GMAIL_TOKEN_ENCRYPTION_KEY?: string;
  OPS_GMAIL_EXPECTED_MAILBOX?: string;
};
type TokenReply = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
};
type Attempt = {
  state: string;
  actor_email: string;
  verifier_ciphertext: string;
  expires_at: number;
  consumed_at: number | null;
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'}
  });

function safeMailbox(value: string | undefined): string | null {
  const str = (value || '').trim().toLowerCase();
  return /^[a-z0-9._%+-]+@finnbilglass\.no$/.test(str) ? str : null;
}

function oauthReady(env: WorkspaceEnv): boolean {
  return env.ENVIRONMENT === 'staging' &&
    env.OPS_WORKSPACE_OAUTH_ENABLED === 'true' &&
    !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET &&
    !!env.OPS_GMAIL_TOKEN_ENCRYPTION_KEY &&
    !!safeMailbox(env.OPS_GMAIL_EXPECTED_MAILBOX);
}

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64Url(str: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw Error('WORKSPACE_INVALID_ENCODED_VALUE');
  const input = str.replace(/-/g,'+').replace(/_/g,'/');
  const decoded = atob(input.padEnd(Math.ceil(input.length / 4) * 4,'='));
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
async function encryptionKey(env: WorkspaceEnv): Promise<CryptoKey> {
  const raw = fromBase64Url(env.OPS_GMAIL_TOKEN_ENCRYPTION_KEY || '');
  if (raw.length !== 32) throw Error('WORKSPACE_ENCRYPTION_KEY_INVALID');
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
function aad(env: WorkspaceEnv): Uint8Array {
  return new TextEncoder().encode('finnbilglass/workspace-gmail/'+env.ENVIRONMENT);
}
async function encrypt(env: WorkspaceEnv, secret: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:aad(env)},key,new TextEncoder().encode(secret)
  );
  const data = new Uint8Array(iv.length + encrypted.byteLength);
  data.set(iv,0);data.set(new Uint8Array(encrypted),iv.length);
  return toBase64Url(data);
}
async function decrypt(env: WorkspaceEnv, encoded: string): Promise<string> {
  const data = fromBase64Url(encoded);
  if (data.length < 29) throw Error('WORKSPACE_CIPHERTEXT_INVALID');
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:data.slice(0,12),additionalData:aad(env)},key,data.slice(12)
  );
  return new TextDecoder().decode(plaintext);
}

export function expectedWorkspaceMailbox(env: WorkspaceEnv): string | null {
  return safeMailbox(env.OPS_GMAIL_EXPECTED_MAILBOX);
}

/** Called only by the Gmail importer, and only after explicit admin consent. */
export async function storedWorkspaceRefreshToken(env: WorkspaceEnv): Promise<string | null> {
  if (!oauthReady(env)) return null;
  try {
    const entry = await env.FINNBILGLASS_DB.prepare(
      "SELECT mailbox, refresh_ciphertext FROM ops_workspace_gmail_tokens "+
      "WHERE id='primary' AND status='ACTIVE'"
    ).first<{mailbox:string;refresh_ciphertext:string}>();
    if (!entry || entry.mailbox !== expectedWorkspaceMailbox(env)) return null;
    return await decrypt(env,entry.refresh_ciphertext);
  } catch {
    // Missing table, invalid encryption key, or decryption failure MUST fail closed.
    return null;
  }
}

export async function workspaceConnectionStatus(env: WorkspaceEnv) {
  const configured = oauthReady(env);
  if (!configured) return {configured:false,connected:false,mailbox:null};
  try {
    const record=await env.FINNBILGLASS_DB.prepare(
      "SELECT mailbox,connected_at FROM ops_workspace_gmail_tokens "+
      "WHERE id='primary' AND status='ACTIVE'"
    ).first<{mailbox:string;connected_at:number}>();
    if (!record || record.mailbox!==expectedWorkspaceMailbox(env)) {
      return {configured:true,connected:false,mailbox:null};
    }
    return {configured:true,connected:true,mailbox:record.mailbox,connectedAt:record.connected_at};
  } catch {
    return {configured:true,connected:false,mailbox:null};
  }
}

export async function beginWorkspaceOAuth(env: WorkspaceEnv, staff: OpsStaff): Promise<Response> {
  if (staff.role!=='ADMIN') return respond({ok:false,error:'KREVER_ADMIN'},403);
  if (!oauthReady(env)) return respond({ok:false,error:'WORKSPACE_OAUTH_IKKE_KLAR'},503);
  const state=Array.from(randomBytes(32),x=>x.toString(16).padStart(2,'0')).join('');
  const verifier=toBase64Url(randomBytes(32));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=toBase64Url(new Uint8Array(digest));
  const now=Date.now();
  try {
    await env.FINNBILGLASS_DB.prepare(
      'INSERT INTO ops_workspace_oauth_attempts '+
      '(state,actor_email,verifier_ciphertext,created_at,expires_at) VALUES(?,?,?,?,?)'
    ).bind(state,staff.email,await encrypt(env,verifier),now,now+OAUTH_STATE_TTL_MS).run();
  } catch {
    return respond({ok:false,error:'WORKSPACE_OAUTH_LAGRING_MANGLER'},503);
  }
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',env.GOOGLE_OAUTH_CLIENT_ID!);
  url.searchParams.set('response_type','code');
  url.searchParams.set('redirect_uri',STAGING_CALLBACK);
  url.searchParams.set('scope',GOOGLE_SCOPE);
  url.searchParams.set('access_type','offline');
  url.searchParams.set('prompt','consent select_account');
  url.searchParams.set('state',state);
  url.searchParams.set('code_challenge',challenge);
  url.searchParams.set('code_challenge_method','S256');
  url.searchParams.set('login_hint',expectedWorkspaceMailbox(env)!);
  url.searchParams.set('hd','finnbilglass.no');
  return respond({ok:true,authorizationUrl:url.toString(),message:'Godkjenn kun Gmail lesetilgang for eksisterende Google Workspace.'});
}

/** Fixed allowlist of non-sensitive failure categories. Never include Google codes or
 * OAuth token response bodies in redirects, logs, the D1 audit or query parameters. */
type WorkspaceOAuthFailure =
  | 'config' | 'callback' | 'state' | 'state_missing' | 'state_expired'
  | 'state_actor' | 'state_used' | 'state_consume' | 'authorization_code'
  | 'token_http_400' | 'token_http_other' | 'token_incomplete'
  | 'token_scope' | 'gmail_http_403' | 'gmail_http_other'
  | 'gmail_mailbox' | 'database_save' | 'unexpected';

function resultRedirect(
  status: 'connected' | 'denied' | 'failed',
  reason?: WorkspaceOAuthFailure
): Response {
  const location='/ops/ansatte?workspace='+status+
    (status==='failed' && reason?'&reason='+reason:'');
  return new Response(null,{
    status:303,
    headers:{'Location':location,'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
  });
}

export async function finishWorkspaceOAuth(request:Request,env:WorkspaceEnv,staff:OpsStaff):Promise<Response> {
  if (staff.role!=='ADMIN' || !oauthReady(env))return resultRedirect('failed','config');
  if (new URL(request.url).origin !== new URL(STAGING_CALLBACK).origin ||
      new URL(request.url).pathname !== new URL(STAGING_CALLBACK).pathname) {
    return resultRedirect('failed','callback');
  }
  const url=new URL(request.url);
  const state=url.searchParams.get('state')||'';
  if(!/^[0-9a-f]{64}$/.test(state))return resultRedirect('failed','state');
  const denied=!!url.searchParams.get('error');
  const code=url.searchParams.get('code')||'';
  if(!denied && (code.length<10||code.length>2048))return resultRedirect('failed','authorization_code');
  try {
    const attempt=await env.FINNBILGLASS_DB.prepare(
      'SELECT state,actor_email,verifier_ciphertext,expires_at,consumed_at '+
      'FROM ops_workspace_oauth_attempts WHERE state=?'
    ).bind(state).first<Attempt>();
    const now=Date.now();
    if(!attempt)return resultRedirect('failed','state_missing');
    if(attempt.actor_email!==staff.email)return resultRedirect('failed','state_actor');
    if(attempt.consumed_at!==null)return resultRedirect('failed','state_used');
    if(attempt.expires_at<now)return resultRedirect('failed','state_expired');
    // The state is one-use, even if Google refused consent or token exchange fails.
    const consume=await env.FINNBILGLASS_DB.prepare(
      'UPDATE ops_workspace_oauth_attempts SET consumed_at=? '+
      'WHERE state=? AND consumed_at IS NULL AND expires_at>=?'
    ).bind(now,state,now).run();
    if(consume.meta.changes!==1)return resultRedirect('failed','state_consume');
    if(denied)return resultRedirect('denied');

    const verifier=await decrypt(env,attempt.verifier_ciphertext);
    const exchange=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        client_id:env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET!,
        code,code_verifier:verifier,redirect_uri:STAGING_CALLBACK,grant_type:'authorization_code'
      }),
      signal:AbortSignal.timeout(15000)
    });
    if(!exchange.ok)return resultRedirect('failed',exchange.status===400?'token_http_400':'token_http_other');
    const tokens=await exchange.json() as TokenReply;
    if(!tokens.access_token || !tokens.refresh_token ||
       tokens.token_type?.toLowerCase()!=='bearer')
      return resultRedirect('failed','token_incomplete');
    if(!tokens.scope?.split(' ').includes(GOOGLE_SCOPE))
      return resultRedirect('failed','token_scope');
    const profileResponse=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{
      headers:{Authorization:'Bearer '+tokens.access_token},
      signal:AbortSignal.timeout(15000)
    });
    if(!profileResponse.ok)return resultRedirect('failed',
      profileResponse.status===403?'gmail_http_403':'gmail_http_other');
    const profile=await profileResponse.json() as {emailAddress?:string};
    const mailbox=profile.emailAddress?.trim().toLowerCase()||'';
    if(!mailbox || mailbox!==expectedWorkspaceMailbox(env))return resultRedirect('failed','gmail_mailbox');

    const cipher=await encrypt(env,tokens.refresh_token);
    const result=await env.FINNBILGLASS_DB.batch([
      env.FINNBILGLASS_DB.prepare(
        "INSERT INTO ops_workspace_gmail_tokens "+
        "(id,mailbox,refresh_ciphertext,scope,connected_by,connected_at,updated_at,status) "+
        "VALUES('primary',?,?,?,?,?,?,'ACTIVE') "+
        "ON CONFLICT(id) DO UPDATE SET mailbox=excluded.mailbox,"+
        "refresh_ciphertext=excluded.refresh_ciphertext,scope=excluded.scope,"+
        "connected_by=excluded.connected_by,updated_at=excluded.updated_at,status='ACTIVE'"
      ).bind(mailbox,cipher,GOOGLE_SCOPE,staff.email,now,now),
      env.FINNBILGLASS_DB.prepare(
        "INSERT INTO ops_workspace_oauth_audit (id,actor_email,action,mailbox,created_at) "+
        "VALUES(?,?,'CONNECTED',?,?)"
      ).bind(crypto.randomUUID(),staff.email,mailbox,now)
    ]);
    if(result[0]?.meta.changes!==1)return resultRedirect('failed','database_save');
    return resultRedirect('connected');
  } catch {
    // NEVER log the Google code, refresh token, access token or API response body.
    return resultRedirect('failed','unexpected');
  }
}
