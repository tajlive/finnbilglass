import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageAccessAudience} from '../scripts/maintenance/write-ops-aud-secret.mjs';

const ACCOUNT='80d5b1d56a3e907150ba7348b6182894';
const AUD='synthetic-aud-fbb-0123456789abcdefghijklmnopqrstuvwxyz';
const DEST=['finnbilglass.no','www.finnbilglass.no']
  .flatMap(host=>['/ops','/api/ops'].map(path=>({type:'public',uri:host+path})));
const APP={type:'self_hosted',id:'synthetic-production',aud:AUD,destinations:DEST};
const token='synthetic-token-only-abcdef0123456789';

function fakeResponse(apps=[APP],options={}){
  const {status=true,pages=1,badSecondPage=false,zoneApps=[]}=options;
  return async(url,request)=>{
    const u=new URL(url);
    assert.equal(request.method,'GET');
    assert.equal(request.headers.Authorization,'Bearer '+token);
    const page=Number(u.searchParams.get('page')||1);
    let result,totalPages=pages;
    if(u.pathname.endsWith('/access/apps') && u.pathname.includes('/accounts/')){
      result=pages>1&&page===1
        ?[{id:'other-app',aud:'b'.repeat(64),type:'self_hosted',
          destinations:[{type:'public',uri:'other.invalid'}]}]
        :apps;
    }else if(u.pathname==='/client/v4/zones'){
      result=[{id:'fixture-zone'}];totalPages=1;
    }else if(u.pathname==='/client/v4/zones/fixture-zone/access/apps'){
      result=zoneApps;totalPages=1;
    }else throw Error('Unexpected Cloudflare GET in staging fixture');
    return {ok:status,json:async()=>({
      success:true,result,
      result_info:{page:badSecondPage&&page===2?1:page,
        count:result.length,total_pages:totalPages}
    })};
  };
}

test('Access AUD staged from unique protected Cloudflare app with mode 0600',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-aud-'));
  const env={RUNNER_TEMP:dir,CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:token};
  try{
    assert.deepEqual(await stageAccessAudience(env,fakeResponse()),
      {status:'PASS',staged:true,filename:'fbg-access-secret.json'});
    const file=join(dir,'fbg-access-secret.json');
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{OPS_ACCESS_AUD:AUD});
    assert.equal(statSync(file).mode & 0o777,0o600);
    await assert.rejects(stageAccessAudience(env,fakeResponse()),/EEXIST/,
      'refuse reuse of stale file during deploy');
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('no secret file when Cloudflare identity, completeness or scoped audience differs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-aud-'));
  const env={RUNNER_TEMP:dir,CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:token};
  try{
    for(const [over,request,reason] of [
      [{CLOUDFLARE_ACCOUNT_ID:'other'},fakeResponse(),/WRONG_PRODUCTION_CLOUDFLARE_ACCOUNT/],
      [{CLOUDFLARE_API_TOKEN:''},fakeResponse(),/CLOUDFLARE_API_TOKEN_MISSING/],
      [{OPS_ACCESS_AUD:'b'.repeat(64)},fakeResponse(),/PRODUCTION_AUD_ENV_MISMATCH/],
      [{},fakeResponse([]),/PROD_ACCESS_APPS_EMPTY_BOTH_SCOPES/],
      [{},fakeResponse([APP,{...APP,id:'second',aud:'c'.repeat(64)}]),/PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING/],
      [{},fakeResponse([APP],{pages:2,badSecondPage:true}),/CLOUDFLARE_PAGINATION_INCONSISTENT/],
      [{},fakeResponse([APP],{status:false}),/CLOUDFLARE_READ_ONLY_API_PERMISSION_OR_HTTP_ERROR/]
    ]){
      await assert.rejects(stageAccessAudience({...env,...over},request),reason);
      assert.equal((await import('node:fs')).existsSync(join(dir,'fbg-access-secret.json')),false);
    }
  }finally{rmSync(dir,{recursive:true,force:true})}
});


test('AUD staging supports valid Cloudflare multi-page app inventory without exposing the AUD',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-aud-paged-'));
  try{
    const env={RUNNER_TEMP:dir,CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:token};
    const out=await stageAccessAudience(env,fakeResponse([APP],{pages:2}));
    assert.equal(out.status,'PASS');
    assert.deepEqual(JSON.parse(readFileSync(join(dir,'fbg-access-secret.json'),'utf8')),
      {OPS_ACCESS_AUD:AUD});
    assert.equal(statSync(join(dir,'fbg-access-secret.json')).mode & 0o777,0o600);
  }finally{rmSync(dir,{recursive:true,force:true})}
});


test('atomic AUD staging uses zone-scoped production Access app when account inventory empty',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-aud-zone-'));
  const env={RUNNER_TEMP:dir,CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:token};
  try{
    const done=await stageAccessAudience(env,fakeResponse([],{zoneApps:[APP]}));
    assert.equal(done.staged,true);
    assert.deepEqual(JSON.parse(readFileSync(join(dir,'fbg-access-secret.json'),'utf8')),
      {OPS_ACCESS_AUD:AUD});
    assert.equal(statSync(join(dir,'fbg-access-secret.json')).mode & 0o777,0o600);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
