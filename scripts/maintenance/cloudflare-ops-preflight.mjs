#!/usr/bin/env node
/**
 * Read-only production Cloudflare Access and Worker-route release gate.
 * Never outputs token, Access AUD, customer data, or raw API responses.
 * Requires a protected GitHub production environment with:
 *  CLOUDFLARE_API_TOKEN (Access Apps & Policies Read, Zones Read, Workers Routes Read, Workers Scripts Read),
 *  CLOUDFLARE_ACCOUNT_ID, OPS_ACCESS_AUD (actual production app audience).
 *
 * A successful static CI build does not demonstrate that Access protects www.
 * This script rejects missing scopes, missing paths and repair-Worker conflicts.
 * It intentionally performs no POST/PUT/PATCH/DELETE requests.
 */
const ACCOUNT='80d5b1d56a3e907150ba7348b6182894';
const HOSTS=['finnbilglass.no','www.finnbilglass.no'];
const PATHS=['/ops','/ops/*','/api/ops','/api/ops/*'];
const WORKER='finnbilglass-frontrute';
const WORKER_DOMAINS=[...HOSTS,'api.finnbilglass.no'];
const REQUIRED=HOSTS.flatMap(host=>PATHS.map(path=>host+path));

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
export function validateAccess(apps,policies,aud){
  invariant(typeof aud==='string' && aud.length>=20,'PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION');
  invariant(Array.isArray(apps),'ACCESS_APP_LIST_INVALID');
  const matched=apps.filter(app=>app?.type==='self_hosted'&&app.aud===aud);
  invariant(matched.length===1,'EXACTLY_ONE_PROD_ACCESS_APP_AUD_REQUIRED');
  const app=matched[0];
  // New destinations supersede deprecated self_hosted_domains. Never merge
  // destinations with a stale legacy domain list to fabricate coverage.
  const destinations=Array.isArray(app.destinations)&&app.destinations.length
    ?app.destinations.filter(d=>d?.type==='public'&&typeof d.uri==='string')
    :Array.isArray(app.self_hosted_domains)&&app.self_hosted_domains.length
      ?app.self_hosted_domains.map(d=>({uri:d.domain,overrides:[]}))
      :[{uri:app.domain,overrides:[]}];
  const actual=new Set(destinations.map(d=>uriKey(d.uri)));
  for(const uri of REQUIRED)invariant(actual.has(uri),'PROD_ACCESS_REQUIRED_PATH_MISSING');
  invariant(!destinations.some(d=>(d.overrides??[]).some(o=>o.behavior==='public')),
    'PROD_ACCESS_PUBLIC_OVERRIDE_PRESENT');
  invariant(Array.isArray(policies)&&policies.length>0,'PROD_ACCESS_POLICIES_NOT_READABLE');
  invariant(policies.some(p=>p?.decision==='allow'),'PROD_ACCESS_ALLOW_POLICY_MISSING');
  invariant(!policies.some(p=>['bypass','non_identity'].includes(p?.decision)),
    'PROD_ACCESS_UNSAFE_BYPASS_POLICY');
  invariant(!policies.some(p=>p?.decision==='allow'&&includesEveryone(p.include)),
    'PROD_ACCESS_ALLOW_EVERYONE_FORBIDDEN');
  return {protectedPaths:REQUIRED.length,allowPolicies:policies.filter(p=>p.decision==='allow').length};
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
  for(const host of WORKER_DOMAINS){
    const entries=domains.filter(d=>String(d?.hostname??'').toLowerCase()===host);
    invariant(entries.length===1,'WORKER_CUSTOM_DOMAIN_MISSING_OR_DUPLICATED');
    const domain=entries[0];
    invariant(domain.enabled===true &&
      domain.service===WORKER &&
      domain.zone_name==='finnbilglass.no' &&
      domain.environment==='production',
      'WORKER_CUSTOM_DOMAIN_WRONG_SERVICE_OR_ENVIRONMENT');
  }
  return {workerCustomDomains:WORKER_DOMAINS.length};
}

async function api(path,token){
  const url='https://api.cloudflare.com/client/v4'+path;
  let response;
  try{
    response=await fetch(url,{method:'GET',headers:{
      Authorization:'Bearer '+token,Accept:'application/json'
    },signal:AbortSignal.timeout(12000)});
  }catch{throw Error('CLOUDFLARE_READ_ONLY_API_UNAVAILABLE')}
  if(!response.ok)throw Error('CLOUDFLARE_READ_ONLY_API_PERMISSION_OR_HTTP_ERROR');
  let body;
  try{body=await response.json()}catch{throw Error('CLOUDFLARE_READ_ONLY_API_INVALID_JSON')}
  invariant(body?.success===true && Array.isArray(body.result),
    'CLOUDFLARE_READ_ONLY_API_FAILED');
  invariant((body.result_info?.total_pages??1)===1,'CLOUDFLARE_PAGINATION_NOT_EXHAUSTIVE');
  return body.result;
}
export async function preflight(env=process.env){
  invariant(env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT,'WRONG_PRODUCTION_CLOUDFLARE_ACCOUNT');
  const token=env.CLOUDFLARE_API_TOKEN;
  invariant(typeof token==='string'&&token.length>20,'CLOUDFLARE_API_TOKEN_MISSING');
  invariant(typeof env.OPS_ACCESS_AUD==='string'&&env.OPS_ACCESS_AUD.length>=20,
    'PROD_ACCESS_AUD_NOT_PROVIDED_FOR_VERIFICATION');
  const apps=await api('/accounts/'+ACCOUNT+'/access/apps?per_page=1000',token);
  const app=apps.find(a=>a?.type==='self_hosted'&&a.aud===env.OPS_ACCESS_AUD);
  invariant(app?.id,'EXACT_PROD_ACCESS_APP_NOT_FOUND');
  const policies=await api('/accounts/'+ACCOUNT+'/access/apps/'+encodeURIComponent(app.id)+'/policies?per_page=1000',token);
  const checkedAccess=validateAccess(apps,policies,env.OPS_ACCESS_AUD);
  const zones=await api('/zones?name=finnbilglass.no&per_page=50',token);
  invariant(zones.length===1 && typeof zones[0]?.id==='string','PROD_ZONE_NOT_UNAMBIGUOUS');
  const routes=await api('/zones/'+encodeURIComponent(zones[0].id)+'/workers/routes',token);
  const checkedRoutes=validateWorkerRoutes(routes);
  const domains=await api('/accounts/'+ACCOUNT+'/workers/domains?per_page=1000',token);
  const checkedDomains=validateWorkerDomains(domains);
  // Only sanitized counts and status. No raw app, policy, AUD, route or secret.
  return {status:'PASS',readOnly:true,...checkedAccess,...checkedRoutes,...checkedDomains};
}
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  preflight().then(report=>console.log('CF_OPS_PREFLIGHT='+JSON.stringify(report)))
    .catch(e=>{console.error('CF_OPS_PREFLIGHT_NO_GO: '+e.message);process.exitCode=1});
}
