import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { verifyManualOpsStaff, validManualWriteOrigin, allowLegacySupportToken } from '../src/ops-manual-access.ts';

const TEAM='https://example-team.cloudflareaccess.com';
const AUD='abc123-ops-access-audience-tag-123456';
const ALLOWED='staff@example.com';
const env={
  OPS_ACCESS_TEAM_DOMAIN:'example-team.cloudflareaccess.com',
  OPS_ACCESS_AUD:AUD
};
const now=1800000000;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');

async function fixture(){
  const kp=await webcrypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',kp.publicKey);
  const header={alg:'RS256',kid:'test-key-one',typ:'JWT'};
  const good={iss:TEAM,aud:[AUD],exp:now+900,iat:now-90,nbf:now-90,
    email:ALLOWED,sub:'access-user-001'};
  async function sign(claims=good,head=header){
    const input=b64(head)+'.'+b64(claims);
    const signature=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(input));
    return input+'.'+Buffer.from(signature).toString('base64url');
  }
  return {jwk,good,sign};
}
function req(token,options={}){
  return new Request('https://finnbilglass.no/api/ops/manual/me',{
    headers:{'Cf-Access-Jwt-Assertion':token,...options}
  });
}
test('legitimate Access JWT signed by expected team key admits allowlisted employee',async()=>{
  const f=await fixture(),original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    assert.equal(url,TEAM+'/cdn-cgi/access/certs');
    return new Response(JSON.stringify({keys:[{...f.jwk,kid:'test-key-one',alg:'RS256',use:'sig'}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const identity=await verifyManualOpsStaff(req(await f.sign()),env,now);
    assert.deepEqual(identity,{email:ALLOWED,subject:'access-user-001',audience:AUD});
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
test('spoofed email and Bearer support token cannot pass without signed Access JWT',async()=>{
  const access=await verifyManualOpsStaff(new Request('https://finnbilglass.no/api/ops/manual/me',{
    headers:{'X-Forwarded-Email':ALLOWED,Authorization:'Bearer forged-legacy-token'}
  }),env,now);
  assert.equal(access,null);
});
test('issuer, audience, expiry, invalid email, and signature all fail closed',async()=>{
  const f=await fixture(),orig=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({
    keys:[{...f.jwk,kid:'test-key-one',alg:'RS256',use:'sig'}]
  }),{status:200});
  try{
    const variations=[
      {...f.good,iss:'https://attacker.cloudflareaccess.com'},
      {...f.good,aud:['wrong-aud']},
      {...f.good,exp:now-1},
      {...f.good,iat:now+400},
      {...f.good,email:'invalid-email'},
      {...f.good,sub:''}
    ];
    for(const claims of variations)
      assert.equal(await verifyManualOpsStaff(req(await f.sign(claims)),env,now),null,
        'forged or invalid claim should not be accepted');
    const jwt=await f.sign();
    const [jwtHeader,jwtClaims,jwtSignature]=jwt.split('.');
    const invalidSignature=(jwtSignature[0]==='A'?'B':'A')+jwtSignature.slice(1);
    assert.notEqual(invalidSignature,jwtSignature,'test must always mutate signature');
    assert.equal(await verifyManualOpsStaff(req([jwtHeader,jwtClaims,invalidSignature].join('.')),env,now),null);
    assert.equal(await verifyManualOpsStaff(req(jwt),{...env,OPS_ACCESS_AUD:undefined},now),null);
    assert.equal(await verifyManualOpsStaff(req(jwt),{...env,OPS_ACCESS_TEAM_DOMAIN:'https://attacker.example.com'},now),null);
  }finally{globalThis.fetch=orig;}
});
test('only same-origin browser writes with explicit intent and JSON pass CSRF checks',()=>{
  const good=new Request('https://finnbilglass.no/api/ops/manual/inquiries/1/offers',{
    method:'POST',headers:{
      Origin:'https://finnbilglass.no','Content-Type':'application/json',
      'X-FBG-Manual-Intent':'1'
    },body:'{}'
  });
  assert.equal(validManualWriteOrigin(good),true);
  for(const h of [
    {Origin:'https://evil.example','Content-Type':'application/json','X-FBG-Manual-Intent':'1'},
    {Origin:'https://finnbilglass.no','Content-Type':'application/json'},
    {'Content-Type':'application/json','X-FBG-Manual-Intent':'1'},
    {Origin:'https://finnbilglass.no','Content-Type':'text/plain','X-FBG-Manual-Intent':'1'}
  ]) {
    const r=new Request('https://finnbilglass.no/api/ops/manual/inquiries/1/offers',
      {method:'POST',headers:h,body:'{}'});
    assert.equal(validManualWriteOrigin(r),false);
  }
});

test('enabled staff portal categorically rejects legacy support bearer bypass',()=>{
  const legacyToken='synthetic-legacy-token-only-for-test';
  const authenticated=new Request('https://finnbilglass.no/api/ops/saker',{
    headers:{Authorization:'Bearer '+legacyToken}
  });
  const base={SUPPORT_EVIDENCE_TOKEN:legacyToken};
  assert.equal(allowLegacySupportToken(authenticated,{...base,OPS_STAFF_PORTAL_ENABLED:'false'}),true,
    'compatibility remains available only before migration');
  assert.equal(allowLegacySupportToken(authenticated,{...base,OPS_STAFF_PORTAL_ENABLED:'true'}),false,
    'Access mode must reject even a correct legacy bearer token');
  assert.equal(allowLegacySupportToken(authenticated,{...base,OPS_STAFF_PORTAL_ENABLED:'staging'}),true);
  assert.equal(allowLegacySupportToken(new Request('https://finnbilglass.no/api/ops/saker'),base),false);
});
