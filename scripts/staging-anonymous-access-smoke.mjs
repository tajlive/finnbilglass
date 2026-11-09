/** Read-only, anonymous access-control smoke. No cookies, tokens, order mutations or customer data. */
import assert from 'node:assert/strict';
const base='https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const targets=[
  ['/api/ops/summary',403],
  ['/api/ops/whoami',403],
  ['/api/ops/inquiries',403],
  ['/ops',403],
];
for(const [path,expected] of targets){
  const r=await fetch(base+path,{method:'GET',redirect:'manual',cache:'no-store'});
  console.log('ANONYMOUS_OPS_CHECK '+JSON.stringify({path,http:r.status,expected}));
  assert.equal(r.status,expected,path+' must not be available on workers.dev');
}
for(const path of ['/api/customer/inquiries','/api/customer/payment-orders']){
  const r=await fetch(base+path,{method:'GET',redirect:'manual',cache:'no-store'});
  console.log('ANONYMOUS_CUSTOMER_CHECK '+JSON.stringify({path,http:r.status}));
  assert.ok([401,403].includes(r.status),path+' must require auth');
}
const pilot=await fetch(base+'/api/pilot-status',{method:'GET',cache:'no-store'});
assert.equal(pilot.status,200);
const p=await pilot.json();
assert.equal(p.environment,'staging');
console.log('PUBLIC_STAGING_CHECK '+JSON.stringify({environment:p.environment,ok:p.ok,pilot:p.pilot}));
// Cloudflare Access should block anonymous requests to the real Ops staging hostname.
// A missing Access DNS mapping is also NOT a successful E2E test.
let accessState='NOT_VERIFIED';
try{
  const r=await fetch('https://ops-staging.finnbilglass.no/api/ops/whoami',{
    method:'GET',redirect:'manual',cache:'no-store',
    signal:AbortSignal.timeout(15000)
  });
  accessState='HTTP_'+r.status;
  assert.ok([301,302,303,307,308,401,403].includes(r.status),
    'Staging Ops host exposed an unauthenticated response');
}catch(error){
  if(error?.name==='AssertionError')throw error;
  console.log('OPS_ACCESS_HOST_NOT_VERIFIED '+String(error?.message||error).slice(0,180));
}
console.log('OPS_ACCESS_RESULT '+accessState);
