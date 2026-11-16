#!/usr/bin/env node
/**
 * Stage the production Access audience for ONE authorized Wrangler deploy,
 * using GET-only Cloudflare API calls.
 * Never log AUD, API tokens or raw Cloudflare responses.
 *
 * Run AFTER cloudflare-ops-preflight.mjs passes in the protected, manually
 * authorized production job. No Cloudflare writes happen in this script.
 */
import {resolveProductionAudience} from './cloudflare-ops-preflight.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='80d5b1d56a3e907150ba7348b6182894';
const FILE='fbg-access-secret.json';

export async function stageAccessAudience(env=process.env,request=fetch){
  if(env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT)throw Error('WRONG_PRODUCTION_CLOUDFLARE_ACCOUNT');
  if(typeof env.CLOUDFLARE_API_TOKEN!=='string'||env.CLOUDFLARE_API_TOKEN.length<20)
    throw Error('CLOUDFLARE_API_TOKEN_MISSING');
  if(typeof env.RUNNER_TEMP!=='string'||!env.RUNNER_TEMP.startsWith('/'))
    throw Error('RUNNER_TEMP_REQUIRED');
  let response;
  try{
    response=await request(
      'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/access/apps?per_page=1000',{
        method:'GET',
        headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,Accept:'application/json'},
        signal:AbortSignal.timeout(12000)
      });
  }catch{
    throw Error('CLOUDFLARE_AUD_READ_UNAVAILABLE');
  }
  if(!response?.ok)throw Error('CLOUDFLARE_AUD_READ_HTTP_ERROR');
  let body;
  try{body=await response.json()}catch{throw Error('CLOUDFLARE_AUD_READ_INVALID_JSON')}
  if(body?.success!==true||!Array.isArray(body.result)||
     (body.result_info?.total_pages??1)!==1)
    throw Error('CLOUDFLARE_AUD_READ_NOT_EXHAUSTIVE');
  const chosen=resolveProductionAudience(body.result);
  if(env.OPS_ACCESS_AUD && env.OPS_ACCESS_AUD.trim()!==chosen.aud)
    throw Error('PRODUCTION_AUD_ENV_MISMATCH');
  const output=join(env.RUNNER_TEMP,FILE);
  // wx prevents reuse of a stale file; 0600 restricts file permissions.
  writeFileSync(output,JSON.stringify({OPS_ACCESS_AUD:chosen.aud}),{
    encoding:'utf8',mode:0o600,flag:'wx'
  });
  return {status:'PASS',staged:true,filename:FILE};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  stageAccessAudience().then(()=>console.log('PRODUCTION_AUD_EPHEMERAL_FILE=PASS'))
    .catch(e=>{console.error('PRODUCTION_AUD_STAGE_NO_GO: '+e.message);process.exitCode=1});
}
