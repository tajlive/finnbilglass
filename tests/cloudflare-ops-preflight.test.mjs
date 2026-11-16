import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAccess,validateWorkerRoutes} from '../scripts/maintenance/cloudflare-ops-preflight.mjs';

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
  ]),/LEGACY_OPS_REPAIR_WORKER_ROUTE_MUST_BE_CLEARED/);
  assert.throws(()=>validateWorkerRoutes(null),/WORKER_ROUTES_NOT_READABLE/);
});
