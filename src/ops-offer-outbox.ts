/** Durable, single-attempt offer queue. An uncertain send is NEVER retried blindly.
 * Resend's idempotency window is only 24h; D1 owns the permanent decision.
 */
import type { Env } from './types';
import { sendMail, avsenderEpost } from './mail';

export interface OfferForSend {
  offer_id: string;
  inquiry_id: number;
  version: number;
  sku: string;
  total_minor: number;
  delivery_note: string;
  navn: string | null;
  kontakt: string;
  status: string;
}
type OutboxRow = {
  offer_id: string; inquiry_id: number; request_id: string;
  recipient: string; subject: string; text_body: string; html_body: string;
  status: 'QUEUED'|'SENDING'|'SENT'|'REVIEW';
  provider_message_id: string | null;
};
type Result = { ok: boolean; status: string; alreadySent?: boolean; requiresReview?: boolean; error?: string; providerMessageId?: string };
const escaped = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));

async function completeSend(env: Env, row: OutboxRow, actor: string, providerId: string): Promise<void> {
  const db = env.FINNBILGLASS_DB, now = Date.now();
  // D1 batch is transactional: outbox, quote state, case journal and employee audit
  // either persist together or remain for operator reconciliation.
  const changes = await db.batch([
    db.prepare("UPDATE ops_offer_outbox SET status='SENT',provider_message_id=?,updated_at=?,last_error=NULL WHERE offer_id=? AND status IN ('SENDING','REVIEW')")
      .bind(providerId,now,row.offer_id),
    db.prepare("UPDATE ops_manual_offers SET status='SENT',sent_at=? WHERE offer_id=? AND status='DRAFT'")
      .bind(now,row.offer_id),
    db.prepare("INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by,meta_json) VALUES(?,?,'reply',?,?,?,?)")
      .bind('offer-'+row.offer_id,row.inquiry_id,row.text_body,now,actor,
        JSON.stringify({offerId:row.offer_id,provider:'resend',provider_message_id:providerId,request_id:row.request_id})),
    db.prepare("INSERT OR IGNORE INTO ops_staff_activity(event_id,actor_email,action,subject_type,subject_id,created_at,details_json) VALUES(?,?,'OFFER_SENT','OFFER',?,?,?)")
      .bind('offer-sent-'+row.offer_id,actor,row.offer_id,now,JSON.stringify({providerMessageId:providerId})),
  ]);
  if (changes[0]?.meta.changes !== 1 || changes[1]?.meta.changes !== 1) {
    throw new Error('OFFER_OUTBOX_STATE_CONFLICT');
  }
}

export async function sendQueuedOffer(env: Env, offer: OfferForSend, actor: string): Promise<Result> {
  const db=env.FINNBILGLASS_DB;
  if (offer.status === 'SENT' || offer.status === 'ACCEPTED') return {ok:true,status:offer.status,alreadySent:true};
  // Never try sending a real provider email to reserved synthetic domains.
  // This must be checked BEFORE an outbox record is queued or claimed.
  const recipient = offer.kontakt.trim();
  const domain = recipient.split('@')[1]?.toLowerCase() ?? '';
  const syntheticDomain = /(^|\.)(invalid|test|example|localhost)$/.test(domain);
  if (offer.status !== 'DRAFT' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || syntheticDomain) {
    return {ok:false,status:'REJECTED',error:syntheticDomain?'TESTADRESSE_KAN_IKKE_MOTTA_TILBUD':'TILBUD_ELLER_EPOST_UGYLDIG'};
  }
  const subject=`Tilbud på bilglass – sak ${offer.inquiry_id}, versjon ${offer.version}`;
  const message=`Hei ${String(offer.navn||'')},\n\nTilbud ${offer.version}: ${offer.sku}\nTotalpris inkl. mva.: ${(Number(offer.total_minor)/100).toFixed(2)} NOK\nLevering: ${offer.delivery_note}\n\nSvar på denne e-posten for å godta tilbudet. Oppgi tilbudsversjon ${offer.version}.\n\nFinnBilglass`;
  const html=`<p>${escaped(message).replace(/\n/g,'<br>')}</p>`;
  const now=Date.now(), key='ops-offer-'+offer.offer_id;
  // Exactly one immutable payload and request key are persisted BEFORE calling Resend.
  await db.prepare("INSERT OR IGNORE INTO ops_offer_outbox(offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'QUEUED',?,?)")
    .bind(offer.offer_id,offer.inquiry_id,key,offer.kontakt,subject,message,html,now,now).run();
  const row=await db.prepare("SELECT * FROM ops_offer_outbox WHERE offer_id=?").bind(offer.offer_id).first<OutboxRow>();
  if (!row) throw new Error('OFFER_OUTBOX_MISSING');
  if (row.status==='SENT') return {ok:true,status:'SENT',alreadySent:true,providerMessageId:row.provider_message_id||undefined};
  if (row.status!=='QUEUED') return {ok:false,status:row.status,requiresReview:true,error:'UTSENDING_KREVER_AVSTEMMING'};
  const claimed=await db.prepare("UPDATE ops_offer_outbox SET status='SENDING',send_started_at=?,updated_at=? WHERE offer_id=? AND status='QUEUED'")
    .bind(Date.now(),Date.now(),row.offer_id).run();
  if (claimed.meta.changes!==1) return {ok:false,status:'SENDING',requiresReview:true,error:'UTSENDING_ALLEREDE_RESERVERT'};
  const sent=await sendMail(env,{to:row.recipient,subject:row.subject,text:row.text_body,html:row.html_body,
    replyTo:avsenderEpost(env),idempotencyKey:row.request_id});
  if (!sent.ok || !sent.id) {
    // 4xx, timeout, lost acknowledgement and 2xx-without-ID may be ambiguous.
    // No automatic retry even after Resend's 24h idempotency window expires.
    await db.prepare("UPDATE ops_offer_outbox SET status='REVIEW',last_error=?,updated_at=? WHERE offer_id=? AND status='SENDING'")
      .bind((sent.error||'RESEND_ACK_WITHOUT_ID').slice(0,200),Date.now(),row.offer_id).run();
    return {ok:false,status:'REVIEW',requiresReview:true,error:'UTSENDING_KREVER_AVSTEMMING'};
  }
  await completeSend(env,row,actor,sent.id);
  return {ok:true,status:'SENT',providerMessageId:sent.id};
}

/** Read-only verification against Resend, never a second send request. */
export async function reconcileOfferSend(env:Env,offerId:string,actor:string,providerId:string):Promise<Result>{
  const db=env.FINNBILGLASS_DB;
  if(!/^[A-Za-z0-9_-]{5,200}$/.test(providerId))return {ok:false,status:'REJECTED',error:'UGYLDIG_PROVIDER_ID'};
  const row=await db.prepare('SELECT * FROM ops_offer_outbox WHERE offer_id=?').bind(offerId).first<OutboxRow>();
  if(!row)return {ok:false,status:'NOT_FOUND',error:'UTSENDING_IKKE_FUNNET'};
  if(row.status==='SENT')return {ok:true,status:'SENT',alreadySent:true,providerMessageId:row.provider_message_id||undefined};
  if(row.status==='QUEUED')return {ok:false,status:'QUEUED',error:'IKKE_SENDT_ENDA'};
  if(!env.RESEND_API_KEY)return {ok:false,status:row.status,requiresReview:true,error:'RESEND_API_KEY_MANGLER'};
  let response:Response;
  try{response=await fetch('https://api.resend.com/emails/'+encodeURIComponent(providerId),{
    headers:{Authorization:'Bearer '+env.RESEND_API_KEY}})}
  catch{return {ok:false,status:row.status,requiresReview:true,error:'RESEND_VERIFISERING_FEILET'}};
  if(!response.ok)return {ok:false,status:row.status,requiresReview:true,error:'RESEND_MELDING_IKKE_VERIFISERT'};
  const detail=await response.json() as {id?:string;to?:string|string[];subject?:string};
  const recipients=Array.isArray(detail.to)?detail.to:[detail.to];
  if(detail.id!==providerId || detail.subject!==row.subject || !recipients.includes(row.recipient))
    return {ok:false,status:row.status,requiresReview:true,error:'RESEND_MELDING_STEMMER_IKKE'};
  await completeSend(env,row,actor,providerId);
  return {ok:true,status:'SENT',providerMessageId:providerId};
}
