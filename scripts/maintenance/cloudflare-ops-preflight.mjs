#!/usr/bin/env node
/**
 * Read-only production Cloudflare Access and Worker-route release gate.
 * Never outputs token, Access AUD, customer data, or raw API responses.
 * Requires a protected GitHub production environment with:
 *  CLOUDFLARE_API_TOKEN (Access Apps & Policies Read, Zones Read, Workers Routes Read, Workers Scripts Read),
 *  CLOUDFLARE_ACCOUNT_ID. OPS_ACCESS_AUD is optional for this GET-only audit:
 *  when absent, the unique full-path Access app supplies the live AUD.
 *  An explicit AUD, when provided, must still match that production app.
 *
 * A successful static CI build does not demonstrate that Access protects www.
 * This script rejects missing scopes, missing paths and repair-Worker conflicts.
 * It intentionally performs no POST/PUT/PATCH/DELETE requests.
 */
const ACCOUNT='80d5b1d56a3e907150ba7348b6182894';
const HOSTS=['finnbilglass.no','www.finnbilglass.no'];
const PATHS=['/ops','/ops/*','/api/ops','/api/ops/*'];
const WORKER='finnbilglass-frontrute';
// Only these hostnames carry employee OPS. API Custom Domain is optional for
// this launch, but must point to the approved Worker when it exists.
const WORKER_DOMAINS=HOSTS;
const OPTIONAL_WORKER_DOMAINS=['api.finnbilglass.no'];
// Test both the exact OPS entry and a nested route; Cloudflare permits
// protecting a whole path prefix with one Access destination.
const REQUIRED=HOSTS.flatMap(host=>[
  host+'/ops',host+'/ops/ansatte',
  host+'/api/ops',host+'/api/ops/manual/session'
]);

function invariant(ok,reason){if(!ok)throw Error(reason)}
function uriKey(value){
  return String(value||'').trim().toLowerCase()
    .replace(/^https?:\/\//,'').replace(/\/$/,'');
}
function includesEveryone(value){
  if(Array.isArray(value))return value.some(includesEveryone);
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,v])=>
    (key.toLowerCase()==='everyone' && v!==false && v!==null) || includesEveryone(v));
}
function accessDestinations(app){
  // Cloudflare ignores legacy self_hosted_domains whenever destinations
  // is present. A partial list must never be filled from legacy values.
  if(Array.isArray(app.destinations)&&app.destinations.length)
    return app.destinations.filter(d=>d?.type==='public'&&typeof d.uri==='string');
  if(Array.isArray(app.self_hosted_domains)&&app.self_hosted_domains.length)
    return app.self_hosted_domains.map(d=>({uri:d.domain,overrides:[]}));
  return [{uri:app.domain,overrides:[]}];
}
function coversAccessPath(uri,samples){
  const key=uriKey(uri);
  if(!key)return false;
  if(key.includes('*')){
    const escaped=key.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*/g,'.*');
    const re=new RegExp('^'+escaped+'$','i');
    return samples.some(sample=>re.test(sample));
  }
  return samples.some(sample=>sample===key||sample.startsWith(key+'/'));
}
/**
 * The Cloudflare Access account is the source of truth for the production AUD.
 * Never choose an app by display name alone, and never quietly switch away
 * from an explicit protected-environment AUD if one is configured.
 * The only auto-discovery candidate must own ALL required apex/www OPS paths.
 * This helper is pure and never logs or returns the AUD in preflight output.
 */
export function resolveProductionAudience(apps, explicitAud){
  invariant(Array.isArray(apps),'ACCESS_APP_LIST_INVALID');
  const supplied=typeof explicitAud==='string'?explicitAud.trim():'';
  if(supplied){
    invariant(supplied.length>=20,'PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION');
    return {aud:supplied,source:'protected_environment'};
  }
  const candidates=apps.filter(app=>{
    if(app?.type!=='self_hosted'||typeof app.aud!=='string'||
       app.aud.length<20||typeof app.id!=='string')return false;
    const destinations=accessDestinations(app);
    return REQUIRED.every(uri=>destinations.some(d=>coversAccessPath(d.uri,[uri])));
  });
  invariant(candidates.length===1,'PROD_ACCESS_AUD_AUTODISCOVERY_NOT_UNIQUE_OR_MISSING');
  return {aud:candidates[0].aud,source:'cloudflare_account_read'};
}

export function validateAccess(apps,policies,aud){
  invariant(typeof aud==='string' && aud.length>=20,'PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION');
  invariant(Array.isArray(apps),'ACCESS_APP_LIST_INVALID');
  const matched=apps.filter(app=>app?.type==='self_hosted'&&app.aud===aud);
  invariant(matched.length===1,'EXACTLY_ONE_PROD_ACCESS_APP_AUD_REQUIRED');
  const app=matched[0];
  // Another more-specific app could bypass the intended protection. Inspect
  // all Access apps, not merely the one with our expected audience.
  const samples=REQUIRED;
  for(const other of apps){
    if(other?.type!=='self_hosted'||other.aud===aud)continue;
    if(accessDestinations(other).some(d=>coversAccessPath(d.uri,samples)))
      throw Error('COMPETING_ACCESS_APP_ON_PROTECTED_OPS_PATH');
  }
  const destinations=accessDestinations(app);
  for(const uri of REQUIRED)
    invariant(destinations.some(d=>coversAccessPath(d.uri,[uri])),
      'PROD_ACCESS_REQUIRED_PATH_MISSING');
  invariant(!destinations.some(d=>Array.isArray(d.overrides)&&
    d.overrides.some(o=>o.behavior==='public')),
    'PROD_ACCESS_PUBLIC_OVERRIDE_PRESENT');
  invariant(Array.isArray(policies)&&policies.length>0,'PROD_ACCESS_POLICIES_NOT_READABLE');
  invariant(policies.some(p=>p?.decision==='allow'),'PROD_ACCESS_ALLOW_POLICY_MISSING');
  invariant(!policies.some(p=>['bypass','non_identity'].includes(p?.decision)),
    'PROD_ACCESS_UNSAFE_BYPASS_POLICY');
  invariant(!policies.some(p=>p?.decision==='allow'&&includesEveryone(p.include)),
    'PROD_ACCESS_ALLOW_EVERYONE_FORBIDDEN');
  return {protectedPaths:REQUIRED.length,
    allowPolicies:policies.filter(p=>p.decision==='allow').length};
}

/** Fail closed when a zone route can intercept protected OPS requests before
 * the correct Custom Domain Worker. A replacement Worker with a different name
 * is as unsafe as the historical ops-repair Worker.
 */
export function validateWorkerRoutes(routes){
  invariant(Array.isArray(routes),'WORKER_ROUTES_NOT_READABLE');
  const targets=HOSTS.flatMap(host=>[
    host+'/ops',host+'/ops/ansatte',
    host+'/api/ops',host+'/api/ops/manual/session'
  ]);
  for(const route of routes){
    const pattern=String(route?.pattern??'').trim().toLowerCase().replace(/^https?:\/\//,'');
    invariant(pattern && /^[a-z0-9*.-]+\.[a-z0-9*.-]+(?:\/.*)?$/.test(pattern),
      'WORKER_ROUTE_PATTERN_INVALID');
    // Route syntax: '*' is a glob. Do not treat route patterns as regex input.
    const escaped=pattern.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*/g,'.*');
    const matches=new RegExp('^'+escaped+'$','i');
    if(targets.some(path=>matches.test(path))&&route.script!==WORKER)
      throw Error('OPS_PATH_INTERCEPTED_BY_OTHER_WORKER_ROUTE');
    if(/ops[-_]repair/i.test(String(route.script??'')) &&
       /finnbilglass\.no/i.test(pattern))
      throw Error('LEGACY_OPS_REPAIR_WORKER_ROUTE_MUST_BE_CLEARED');
  }
  return {routesChecked:routes.length,legacyRepairRoutes:0};
}

/** Custom Domains decide which Worker serves apex/www/api in production.
 * DNS existence alone does not prove that the requests reach the right Worker.
 */
export function validateWorkerDomains(domains){
  invariant(Array.isArray(domains),'WORKER_CUSTOM_DOMAINS_NOT_READABLE');
  function verifyDomain(host,required){
    const entries=domains.filter(d=>String(d?.hostname??'').toLowerCase()===host);
    if(!required&&entries.length===0)return false;
    invariant(entries.length===1,'WORKER_CUSTOM_DOMAIN_MISSING_OR_DUPLICATED');
    const domain=entries[0];
    // Cloudflare may omit deprecated optional enabled/environment fields.
    invariant(domain.enabled!==false &&
      domain.service===WORKER &&
      domain.zone_name==='finnbilglass.no' &&
      (domain.environment==null || domain.environment==='production'),
      'WORKER_CUSTOM_DOMAIN_WRONG_SERVICE_OR_ENVIRONMENT');
    return true;
  }
  for(const host of WORKER_DOMAINS)verifyDomain(host,true);
  const optionalWorkerCustomDomains=OPTIONAL_WORKER_DOMAINS
    .filter(host=>verifyDomain(host,false)).length;
  return {workerCustomDomains:WORKER_DOMAINS.length,
    optionalWorkerCustomDomains};
}

export async function readCloudflareList(path,token,request=fetch){
  const MAX_PAGES=200;
  const MAX_ITEMS=20000;
  const records=[];
  let totalPages=null;
  for(let page=1;page<=MAX_PAGES;page++){
    const url=new URL('https://api.cloudflare.com/client/v4'+path);
    if(page>1)url.searchParams.set('page',String(page));
    let response;
    try{
      response=await request(url.toString(),{method:'GET',headers:{
        Authorization:'Bearer '+token,Accept:'application/json'
      },signal:AbortSignal.timeout(12000)});
    }catch{throw Error('CLOUDFLARE_READ_ONLY_API_UNAVAILABLE')}
    if(!response?.ok)throw Error('CLOUDFLARE_READ_ONLY_API_PERMISSION_OR_HTTP_ERROR');
    let body;
    try{body=await response.json()}
    catch{throw Error('CLOUDFLARE_READ_ONLY_API_INVALID_JSON')}
    invariant(body?.success===true && Array.isArray(body.result),
      'CLOUDFLARE_READ_ONLY_API_FAILED');
    const info=body.result_info;
    if(info?.page!=null)invariant(info.page===page,'CLOUDFLARE_PAGINATION_INCONSISTENT');
    if(info?.count!=null)invariant(info.count===body.result.length,'CLOUDFLARE_PAGINATION_INCONSISTENT');
    let pages=info?.total_pages??1;
    invariant(Number.isInteger(pages)&&pages>=0&&pages<=MAX_PAGES,
      'CLOUDFLARE_PAGINATION_INVALID');
    if(pages===0){
      invariant(page===1&&body.result.length===0,
        'CLOUDFLARE_PAGINATION_INCONSISTENT');
      pages=1;
    }
    if(totalPages===null)totalPages=pages;
    else invariant(pages===totalPages,'CLOUDFLARE_PAGINATION_INCONSISTENT');
    records.push(...body.result);
    invariant(records.length<=MAX_ITEMS,'CLOUDFLARE_PAGINATION_LIMIT_EXCEEDED');
    if(page===totalPages)return records;
    invariant(body.result.length>0,'CLOUDFLARE_PAGINATION_INCOMPLETE');
  }
  throw Error('CLOUDFLARE_PAGINATION_LIMIT_EXCEEDED');
}

export async function preflight(env=process.env){
  invariant(env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT,'WRONG_PRODUCTION_CLOUDFLARE_ACCOUNT');
  const token=env.CLOUDFLARE_API_TOKEN;
  invariant(typeof token==='string'&&token.length>20,'CLOUDFLARE_API_TOKEN_MISSING');
  const apps=await readCloudflareList('/accounts/'+ACCOUNT+'/access/apps?per_page=1000',token);
  const selected=resolveProductionAudience(apps,env.OPS_ACCESS_AUD);
  const app=apps.find(a=>a?.type==='self_hosted'&&a.aud===selected.aud);
  invariant(app?.id,'EXACT_PROD_ACCESS_APP_NOT_FOUND');
  const policies=await readCloudflareList('/accounts/'+ACCOUNT+'/access/apps/'+encodeURIComponent(app.id)+'/policies?per_page=1000',token);
  const checkedAccess=validateAccess(apps,policies,selected.aud);
  const zones=await readCloudflareList('/zones?name=finnbilglass.no&per_page=50',token);
  invariant(zones.length===1 && typeof zones[0]?.id==='string','PROD_ZONE_NOT_UNAMBIGUOUS');
  const routes=await readCloudflareList('/zones/'+encodeURIComponent(zones[0].id)+'/workers/routes',token);
  const checkedRoutes=validateWorkerRoutes(routes);
  // Filter server-side by documented hostname selector instead of assuming
  // the account-wide first page contains all three required Custom Domains.
  const domains=(await Promise.all([...WORKER_DOMAINS,...OPTIONAL_WORKER_DOMAINS].map(host=>
    readCloudflareList('/accounts/'+ACCOUNT+'/workers/domains?hostname='+encodeURIComponent(host),token)
  ))).flat();
  const checkedDomains=validateWorkerDomains(domains);
  // Only sanitized counts and status. No raw app, policy, AUD, route or secret.
  return {status:'PASS',readOnly:true,audienceSource:selected.source,...checkedAccess,...checkedRoutes,...checkedDomains};
}
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  preflight().then(report=>console.log('CF_OPS_PREFLIGHT='+JSON.stringify(report)))
    .catch(e=>{console.error('CF_OPS_PREFLIGHT_NO_GO: '+e.message);process.exitCode=1});
}
