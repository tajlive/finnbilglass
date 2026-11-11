import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { handleOpsStaffRoute } from '../src/ops-staff-routes.ts';

const schema=readFileSync(new URL('../migrations/proposed/0041_ops_staff_invites_activity.sql.proposed',import.meta.url),'utf8');
const audience='fbg-staging-staff-audience-example-123';
const issuer='https://example-team.cloudflareaccess.com';
function wrap(sqlite,sql,args=[]){
  return {
    bind(...items){return wrap(sqlite,sql,items)},
    async first(){return sqlite.prepare(sql).get(...args)??null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
  };
}
async function setup(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(schema);
 sqlite.prepare(
   "INSERT INTO ops_staff_memberships(email,role,status,invited_by,invited_at,accepted_at) "+
   "VALUES('admin@example.com','ADMIN','ACTIVE','bootstrap',1000,1000)"
 ).run();
 const kp=await webcrypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
 },true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',kp.publicKey);
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 async function token(email){
   const head=encode({alg:'RS256',kid:'staff-test-key',typ:'JWT'});
   const p=encode({iss:issuer,aud:[audience],sub:'user-'+email,
      email,iat:Math.floor(Date.now()/1000)-60,exp:Math.floor(Date.now()/1000)+900});
   const raw=head+'.'+p;
   const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(raw));
   return raw+'.'+Buffer.from(sig).toString('base64url');
 }
 const env={
   ENVIRONMENT:'staging',OPS_STAFF_PORTAL_ENABLED:'true',
   OPS_ACCESS_TEAM_DOMAIN:'example-team.cloudflareaccess.com',
   OPS_ACCESS_AUD:audience,
   FINNBILGLASS_DB:{prepare(sql){return wrap(sqlite,sql)}}
 };
 const originalFetch=globalThis.fetch;
 let brevo=0;
 globalThis.fetch=async url=>{
   if(url===issuer+'/cdn-cgi/access/certs'){
      return new Response(JSON.stringify({keys:[{...jwk,kid:'staff-test-key',alg:'RS256',use:'sig'}]}),{status:200});
   }
   brevo++;
   throw new Error('external send forbidden');
 };
 function req(path,signed,method='GET',body){
   return new Request('https://ops-staging.finnbilglass.no'+path,{
      method,headers:{
        ...(signed?{'Cf-Access-Jwt-Assertion':signed}:{}),
        ...(method==='POST'?{Origin:'https://ops-staging.finnbilglass.no',
           'Content-Type':'application/json','X-FBG-Manual-Intent':'1'}:{})
      },body:body?JSON.stringify(body):undefined
   });
 }
 return {env,sqlite,req,token,brevoCalls:()=>brevo,
   restore(){globalThis.fetch=originalFetch;sqlite.close()}};
}
test('one signed login, one-click invitation, then invitee has access; all actions auditable',async()=>{
 const f=await setup();
 try{
   const a=await f.token('admin@example.com');
   const session=await handleOpsStaffRoute(f.req('/api/ops/manual/session',a),f.env);
   assert.equal(session.status,200);
   assert.equal((await session.json()).staff.role,'ADMIN');
   const view=await handleOpsStaffRoute(f.req('/ops/ansatte',a),f.env);
   assert.equal(view.status,200);assert.match(await view.text(),/Inviter ansatt/);
   const invited=await handleOpsStaffRoute(
     f.req('/api/ops/manual/staff/invite',a,'POST',{email:'new@example.com',role:'OPERATOR'}),f.env
   );
   assert.equal(invited.status,201);
   const ir=await invited.json();
   assert.equal(ir.emailSent,false,'without Brevo, show copyable invite link');
   assert.match(ir.loginUrl,/\/ops\/ansatte$/);
   const signedNew=await f.token('new@example.com');
   const joined=await handleOpsStaffRoute(f.req('/api/ops/manual/session',signedNew),f.env);
   assert.equal(joined.status,200);
   assert.equal((await joined.json()).staff.role,'OPERATOR');
   const denied=await handleOpsStaffRoute(f.req('/api/ops/manual/activity',signedNew),f.env);
   assert.equal(denied.status,403);
   const history=await handleOpsStaffRoute(f.req('/api/ops/manual/activity?limit=50',a),f.env);
   assert.equal(history.status,200);
   const events=(await history.json()).events;
   assert.ok(events.some(x=>x.action==='LOGIN'&&x.actor_email==='new@example.com'));
   assert.ok(events.some(x=>x.action==='STAFF_INVITED'&&x.actor_email==='admin@example.com'));
   assert.equal(f.brevoCalls(),0,'no calls to Kustom, SMTP or other external services');
 }finally{f.restore();}
});
test('feature gate, anonymous user and legacy support token never grant staff privileges',async()=>{
 const f=await setup();
 try{
   const signed=await f.token('admin@example.com');
   const off=await handleOpsStaffRoute(
     f.req('/api/ops/manual/session',signed),{...f.env,OPS_STAFF_PORTAL_ENABLED:'false'}
   );assert.equal(off.status,404);
   const anonymous=await handleOpsStaffRoute(f.req('/api/ops/manual/session',null),f.env);
   assert.equal(anonymous.status,401);
   const tokenOnly=new Request('https://ops-staging.finnbilglass.no/api/ops/manual/session',
     {headers:{Authorization:'Bearer legacy-support-token'}});
   const legacy=await handleOpsStaffRoute(tokenOnly,{...f.env,SUPPORT_EVIDENCE_TOKEN:'legacy-support-token'});
   assert.equal(legacy.status,401);
   const outside=await handleOpsStaffRoute(f.req('/api/ops/manual/session',await f.token('uninvited@example.com')),f.env);
   assert.equal(outside.status,403);
 }finally{f.restore();}
});
test('admin can revoke staff, invitee immediately loses access; existing audits stay',async()=>{
 const f=await setup();
 try{
   const admin=await f.token('admin@example.com');
   await handleOpsStaffRoute(f.req('/api/ops/manual/staff/invite',admin,'POST',
     {email:'other@example.com',role:'REVIEWER'}),f.env);
   const other=await f.token('other@example.com');
   assert.equal((await handleOpsStaffRoute(f.req('/api/ops/manual/session',other),f.env)).status,200);
   const revoke=await handleOpsStaffRoute(f.req('/api/ops/manual/staff/revoke',admin,'POST',
     {email:'other@example.com'}),f.env);
   assert.equal(revoke.status,200);
   assert.equal((await handleOpsStaffRoute(f.req('/api/ops/manual/session',other),f.env)).status,403);
   const history=(await(await handleOpsStaffRoute(f.req('/api/ops/manual/activity',admin),f.env)).json()).events;
   assert.ok(history.some(x=>x.action==='STAFF_REVOKED'));
   assert.ok(history.some(x=>x.action==='LOGIN'&&x.actor_email==='other@example.com'));
 }finally{f.restore();}
});
test('cross-site POST cannot invite staff even when Access JWT is valid',async()=>{
 const f=await setup();
 try{
   const admin=await f.token('admin@example.com');
   const r=new Request('https://ops-staging.finnbilglass.no/api/ops/manual/staff/invite',{
      method:'POST',headers:{'Cf-Access-Jwt-Assertion':admin,'Content-Type':'application/json',
      Origin:'https://attacker.example.com','X-FBG-Manual-Intent':'1'},
      body:JSON.stringify({email:'evil@example.com',role:'ADMIN'})
   });
   const denied=await handleOpsStaffRoute(r,f.env);
   assert.equal(denied.status,403);
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ops_staff_memberships').get().n,1);
 }finally{f.restore();}
});
