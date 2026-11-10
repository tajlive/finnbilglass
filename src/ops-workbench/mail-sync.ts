import type {Env} from '../types';
import {text,deliveryStatus,verifyWebhook} from './domain';
type Row=Record<string,any>;
export function syncDb(env:Env):D1Database {
 // Mail history, inquiry, manual offers and orders must share the same D1.
 return env.FINNBILGLASS_DB;
}
export async function verifyResendWebhook(env:Env, rawBody:string, headers:Headers):Promise<boolean> {
  if(!env.RESEND_WEBHOOK_SECRET) return false;
  return verifyWebhook(rawBody, headers, env.RESEND_WEBHOOK_SECRET);
}
export function mailAddress(value:unknown):string {
 const raw=String(value??'');const found=[...new Set((raw.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?/gi)||[]).map(x=>x.toLowerCase()))];return found.length===1?found[0]:'';
}
function addresses(value:unknown):string[]{return (Array.isArray(value)?value:[value]).filter(v=>typeof v==='string').map(mailAddress);}
function plainHtml(value:unknown):string {return String(value??'').slice(0,200000).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\s*(?:br\s*\/?|\/p|\/div|\/li)\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,x)=>(({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[x]??'')).trim().slice(0,30000);}
function headersOf(value:unknown):Record<string,string> {const h:Record<string,string>={};if(Array.isArray(value)){for(const row of value){if(row&&typeof row.name==='string')h[row.name.toLowerCase()]=text(row.value,4000);}}else if(value&&typeof value==='object'){for(const[k,v]of Object.entries(value))if(typeof v==='string')h[k.toLowerCase()]=v.slice(0,4000);}return h;}
async function syncState(db:D1Database,channel:string,error:string|null){await db.prepare(`INSERT INTO ops_mail_sync_state(channel,last_success,last_error,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET last_success=CASE WHEN excluded.last_error IS NULL THEN excluded.last_success ELSE ops_mail_sync_state.last_success END,last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(channel,error?null:Date.now(),error,Date.now()).run();}
export async function mailSyncStatus(env:Env){const db=syncDb(env);const rows=await db.prepare('SELECT * FROM ops_mail_sync_state').all<Row>();const inbound=(rows.results??[]).find(r=>r.channel==='incoming');return {configured:!!env.OPS_INBOUND_ADDRESS,receivingAddress:env.OPS_INBOUND_ADDRESS||null,lastSuccess:inbound?.last_success??null,error:inbound?.last_error??null};}
async function provider(env:Env,path:string){if(!env.RESEND_API_KEY)throw Error('Resend-tilgang mangler.');const r=await fetch('https://api.resend.com'+path,{headers:{Authorization:'Bearer '+env.RESEND_API_KEY},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('E-postleverandøren svarte '+r.status+'. Meldingen er ikke tapt; mottak må prøves på nytt.');const max=3*1024*1024;if(Number(r.headers.get('Content-Length'))>max)throw Error('Meldingen er for stor for automatisk import. Åpne supportpostkassen.');
 const reader=r.body?.getReader();if(!reader)throw Error('Tomt svar fra e-postleverandøren.');let length=0;const chunks:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw Error('Meldingen er for stor for automatisk import. Åpne supportpostkassen.');}chunks.push(value);}const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(all)) as Row;}
export async function checkMailProvider(env:Env){await provider(env,'/emails/receiving?limit=1');return {ok:true};}
export async function applyMailEvent(db:D1Database,event:Row){
 const supported=['email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.suppressed'];
 if(!supported.includes(event.event_type)){await db.prepare('UPDATE ops_mail_events SET processed=1 WHERE id=?').bind(event.id).run();return;}
 const next=deliveryStatus('SENT',event.event_type);
 const r=await db.prepare(`UPDATE ops_messages SET status=CASE WHEN status IN ('BOUNCED','SUPPRESSED','FAILED') THEN status WHEN status='DELIVERED' AND ? NOT IN ('BOUNCED','SUPPRESSED','FAILED') THEN status ELSE ? END,updated_at=? WHERE provider_id=?`).bind(next,next,Date.now(),event.provider_id).run();
 if(r.meta.changes===1)await db.prepare('UPDATE ops_mail_events SET processed=1 WHERE id=?').bind(event.id).run();
}
export async function syncIncoming(env:Env,providerId:string,deliveredTo:unknown){
 const expected=mailAddress(env.OPS_INBOUND_ADDRESS);const allowed=[expected,mailAddress(env.SUPPORT_EPOST||'support@finnbilglass.no')];
 if(!expected||!addresses(deliveredTo).some(a=>allowed.includes(a)))return {ignored:true};
 const db=syncDb(env);const existing=await db.prepare('SELECT id FROM ops_messages WHERE provider_id=?').bind(providerId).first();
 if(existing)return {ok:true,duplicate:true};
 try{
 const incoming=await provider(env,'/emails/receiving/'+encodeURIComponent(providerId)+'?html_format=cid');
 const sender=mailAddress(incoming.from),subject=text(incoming.subject,250),headers=headersOf(incoming.headers);
 const refs=[...subject.matchAll(/\[FBG-(\d+)\]|\bsak\s*#?\s*(\d+)\b/gi)].map(m=>Number(m[1]||m[2]));
 const unique=[...new Set(refs)];let caseId=unique.length===1?unique[0]:null;
 if(!caseId&&!unique.length&&headers['in-reply-to']){
 const matches=await db.prepare('SELECT DISTINCT m.inquiry_id FROM ops_mail_details d JOIN ops_messages m ON m.provider_id=d.provider_id WHERE d.rfc_message_id=? AND m.inquiry_id IS NOT NULL').bind(headers['in-reply-to'].trim()).all<Row>();
 if(matches.results?.length===1)caseId=matches.results[0].inquiry_id;
 }
 const c=caseId?await db.prepare('SELECT id,kontakt FROM beta_inquiries WHERE id=?').bind(caseId).first<Row>():null;
 const authFailed=incoming.authentication?.dmarc==='fail'||(incoming.authentication?.spf==='fail'&&incoming.authentication?.dkim==='fail')||/\bdmarc\s*=\s*fail\b/i.test(headers['authentication-results']||'');
 const linked=!authFailed&&sender&&c&&mailAddress(c.kontakt)===sender?c.id:null;
 const attachments=(Array.isArray(incoming.attachments)?incoming.attachments:[]).slice(0,40).map((a:Row)=>({id:text(a.id,150),filename:text(a.filename,250),contentType:text(a.content_type,100),size:Number.isFinite(a.size)?a.size:null})).filter((a:Row)=>a.id);
 const now=Date.now();
 await db.batch([
 db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at) VALUES(?,?,?,'IN',?,?,?,'RECEIVED',?,'kunde',?,?)`).bind('in-'+providerId,linked,'in-'+providerId,sender,subject,text(incoming.text,30000)||plainHtml(incoming.html)||'Meldingen har ikke lesbar tekst. Se vedlegg eller supportpostkassen.',providerId,now,now),
 db.prepare(`INSERT OR IGNORE INTO ops_mail_details(provider_id,source,rfc_message_id,headers_json,attachments_json) VALUES(?,'support-forward',?,?,?)`).bind(providerId,headers['message-id']||incoming.message_id||null,JSON.stringify(headers),JSON.stringify(attachments)),
 ]);
 if(linked)await db.prepare('INSERT OR IGNORE INTO ops_work_events(id,inquiry_id,kind,body,actor,created_at) VALUES(?,?,\'customer_reply\',?,\'kunde\',?)').bind('in-'+providerId,linked,JSON.stringify({providerId,subject,linkedBy:'avsender og saksreferanse; ikke innlogget identitet'}),now).run();
 await syncState(db,'incoming',null);return {ok:true,linkedCase:linked};
 }catch(e){await syncState(db,'incoming',e instanceof Error?e.message:'Ukjent mottaksfeil.');throw e;}
}
export interface CaseMailContext {inquiryId:number;key:string;kind:'receipt'|'reply'|'legacy-offer';actor?:string;}
export async function reserveCustomerMail(env:Env,mail:{to:string;subject:string;text:string},context:CaseMailContext){
 const db=syncDb(env);const id='tracked-'+context.key;
 const c=await db.prepare('SELECT id,kontakt FROM beta_inquiries WHERE id=?').bind(context.inquiryId).first<Row>();
 if(!c||!mailAddress(mail.to)||mailAddress(c.kontakt)!==mailAddress(mail.to))throw Error('Mottaker samsvarer ikke med saken.');
 const subject=/\[FBG-\d+\]/.test(mail.subject)?mail.subject:`[FBG-${context.inquiryId}] ${mail.subject}`;
 const now=Date.now();const r=await db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,actor,created_at,updated_at,send_reserved_at) VALUES(?,?,?,'OUT',?,?,?,'SENDING',?,?,?,?)`).bind(id,context.inquiryId,id,mail.to,subject,mail.text,context.actor||'system · '+context.kind,now,now,now).run();
 const row=await db.prepare('SELECT * FROM ops_messages WHERE id=?').bind(id).first<Row>();
 if(!r.meta.changes){if(row?.inquiry_id!==context.inquiryId||row?.recipient!==mail.to||row?.subject!==subject||row?.body!==mail.text)throw Error('Sendingsnøkkelen er allerede brukt med et annet innhold.');if(row?.provider_id&&['SENT','DELIVERED','DELAYED','BOUNCED','SUPPRESSED'].includes(row.status))return {id,subject,alreadySent:true,providerId:row.provider_id};throw Error('Sendestatus må avklares før meldingen sendes på nytt.');}
 const n=await db.prepare("SELECT COUNT(*) n FROM ops_messages WHERE direction='OUT' AND send_reserved_at>=? AND status<>'DRAFT'").bind(now-86400000).first<{n:number}>();
 if((n?.n??0)>50){await finishCustomerMail(env,id,context,{ok:false,error:'Panelets grense på 50 sendinger per døgn er nådd.'});throw Error('Panelets grense på 50 sendinger per døgn er nådd.');}
 return {id,subject,alreadySent:false};
}
export async function finishCustomerMail(env:Env,id:string,context:CaseMailContext,result:{ok:boolean;providerId?:string;error?:string}){
 const db=syncDb(env);const ok=result.ok&&!!result.providerId;
 await db.prepare('UPDATE ops_messages SET status=?,provider_id=?,error=?,updated_at=? WHERE id=? AND status=\'SENDING\'').bind(ok?'SENT':'FAILED',result.providerId||null,ok?null:text(result.error,500)||'Uavklart sendestatus.',Date.now(),id).run();
 if(ok){await db.prepare(`INSERT OR IGNORE INTO ops_mail_details(provider_id,source) VALUES(?,?)`).bind(result.providerId!,context.kind).run();const events=await db.prepare('SELECT * FROM ops_mail_events WHERE provider_id=? ORDER BY occurred_at').bind(result.providerId!).all<Row>();for(const event of events.results??[])await applyMailEvent(db,event);}
}
export async function attachmentDownload(env:Env,providerId:string,attachmentId:string):Promise<Response>{
 const db=syncDb(env);const detail=await db.prepare('SELECT * FROM ops_mail_details WHERE provider_id=?').bind(providerId).first<Row>();
 const attachment=detail&&JSON.parse(detail.attachments_json).find((a:Row)=>a.id===attachmentId);if(!attachment)return new Response('Vedlegget finnes ikke.',{status:404});
 const data=await provider(env,'/emails/receiving/'+encodeURIComponent(providerId)+'/attachments/'+encodeURIComponent(attachmentId));
 const url=new URL(data.download_url);if(url.protocol!=='https:'||!/(^|\.)(resend\.(com|dev)|amazonaws\.com|r2\.cloudflarestorage\.com)$/.test(url.hostname))throw Error('Uventet vedleggsadresse fra leverandøren.');
 const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok||r.status!==200)throw Error('Kunne ikke laste ned vedlegget.');
 const max=20*1024*1024;if(Number(r.headers.get('Content-Length'))>max)throw Error('Vedlegget er større enn 20 MB. Åpne supportpostkassen.');
 let size=0;const stream=r.body?.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;if(size>max)throw Error('Vedlegget er for stort.');controller.enqueue(chunk);}}));
 return new Response(stream,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(attachment.filename.replace(/[\r\n]/g,'')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
