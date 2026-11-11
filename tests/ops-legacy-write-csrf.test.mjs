import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

// Verify the actual legacy write routes, not only the shared CSRF helper.
// Keep all provider and database operations offline.
const BASE='https://ops-staging.finnbilglass.no';
const routes=[
  '/api/ops/inquiries/1/status',
  '/api/ops/inquiries/1/notes',
  '/api/ops/inquiries/1/reply'
];
const invalidHeaders=[
  {name:'foreign Origin',headers:{Origin:'https://attacker.example', 'Content-Type':'application/json', 'X-FBG-Manual-Intent':'1'}},
  {name:'missing Origin',headers:{'Content-Type':'application/json','X-FBG-Manual-Intent':'1'}},
  {name:'text/plain JSON',headers:{Origin:BASE,'Content-Type':'text/plain', 'X-FBG-Manual-Intent':'1'}},
  {name:'missing intent',headers:{Origin:BASE,'Content-Type':'application/json'}}
];
const payloads={
  status:{status:'CONFIRMED',reason:'Synthetic acceptance',actor:'Test Operator'},
  notes:{note:'Synthetic note',actor:'Test Operator'},
  reply:{message:'Synthetic reply',requestId:'synthetic-request-001',actor:'Test Operator'}
};
function mockEnv(){
  let writes=0,requests=0;
  const env={
    ENVIRONMENT:'staging',
    OPS_STAFF_PORTAL_ENABLED:'false',
    SUPPORT_EVIDENCE_TOKEN:'offline-legacy-token',
    RESEND_API_KEY:'never-call-provider',
    FINNBILGLASS_DB:{prepare(){requests++;throw new Error('DATABASE_MUST_NOT_BE_USED')},
      batch(){writes++;throw new Error('DATABASE_BATCH_MUST_NOT_BE_USED')}}
  };
  return {env, counts:()=>({writes,requests})};
}
function makeRequest(path,headers){
  const suffix=path.slice(path.lastIndexOf('/')+1);
  return new Request(BASE+path,{method:'POST',headers:{
      Authorization:'Bearer offline-legacy-token',...headers
    },body:JSON.stringify(payloads[suffix]||{})});
}
for(const path of routes){
  for(const {name,headers} of invalidHeaders){
    test(`reject ${path}: ${name}, no D1 write or email`,async()=>{
      const fixture=mockEnv();
      const original=globalThis.fetch;
      let external=0;
      globalThis.fetch=async()=>{external++;throw new Error('EXTERNAL_REQUEST_FORBIDDEN')};
      try{
        const response=await worker.fetch(makeRequest(path,headers),fixture.env);
        assert.equal(response.status,403);
        assert.equal((await response.json()).error,'UGYLDIG_FORESPORSEL');
        assert.deepEqual(fixture.counts(),{writes:0,requests:0});
        assert.equal(external,0);
      }finally{globalThis.fetch=original;}
    });
  }
}
test('Gmail sync: legacy token is not a permitted authenticated staff identity',async()=>{
  const fixture=mockEnv();
  const response=await worker.fetch(makeRequest('/api/ops/epost/gmail-sync',{
    Origin:BASE,'Content-Type':'application/json','X-FBG-Manual-Intent':'1'
  }),fixture.env);
  assert.equal(response.status,401);
  assert.deepEqual(fixture.counts(),{writes:0,requests:0});
});
test('legacy support bearer cannot authorize writes after staff portal is enabled',async()=>{
  const fixture=mockEnv();
  const response=await worker.fetch(makeRequest('/api/ops/inquiries/1/notes',{
    Origin:BASE,'Content-Type':'application/json','X-FBG-Manual-Intent':'1'
  }),{...fixture.env,OPS_STAFF_PORTAL_ENABLED:'true'});
  assert.equal(response.status,401);
  assert.deepEqual(fixture.counts(),{writes:0,requests:0});
});
