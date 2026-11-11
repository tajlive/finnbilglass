/** Staff admin, invitations and read-only login/activity timeline.
 * Protected by ONE Cloudflare Access SSO and DB invitation/role.
 * No support-token fallback, checkout, capture, refunds or automated payments.
 */
import type { Env } from './types';
import { verifyManualOpsStaff, validManualWriteOrigin } from './ops-manual-access';
import { recogniseInvitedStaff, inviteOpsStaff, revokeOpsStaff, listOpsStaff, listOpsActivity } from './ops-staff';
import { opsStaffUi } from './ops-staff-ui';
import { sendMail, avsenderEpost } from './mail';
import { beginWorkspaceOAuth, finishWorkspaceOAuth, workspaceConnectionStatus } from './ops-workspace-oauth';
import { checkWorkspaceGmailPreflight } from './ops-workspace-preflight';

function reply(data:unknown,status=200):Response{
 return new Response(JSON.stringify(data),{status,headers:{
   'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff'
 }});
}
async function bodyJson(request:Request):Promise<Record<string,unknown>|null>{
 try{
  const payload=await request.json();
  return payload&&typeof payload==='object'&&!Array.isArray(payload)
    ?payload as Record<string,unknown>:null;
 }catch{return null}
}
async function sendInvitationEmail(env:Env,to:string,loginUrl:string,role:string):Promise<boolean>{
 if(!env.RESEND_API_KEY)return false;
 const sender=avsenderEpost(env);
 const safeUrl=loginUrl.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const html='<p>Du er invitert til FinnBilGlass Operations Centre som '+
  role+'.</p><p>Logg inn med Google eller engangskode på <a href="'+safeUrl+
  '">Operations Centre</a>.</p><p>Du trenger ikke opprette et nytt passord.</p>';
 const sent=await sendMail(env,{to,subject:'Invitasjon til FinnBilGlass Operations Centre',
  html,text:`Du er invitert til FinnBilGlass Operations Centre som ${role}. Logg inn på ${loginUrl}.`,
  replyTo:sender});
 return sent.ok;
}

export async function handleOpsStaffRoute(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url),path=url.pathname;
 if(env.OPS_STAFF_PORTAL_ENABLED!=='true' ||
   !['staging','production'].includes(env.ENVIRONMENT))
   return reply({ok:false,error:'IKKE_AKTIVERT'},404);
 const verified=await verifyManualOpsStaff(request,env);
 if(!verified)return reply({ok:false,error:'INNLOGGING_PAKREVD'},401);
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)return reply({ok:false,error:'INNLOGGING_PAKREVD'},401);
 let staff;
 try{staff=await recogniseInvitedStaff(env.FINNBILGLASS_DB,verified,token)}
 catch{return reply({ok:false,error:'ANSATTTILGANG_IKKE_KLAR'},503)}
 if(!staff)return reply({ok:false,error:'IKKE_INVITERT_ELLER_DEAKTIVERT'},403);
 if(request.method==='GET' && path==='/ops/ansatte')return opsStaffUi();
 if(request.method==='GET' && path==='/api/ops/manual/session')
   return reply({ok:true,staff:{email:staff.email,role:staff.role}});
 if(staff.role!=='ADMIN')return reply({ok:false,error:'KREVER_ADMIN'},403);
 // OAuth is separate from Cloudflare Access login and only ADMIN may grant Gmail read-only.
 if(request.method==='GET'&&path==='/api/ops/manual/workspace/oauth/status'){
  return reply({ok:true,...await workspaceConnectionStatus(env)});
 }
 if(request.method==='GET'&&path==='/api/ops/manual/workspace/oauth/callback'){
  return finishWorkspaceOAuth(request,env,staff);
 }

 if(request.method==='GET' && path==='/api/ops/manual/staff'){
  try{return reply({ok:true,staff:await listOpsStaff(env.FINNBILGLASS_DB,staff)})}
  catch{return reply({ok:false,error:'ANSATTLISTE_IKKE_TILGJENGELIG'},503)}
 }
 if(request.method==='GET' && path==='/api/ops/manual/activity'){
  const cap=Number(url.searchParams.get('limit')||'50');
  const before=Number(url.searchParams.get('before')||0)||undefined;
  try{return reply({ok:true,events:await listOpsActivity(
    env.FINNBILGLASS_DB,staff,Number.isFinite(cap)?cap:50,before
  )})}
  catch{return reply({ok:false,error:'AKTIVITETSLOGG_IKKE_TILGJENGELIG'},503)}
 }
 if(request.method!=='POST')return reply({ok:false,error:'IKKE_FUNNET'},404);
 if(!validManualWriteOrigin(request))return reply({ok:false,error:'UGYLDIG_FORESPORSEL'},403);
 const payload=await bodyJson(request);
 if(!payload)return reply({ok:false,error:'UGYLDIG_JSON'},400);

 if(path==='/api/ops/manual/workspace/oauth/start'){
  return beginWorkspaceOAuth(env,staff);
 }
 // ADMIN-only POST behind verified signed Access JWT and same-origin intent header.
 // No Gmail message fetch, D1 writes, provider response body, or token in response.
 if(path==='/api/ops/manual/workspace/oauth/preflight'){
  return reply({ok:true,preflight:await checkWorkspaceGmailPreflight(env)});
 }
 if(path==='/api/ops/manual/staff/invite'){
  if(typeof payload.email!=='string' || typeof payload.role!=='string')
    return reply({ok:false,error:'EPOST_OG_ROLLE_PAKREVD'},400);
  try{
   const invitation=await inviteOpsStaff(env.FINNBILGLASS_DB,staff,
     payload.email,payload.role as 'ADMIN'|'REVIEWER'|'OPERATOR');
   const loginUrl=url.origin+'/ops/ansatte';
   const emailSent=await sendInvitationEmail(env,invitation.email,loginUrl,invitation.role);
   return reply({ok:true,...invitation,emailSent,loginUrl},201);
  }catch(err){
   const code=err instanceof Error?err.message:'INVITASJON_FEILET';
   if(code.startsWith('OPS_STAFF_'))return reply({ok:false,error:code},400);
   return reply({ok:false,error:'INVITASJON_FEILET'},503);
  }
 }
 if(path==='/api/ops/manual/staff/revoke'){
  if(typeof payload.email!=='string')return reply({ok:false,error:'EPOST_PAKREVD'},400);
  try{
   const revoked=await revokeOpsStaff(env.FINNBILGLASS_DB,staff,payload.email);
   return reply({ok:revoked,revoked});
  }catch(err){
   const code=err instanceof Error?err.message:'DEAKTIVERING_FEILET';
   return reply({ok:false,error:code.startsWith('OPS_STAFF_')?code:'DEAKTIVERING_FEILET'},400);
  }
 }
 return reply({ok:false,error:'IKKE_FUNNET'},404);
}
