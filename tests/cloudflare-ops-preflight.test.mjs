import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAccess,validateWorkerRoutes,validateWorkerDomains,resolveProductionAudience,describeAccessCoverage,preflight,readCloudflareList} from '../scripts/maintenance/cloudflare-ops-preflight.mjs';

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

test('Access root paths may protect their subpaths without redundant wildcard destinations',()=>{
  const concise=['/ops','/api/ops'].flatMap(path=>hosts.map(host=>({type:'public',uri:host+path})));
  assert.equal(validateAccess([app({destinations:concise})],policies(),AUD).protectedPaths,8);
  const wholeSites=hosts.map(host=>({type:'public',uri:host}));
  assert.equal(validateAccess([app({destinations:wholeSites})],policies(),AUD).protectedPaths,8);
  assert.throws(()=>validateAccess([app({destinations:wholeSites.slice(0,1)})],policies(),AUD),
    /PROD_ACCESS_REQUIRED_PATH_MISSING/);
  assert.throws(()=>validateAccess([app({destinations:concise.filter(d=>d.uri!=='www.finnbilglass.no/api/ops')})],policies(),AUD),
    /PROD_ACCESS_REQUIRED_PATH_MISSING/);
  // Wildcard on a child path does NOT cover its parent exact route.
  assert.throws(()=>validateAccess([app({destinations:expected.filter(d=>d.uri!=='finnbilglass.no/ops')})],policies(),AUD),
    /PROD_ACCESS_REQUIRED_PATH_MISSING/);
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
    destinations:expected.filter(d=>d.uri.startsWith('finnbilglass.no/')),
    self_hosted_domains:expected.filter(d=>d.uri.startsWith('www.')).map(d=>({domain:d.uri}))
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


test('a competing Access application cannot overlap the protected OPS paths',()=>{
  const other=(destination)=>app({
    id:'other-app',aud:'b'.repeat(64),
    destinations:[{type:'public',uri:destination}]
  });
  for(const destination of [
    'finnbilglass.no/ops',
    'finnbilglass.no/ops/*',
    'www.finnbilglass.no/api/ops',
    'www.finnbilglass.no/api/ops/*',
    'finnbilglass.no',
    'www.finnbilglass.no/*'
  ]){
    assert.throws(()=>validateAccess([app(),other(destination)],policies(),AUD),
      /COMPETING_ACCESS_APP_ON_PROTECTED_OPS_PATH/,destination);
  }
  assert.doesNotThrow(()=>validateAccess([
    app(),other('ops-staging.finnbilglass.no/ops/*')
  ],policies(),AUD));
  assert.doesNotThrow(()=>validateAccess([
    app(),other('finnbilglass.no/public-only/*')
  ],policies(),AUD));
});


test('AUD auto-discovery needs a unique production app, not a manually copied GitHub secret',()=>{
  const concise=['/ops','/api/ops'].flatMap(path=>hosts.map(host=>({type:'public',uri:host+path})));
  assert.deepEqual(resolveProductionAudience([app({destinations:concise})]),
    {aud:AUD,source:'cloudflare_account_read'});
  assert.deepEqual(resolveProductionAudience([app()],'b'.repeat(64)),
    {aud:'b'.repeat(64),source:'protected_environment'});
  assert.throws(()=>resolveProductionAudience([app()],'short'),
    /PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION/);
  assert.throws(()=>resolveProductionAudience([],null),
    /PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/);
  assert.throws(()=>resolveProductionAudience(null,null),/ACCESS_APP_LIST_INVALID/);
  assert.throws(()=>resolveProductionAudience([app({destinations:concise.slice(1)})],null),
    /PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/);
  assert.throws(()=>resolveProductionAudience([app(),app({id:'second',aud:'b'.repeat(64)})],null),
    /PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/);
});

test('preflight reads production AUD from Cloudflare when secret is absent',async()=>{
  const prior=globalThis.fetch;
  const token='only-synthetic-token-abcdefghij12345';
  const seen=[];
  globalThis.fetch=async(url,options)=>{
    const u=new URL(url);
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    seen.push(u.pathname);
    let result;
    if(u.pathname.endsWith('/access/apps'))result=[app()];
    else if(u.pathname.endsWith('/access/apps/test-app/policies'))result=policies();
    else if(u.pathname==='/client/v4/zones')result=[{id:'zone-fixture'}];
    else if(u.pathname.endsWith('/workers/routes'))result=[];
    else if(u.pathname.endsWith('/workers/domains'))result=[{
      hostname:u.searchParams.get('hostname'),service:'finnbilglass-frontrute',
      zone_name:'finnbilglass.no',enabled:true,environment:'production'
    }];
    else throw Error('Unexpected GET fixture '+u.pathname);
    return {ok:true,json:async()=>({success:true,result,result_info:{total_pages:1}})};
  };
  try{
    const output=await preflight({
      CLOUDFLARE_ACCOUNT_ID:'80d5b1d56a3e907150ba7348b6182894',
      CLOUDFLARE_API_TOKEN:token
    });
    assert.deepEqual(output,{
      status:'PASS',readOnly:true,audienceSource:'cloudflare_account_read',
      protectedPaths:8,allowPolicies:1,routesChecked:0,
      legacyRepairRoutes:0,workerCustomDomains:3
    });
    assert.ok(!JSON.stringify(output).includes(AUD),'AUD must not be logged/output');
    assert.equal(seen.length,7);
    await assert.rejects(preflight({
      CLOUDFLARE_ACCOUNT_ID:'80d5b1d56a3e907150ba7348b6182894',
      CLOUDFLARE_API_TOKEN:token,
      OPS_ACCESS_AUD:'b'.repeat(64)
    }),/EXACT_PROD_ACCESS_APP_NOT_FOUND/);
  }finally{
    globalThis.fetch=prior;
  }
});


test('Cloudflare list adapter traverses every page via GET and returns complete inventory',async()=>{
  const urls=[];
  const token='fixture-token-12345678901234567890';
  const read=async(url,opt)=>{
    assert.equal(opt.method,'GET');
    assert.equal(opt.headers.Authorization,'Bearer '+token);
    const u=new URL(url);
    urls.push(url);
    const page=Number(u.searchParams.get('page')||1);
    const rows=page===1?[{id:'a'}]:[{id:'b'}];
    return {ok:true,json:async()=>({
      success:true,result:rows,
      result_info:{page,per_page:1,count:1,total_pages:2,total_count:2}
    })};
  };
  assert.deepEqual(await readCloudflareList('/accounts/test/access/apps?per_page=1',token,read),
    [{id:'a'},{id:'b'}]);
  assert.equal(urls.length,2);
  assert.equal(new URL(urls[0]).searchParams.get('page'),null);
  assert.equal(new URL(urls[1]).searchParams.get('page'),'2');
});

test('Cloudflare list adapter refuses partial or inconsistent pagination',async()=>{
  const token='fixture-token-12345678901234567890';
  const scenario=async(overrides)=>{
    return readCloudflareList('/accounts/test/access/apps',token,
      async(url)=>{
        const page=Number(new URL(url).searchParams.get('page')||1);
        const fixture={success:true,result:[{id:String(page)}],
          result_info:{page,count:1,total_pages:2}};
        const response={...fixture,...(overrides[page]?.body||{}),
          result_info:{...fixture.result_info,...(overrides[page]?.info||{})}};
        return {ok:overrides[page]?.ok??true,json:async()=>response};
      });
  };
  for(const [overrides,reason] of [
    [{2:{info:{page:1}}},/CLOUDFLARE_PAGINATION_INCONSISTENT/],
    [{2:{info:{total_pages:3}}},/CLOUDFLARE_PAGINATION_INCONSISTENT/],
    [{1:{info:{total_pages:201}}},/CLOUDFLARE_PAGINATION_INVALID/],
    [{1:{info:{count:2}}},/CLOUDFLARE_PAGINATION_INCONSISTENT/],
    [{1:{body:{result:[]},info:{count:0}}},/CLOUDFLARE_PAGINATION_INCOMPLETE/],
    [{2:{ok:false}},/CLOUDFLARE_READ_ONLY_API_PERMISSION_OR_HTTP_ERROR/],
    [{2:{body:{success:false}}},/CLOUDFLARE_READ_ONLY_API_FAILED/]
  ]){
    await assert.rejects(scenario(overrides),reason);
  }
  const noPageMetadata=await readCloudflareList('/zones/test/workers/routes',token,
    async()=>({ok:true,json:async()=>({success:true,result:[{pattern:'example.invalid/*'}]})}));
  assert.equal(noPageMetadata.length,1);
});

test('preflight succeeds when the correct Access app and allow policy are on later pages',async()=>{
  const prior=globalThis.fetch;
  const token='fixture-token-12345678901234567890';
  const called=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    const u=new URL(url),page=Number(u.searchParams.get('page')||1);
    called.push(u.pathname+'?'+u.searchParams.toString());
    let result,total_pages=1;
    if(u.pathname.endsWith('/access/apps')){
      total_pages=2;
      result=page===1?[{type:'self_hosted',id:'irrelevant',aud:'b'.repeat(64),
        destinations:[{type:'public',uri:'unrelated.invalid'}]}]:[app()];
    }else if(u.pathname.endsWith('/access/apps/test-app/policies')){
      total_pages=2;
      result=page===1?[{decision:'deny'}]:policies();
    }else if(u.pathname==='/client/v4/zones')result=[{id:'zone-fixture'}];
    else if(u.pathname.endsWith('/workers/routes'))result=[];
    else if(u.pathname.endsWith('/workers/domains'))result=[{
      hostname:u.searchParams.get('hostname'),service:'finnbilglass-frontrute',
      zone_name:'finnbilglass.no',enabled:true,environment:'production'
    }];
    else throw Error('Unexpected GET fixture '+u.pathname);
    return {ok:true,json:async()=>({
      success:true,result,
      result_info:{page,count:result.length,total_pages}
    })};
  };
  try{
    const result=await preflight({
      CLOUDFLARE_ACCOUNT_ID:'80d5b1d56a3e907150ba7348b6182894',
      CLOUDFLARE_API_TOKEN:token
    });
    assert.equal(result.status,'PASS');
    assert.equal(result.audienceSource,'cloudflare_account_read');
    assert.equal(result.allowPolicies,1);
    assert.ok(!JSON.stringify(result).includes(AUD),'never expose Access AUD');
    assert.equal(called.filter(x=>x.includes('/access/apps?')).length,2);
    assert.equal(called.filter(x=>x.includes('/policies?')).length,2);
    assert.equal(called.length,9);
  }finally{globalThis.fetch=prior}
});


test('Cloudflare Access list public destination type is optional; explicit empty list never falls back',()=>{
  const missingTypes=expected.map(({type,...rest})=>rest);
  assert.equal(resolveProductionAudience([app({destinations:missingTypes})]).aud,AUD);
  assert.equal(validateAccess([app({destinations:missingTypes})],policies(),AUD).protectedPaths,8);
  assert.throws(()=>resolveProductionAudience([app({
    destinations:[],
    self_hosted_domains:expected.map(d=>({domain:d.uri})),
    domain:'finnbilglass.no'
  })]),/PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/);
  assert.throws(()=>resolveProductionAudience([app({
    destinations:[{type:'private',uri:'finnbilglass.no'},
      ...expected.filter(d=>d.uri.startsWith('finnbilglass.no/'))]
  })]),/PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/);
});

test('read-only Access failure reports safe coverage mask when OPS is split between apps',()=>{
  const apex=app({id:'apex-app',destinations:expected.slice(0,4)});
  const www=app({id:'www-app',aud:'b'.repeat(64),destinations:expected.slice(4)});
  const summary=describeAccessCoverage([apex,www]);
  assert.deepEqual(summary,{
    total:2,selfHosted:2,eligible:2,complete:0,
    bestCovered:4,unionCovered:8,bestMask:'11110000',unionMask:'11111111'
  });
  assert.throws(()=>resolveProductionAudience([apex,www]),err=>{
    assert.match(err.message,/full=0 best=4\/8 union=8\/8/);
    assert.match(err.message,/bestMask=11110000 unionMask=11111111/);
    for(const sensitive of [AUD,'b'.repeat(64),'apex-app','www-app'])
      assert.equal(err.message.includes(sensitive),false,'must never reveal identifier');
    return true;
  });
});

test('read-only Access failure differentiates incomplete setup from duplicate full app candidates',()=>{
  const none=describeAccessCoverage([app({destinations:[expected[0]]})]);
  assert.equal(none.bestCovered,1);
  assert.equal(none.unionCovered,1);
  const duplicate=[app(),app({id:'other',aud:'b'.repeat(64)})];
  const summary=describeAccessCoverage(duplicate);
  assert.equal(summary.complete,2);
  assert.throws(()=>resolveProductionAudience(duplicate),/full=2 best=8\/8/);
  const invalidApp={type:'self_hosted',id:'no-aud',destinations:expected};
  assert.deepEqual(describeAccessCoverage([invalidApp]),{
    total:1,selfHosted:1,eligible:0,complete:0,
    bestCovered:0,unionCovered:0,bestMask:'00000000',unionMask:'00000000'
  });
});
