import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAccess,validateWorkerRoutes,validateWorkerDomains} from '../scripts/maintenance/cloudflare-ops-preflight.mjs';

const AUD='a'.repeat(64);
const hosts=['finnbilglass.no','www.finnbilglass.no'];
const paths=['/ops','/ops/*','/api/ops','/api/ops/*'];
const expected=hosts.flatMap(host=>paths.map(path=>({type:'public',uri:host+path})));
const app=(over={})=>({
  id:'test-app',name:'Finnbilglass Operations Center',
  aud:AUD,type:'self_hosted',destinations:expected,...over
});
const policies=(over={})=>[
  {decision:'allow',include:[{email:{email:'employee@example.invalid'}}],...over}
];

test('prod Access gate accepts exact 8 paths, scoped allow, no bypass',()=>{
  const ok=validateAccess([app()],policies(),AUD);
  assert.equal(ok.protectedPaths,8);
  assert.equal(ok.allowPolicies,1);
});

test('no www, no /api/ops or only wildcard without exact is NO-GO',()=>{
  for(const i of [0,3,4,7]){
    const missing=expected.filter((_,idx)=>idx!==i);
    assert.throws(()=>validateAccess([app({destinations:missing})],policies(),AUD),
      /PROD_ACCESS_REQUIRED_PATH_MISSING/);
  }
});

test('wrong AUD or unbound application must fail closed',()=>{
  assert.throws(()=>validateAccess([app()],policies(),'another-aud'),
    /PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION/);
  assert.throws(()=>validateAccess([app()],policies(),'b'.repeat(64)),
    /EXACTLY_ONE_PROD_ACCESS_APP_AUD_REQUIRED/);
  assert.throws(()=>validateAccess([app(),app({id:'other'})],policies(),AUD),
    /EXACTLY_ONE_PROD_ACCESS_APP_AUD_REQUIRED/);
});

test('Access public override, bypass, Everyone and missing policy deny release',()=>{
  const exposed=expected.map((d,i)=>i===0
    ?{...d,overrides:[{behavior:'public',path_pattern:'/ops/*'}]}:d);
  assert.throws(()=>validateAccess([app({destinations:exposed})],policies(),AUD),
    /PROD_ACCESS_PUBLIC_OVERRIDE_PRESENT/);
  assert.throws(()=>validateAccess([app()],policies({decision:'bypass'}),AUD),
    /PROD_ACCESS_ALLOW_POLICY_MISSING|UNSAFE_BYPASS/);
  assert.throws(()=>validateAccess([app()],policies({include:[{everyone:{}}]}),AUD),
    /PROD_ACCESS_ALLOW_EVERYONE_FORBIDDEN/);
  assert.throws(()=>validateAccess([app()],[],AUD),/PROD_ACCESS_POLICIES_NOT_READABLE/);
});

test('new destinations supersede stale legacy domains',()=>{
  assert.throws(()=>validateAccess([app({
    destinations:expected.slice(0,4),
    self_hosted_domains:expected.slice(4).map(d=>({domain:d.uri}))
  })],policies(),AUD),/PROD_ACCESS_REQUIRED_PATH_MISSING/);
});

test('repair Worker route on production zone blocks live release',()=>{
  assert.deepEqual(validateWorkerRoutes([
    {pattern:'finnbilglass.no/*',script:'finnbilglass-frontrute'},
    {pattern:'www.finnbilglass.no/assets/*',script:'assets-only'}
  ]),{routesChecked:2,legacyRepairRoutes:0});
  assert.throws(()=>validateWorkerRoutes([
    {pattern:'www.finnbilglass.no/ops*',script:'finnbilglass-ops-repair'}
  ]),/OPS_PATH_INTERCEPTED_BY_OTHER_WORKER_ROUTE|LEGACY_OPS_REPAIR_WORKER_ROUTE_MUST_BE_CLEARED/);
  assert.throws(()=>validateWorkerRoutes(null),/WORKER_ROUTES_NOT_READABLE/);
});


test('production custom domains must all belong to approved Worker service',()=>{
  const domains=['finnbilglass.no','www.finnbilglass.no','api.finnbilglass.no']
    .map(hostname=>({hostname,service:'finnbilglass-frontrute',environment:'production',
      enabled:true,zone_name:'finnbilglass.no'}));
  assert.deepEqual(validateWorkerDomains(domains),{workerCustomDomains:3});
  // Both optional fields can be absent in valid Cloudflare API responses.
  assert.deepEqual(validateWorkerDomains(domains.map(({enabled,environment,...other})=>other)),
    {workerCustomDomains:3});
  for(let i=0;i<domains.length;i++){
    assert.throws(()=>validateWorkerDomains(domains.filter((_,j)=>j!==i)),
      /WORKER_CUSTOM_DOMAIN_MISSING_OR_DUPLICATED/);
    assert.throws(()=>validateWorkerDomains([...domains,domains[i]]),
      /WORKER_CUSTOM_DOMAIN_MISSING_OR_DUPLICATED/);
    for(const changed of [
      {service:'finnbilglass-ops-repair'},
      {environment:'staging'},
      {enabled:false},
      {zone_name:'example.invalid'}
    ]){
      assert.throws(()=>validateWorkerDomains(
        domains.map((d,j)=>j===i?{...d,...changed}:d)),
        /WORKER_CUSTOM_DOMAIN_WRONG_SERVICE_OR_ENVIRONMENT/);
    }
  }
  assert.throws(()=>validateWorkerDomains(null),/WORKER_CUSTOM_DOMAINS_NOT_READABLE/);
});

test('unrelated Worker can serve assets but not OPS on apex/www',()=>{
  assert.doesNotThrow(()=>validateWorkerRoutes([
    {pattern:'www.finnbilglass.no/assets/*',script:'assets'},
    {pattern:'finnbilglass.no/styles/*',script:'styles'}
  ]));
  const overlapping=[
    'finnbilglass.no/*',
    'www.finnbilglass.no/*',
    'finnbilglass.no/ops*',
    'www.finnbilglass.no/ops/*',
    'finnbilglass.no/api/ops*',
    'www.finnbilglass.no/api/ops/*'
  ];
  for(const pattern of overlapping)assert.throws(()=>validateWorkerRoutes([
    {pattern,script:'other-worker'}
  ]),/OPS_PATH_INTERCEPTED_BY_OTHER_WORKER_ROUTE/,pattern);
  assert.throws(()=>validateWorkerRoutes([
    {pattern:'finnbilglass.no/api/ops/*',script:null}
  ]),/OPS_PATH_INTERCEPTED_BY_OTHER_WORKER_ROUTE/);
  assert.doesNotThrow(()=>validateWorkerRoutes([
    {pattern:'finnbilglass.no/*',script:'finnbilglass-frontrute'}
  ]));
});
