/** Staff authenticated routes for the manual offer -> order workflow.
 * All writes fail closed until the staging flag and reviewed D1 migration exist.
 */
import type { Env } from './types';
import { verifyManualOpsStaff, validManualWriteOrigin } from './ops-manual-access';
import { recogniseInvitedStaff, appendOpsAudit } from './ops-staff';
import { recordCustomerAcceptance, createOrderFromAcceptedOffer, recordPortalPaymentLink } from './ops-manual-order';
import { sendQueuedOffer, reconcileOfferSend, type OfferForSend } from './ops-offer-outbox';

type Row = Record<string, unknown>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const id=()=>crypto.randomUUID().replace(/-/g,'');
async function body(request:Request):Promise<Row|null>{try{const v=await request.json();return v&&typeof v==='object'&&!Array.isArray(v)?v as Row:null}catch{return null}}

export async function handleOpsManualRoute(request:Request,env:Env):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(env.OPS_MANUAL_ORDERS_ENABLED!=='true'||env.OPS_STAFF_PORTAL_ENABLED!=='true'||!['staging','production'].includes(env.ENVIRONMENT))return json({ok:false,error:'IKKE_AKTIVERT'},404);
  const verified=await verifyManualOpsStaff(request,env),token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!verified||!token)return json({ok:false,error:'INNLOGGING_PAKREVD'},401);
  let staff;try{staff=await recogniseInvitedStaff(env.FINNBILGLASS_DB,verified,token)}catch{return json({ok:false,error:'ANSATTTILGANG_IKKE_KLAR'},503)}
  if(!staff||!['ADMIN','OPERATOR'].includes(staff.role))return json({ok:false,error:'IKKE_TILLATT'},403);
  if(request.method==='GET'&&/^\/api\/ops\/manual\/inquiries\/\d+\/(offers|orders)$/.test(path)){
    const inquiryId=Number(path.split('/')[5]);
    const inquiry=await env.FINNBILGLASS_DB.prepare('SELECT id FROM beta_inquiries WHERE id=?').bind(inquiryId).first();
    if(!inquiry)return json({ok:false,error:'SAK_IKKE_FUNNET'},404);
    try{
      const offers=await env.FINNBILGLASS_DB.prepare('SELECT * FROM ops_manual_offers WHERE inquiry_id=? ORDER BY version DESC').bind(inquiryId).all();
      const orders=await env.FINNBILGLASS_DB.prepare('SELECT * FROM ops_manual_orders WHERE inquiry_id=?').bind(inquiryId).all();
      const sendQueue=await env.FINNBILGLASS_DB.prepare("SELECT offer_id,status,provider_message_id,last_error,send_started_at,updated_at FROM ops_offer_outbox WHERE inquiry_id=? ORDER BY created_at DESC").bind(inquiryId).all();
      return json({ok:true,offers:offers.results||[],orders:orders.results||[],sendQueue:sendQueue.results||[]});
    }catch{return json({ok:false,error:'MANUELL_ORDRE_MIGRASJON_MANGLER'},503)}
  }
  if(request.method!=='POST'||!validManualWriteOrigin(request))return json({ok:false,error:'UGYLDIG_FORESPORSEL'},403);
  const payload=await body(request);if(!payload)return json({ok:false,error:'UGYLDIG_JSON'},400);
  const create=/^\/api\/ops\/manual\/inquiries\/(\d+)\/offers$/.exec(path);
  if(create){
    const inquiryId=Number(create[1]),sku=typeof payload.sku==='string'?payload.sku.trim():'',evidence=typeof payload.fitmentEvidenceRef==='string'?payload.fitmentEvidenceRef.trim():'';
    const total=Number(payload.totalMinor),delivery=typeof payload.deliveryNote==='string'?payload.deliveryNote.trim():'';
    const equipment=payload.equipment&&typeof payload.equipment==='object'&&!Array.isArray(payload.equipment)?JSON.stringify(payload.equipment):'{}';
    if(!sku||sku.length>120||evidence.length<8||evidence.length>200||!Number.isSafeInteger(total)||total<=0||!delivery||delivery.length>500||equipment.length>5000)return json({ok:false,error:'TILBUDSFELT_UGYLDIG'},400);
    const inquiry=await env.FINNBILGLASS_DB.prepare('SELECT id FROM beta_inquiries WHERE id=?').bind(inquiryId).first();if(!inquiry)return json({ok:false,error:'SAK_IKKE_FUNNET'},404);
    const offerId=id(),now=Date.now();
    try{
      const version=await env.FINNBILGLASS_DB.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM ops_manual_offers WHERE inquiry_id=?').bind(inquiryId).first<{version:number}>();
      await env.FINNBILGLASS_DB.prepare("INSERT INTO ops_manual_offers(offer_id,inquiry_id,version,sku,fitment_evidence_ref,equipment_json,total_minor,currency,delivery_note,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,'NOK',?,'DRAFT',?,?)").bind(offerId,inquiryId,version?.version||1,sku,evidence,equipment,total,delivery,staff.email,now).run();
      await appendOpsAudit(env.FINNBILGLASS_DB,staff.email,'OFFER_CREATED','OFFER',offerId,now);
      return json({ok:true,offerId,version:version?.version||1,status:'DRAFT'},201);
    }catch{return json({ok:false,error:'TILBUD_KUNNE_IKKE_LAGRES'},503)}
  }
  const send=/^\\/api\\/ops\\/manual\\/offers\\/([A-Za-z0-9_-]{8,100})\\/send$/.exec(path);
  if(send){
    const offer=await env.FINNBILGLASS_DB.prepare('SELECT o.*,i.navn,i.kontakt FROM ops_manual_offers o JOIN beta_inquiries i ON i.id=o.inquiry_id WHERE o.offer_id=?').bind(send[1]).first<OfferForSend>();
    if(!offer)return json({ok:false,error:'TILBUD_IKKE_FUNNET'},404);
    try{
      const result=await sendQueuedOffer(env,offer,staff.email);
      return json({offerId:send[1],...result},result.ok?200:result.requiresReview?409:400);
    }catch{return json({ok:false,error:'TILBUDSKOE_UTILGJENGELIG_ELLER_SENDT_UAVSTEMT',requiresReview:true},503)}
  }
  // Reconciliation may only be performed by an admin after locating the actual
  // Resend message ID. This endpoint verifies it with Resend via GET; never resends.
  const reconcile=/^\\/api\\/ops\\/manual\\/offers\\/([A-Za-z0-9_-]{8,100})\\/reconcile$/.exec(path);
  if(reconcile){
    if(staff.role!=='ADMIN')return json({ok:false,error:'KREVER_ADMIN'},403);
    const providerId=typeof payload.providerMessageId==='string'?payload.providerMessageId.trim():'';
    try{
      const result=await reconcileOfferSend(env,reconcile[1],staff.email,providerId);
      return json({offerId:reconcile[1],...result},result.ok?200:409);
    }catch{return json({ok:false,error:'AVSTEMMING_MA_KONTROLLERES_MANUELT'},503)}
  }
  const accept=/^\/api\/ops\/manual\/offers\/([A-Za-z0-9_-]{8,100})\/accept$/.exec(path);
  if(accept){
    const at=Number(payload.acceptedAt)||Date.now();
    try{const result=await recordCustomerAcceptance(env.FINNBILGLASS_DB,{offerId:accept[1],actor:staff.email,acceptedAt:at,channel:payload.channel as 'EMAIL'|'PHONE'|'WRITTEN',evidenceReference:String(payload.evidenceReference||'')});if(result.recorded)await appendOpsAudit(env.FINNBILGLASS_DB,staff.email,'OFFER_ACCEPTED','OFFER',accept[1],at);return json({ok:true,...result})}catch(e){return json({ok:false,error:e instanceof Error?e.message:'AKSEPT_FEILET'},409)}
  }
  const order=/^\/api\/ops\/manual\/offers\/([A-Za-z0-9_-]{8,100})\/order$/.exec(path);
  if(order){try{const result=await createOrderFromAcceptedOffer(env.FINNBILGLASS_DB,{offerId:order[1],orderId:String(payload.orderId||id()),actor:staff.email,createdAt:Date.now()});if(result.created)await appendOpsAudit(env.FINNBILGLASS_DB,staff.email,'ORDER_CREATED','ORDER',result.order.order_id);return json({ok:true,...result},result.created?201:200)}catch(e){return json({ok:false,error:e instanceof Error?e.message:'ORDRE_FEILET'},409)}}
  const link=/^\/api\/ops\/manual\/orders\/([A-Za-z0-9_-]{8,100})\/payment-link$/.exec(path);
  if(link){try{const recorded=await recordPortalPaymentLink(env.FINNBILGLASS_DB,{orderId:link[1],reference:String(payload.reference||''),sentAt:Number(payload.sentAt)||Date.now()});if(recorded)await appendOpsAudit(env.FINNBILGLASS_DB,staff.email,'PAYMENT_LINK_RECORDED','ORDER',link[1]);return json({ok:recorded,recorded},recorded?200:409)}catch(e){return json({ok:false,error:e instanceof Error?e.message:'LENKE_FEILET'},409)}}
  return json({ok:false,error:'IKKE_FUNNET'},404);
}
