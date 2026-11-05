import {produkttype} from '../glass-variant-kontroll';
import {estimertKundeprisInklMva} from '../pricing/nok-prising';
import type {Env} from '../types';
import {sendMail} from '../mail';
import {glassBodyRejection} from '../glass-body-compatibility';
import {SALES,PAYMENTS,DELIVERIES,TEMPLATES,text,requestId,priceLines,tokenFor,tokenValid,verifyWebhook,deliveryStatus,esc,nok} from './domain';
import {workbenchHtml,offerHtml} from './ui';
import {customerDetails,invoiceBasis} from './customer';
type Row=Record<string,any>;
const email=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function workDb(env:Env){if(env.ENVIRONMENT==='staging'){if(!env.FINNBILGLASS_STAGING_AUTH)throw new Error('Staging-database mangler.');return env.FINNBILGLASS_STAGING_AUTH;}return env.FINNBILGLASS_DB;}
async function body(request:Request):Promise<Row>{const raw=await request.text();if(raw.length>50000)throw new Error('Innholdet er for stort.');const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw new Error('Ugyldig innhold.');return b;}
async function audit(db:D1Database,id:number,kind:string,value:unknown,actor:string,key=crypto.randomUUID()){await db.prepare('INSERT OR IGNORE INTO ops_work_events(id,inquiry_id,kind,body,actor,created_at) VALUES(?,?,?,?,?,?)').bind(key,id,kind,JSON.stringify(value),actor,Date.now()).run();}
function quoteView(q:Row){return {...q,snapshot:JSON.parse(q.snapshot_json),snapshot_json:undefined};}
function publicOrigin(env:Env){const u=new URL(env.OPS_PUBLIC_ORIGIN||'https://finnbilglass.no');if(u.protocol!=='https:'&&u.hostname!=='localhost')throw new Error('Ugyldig tilbudsdomene.');return u.origin;}
async function getCase(db:D1Database,id:number){const c=await db.prepare('SELECT * FROM beta_inquiries WHERE id=?').bind(id).first<Row>();if(!c)throw new Error('Saken finnes ikke.');return c;}
function offerText(q:Row,url:string){const s=JSON.parse(q.snapshot_json);return `Hei ${s.customer.name},\n\nHer er vårt kontrollerte tilbud, sak #${q.inquiry_id}, versjon ${q.version}.\n\n${s.lines.map((l:Row)=>`${l.description} · ${l.quantity} stk · ${nok(l.totalOre)} inkl. mva`).join('\n')}\n\nTotalt inkl. mva: ${nok(s.totalOre)}\nHerav mva: ${nok(s.vatOre)}\nLevering: ${s.delivery}\nLeveringsadresse: ${s.address}\nBetaling: ${s.paymentTerms}\nGyldig til: ${new Date(q.expires_at).toLocaleDateString('nb-NO')}\n\nSe tilbudet, still spørsmål eller godta: ${url}\n\nVi leverer glasset. Montering avtaler og betaler du selv hos verkstedet du velger.\n\nFinnbilglass · BLYT AS · org.nr. 929 003 292\nsupport@finnbilglass.no`;}
async function finalizeSent(db:D1Database,message:Row){
 if(message.offer_id){const q=await db.prepare('SELECT * FROM ops_offers WHERE id=?').bind(message.offer_id).first<Row>();if(q){await db.prepare("UPDATE ops_offers SET status='SENT',sent_at=? WHERE id=? AND status='DRAFT'").bind(Date.now(),q.id).run();await audit(db,q.inquiry_id,'offer_sent',{offerId:q.id,version:q.version},message.actor,'sent-'+q.id);}}
 await audit(db,message.inquiry_id,'email_sent',{messageId:message.id,providerId:message.provider_id},message.actor,'email-'+message.id);
}
async function dispatch(env:Env,db:D1Database,message:Row){
 if(message.status!=='DRAFT'){if(message.provider_id&&['SENT','DELIVERED','DELAYED'].includes(message.status))await finalizeSent(db,message);return {message,alreadyProcessed:true};}
 const reserved=await db.prepare("UPDATE ops_messages SET status='SENDING',updated_at=?,send_reserved_at=? WHERE id=? AND status='DRAFT'").bind(Date.now(),Date.now(),message.id).run();
 if(reserved.meta.changes!==1)return {message,alreadyProcessed:true};
 message=(await db.prepare('SELECT * FROM ops_messages WHERE id=?').bind(message.id).first<Row>())!;
 // A local ceiling leaves room for login codes and legacy receipts in the Free plan.
 const n=await db.prepare("SELECT COUNT(*) n FROM ops_messages WHERE direction='OUT' AND send_reserved_at>=? AND status <> 'DRAFT'").bind(Date.now()-86400000).first<{n:number}>();
 if((n?.n??0)>50){await db.prepare("UPDATE ops_messages SET status='FAILED',error=?,updated_at=? WHERE id=?").bind('Panelets grense på 50 sendinger per 24 timer er nådd. Ingen automatisk oppgradering.',Date.now(),message.id).run();return {error:'Gratisgrensen for panelet er nådd.',sent:false};}
 const result=await sendMail(env,{to:message.recipient,subject:message.subject,text:message.body,html:'<div style="white-space:pre-wrap">'+esc(message.body)+'</div>',replyTo:env.SUPPORT_EPOST||'support@finnbilglass.no',idempotencyKey:'ops-'+message.id});
 if(!result.ok||!result.providerId){await db.prepare("UPDATE ops_messages SET status='FAILED',error=?,updated_at=? WHERE id=?").bind(result.error||'Sendestatus må avklares hos e-postleverandøren før nytt forsøk.',Date.now(),message.id).run();return {sent:false,error:result.error||'Uavklart e-poststatus.'};}
 await db.prepare("UPDATE ops_messages SET status='SENT',provider_id=?,updated_at=? WHERE id=? AND status='SENDING'").bind(result.providerId,Date.now(),message.id).run();
 // Reconcile events that arrived before the provider id was persisted.
 const events=await db.prepare('SELECT * FROM ops_mail_events WHERE provider_id=? ORDER BY occurred_at').bind(result.providerId).all<Row>();
 for(const event of events.results??[])await applyEvent(db,event);
 await finalizeSent(db,{...message,provider_id:result.providerId});
 return {sent:true,messageId:message.id};
}
export async function workbenchApi(request:Request,env:Env,actor:string):Promise<Response>{
 const u=new URL(request.url);const path=u.pathname.replace('/api/ops/workbench','');const db=workDb(env);
 if(request.method!=='GET'&&request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin)return out({error:'Ugyldig avsender.'},403);
 try{
 if(path==='/catalogue'&&request.method==='GET'){
 const term=text(u.searchParams.get('q'),60);if(term.length<2)return out({ok:true,products:[]});
 const like='%'+term.replace(/[%_]/g,'')+'%';
 const rows=await env.FINNBILGLASS_DB.prepare("SELECT variant_id,varenr,varenavn,eurokode,pris FROM glass_prisliste WHERE rad_type='glass' AND (varenr=? OR eurokode=? OR varenavn LIKE ? OR varenr LIKE ? OR eurokode LIKE ?) ORDER BY varenr LIMIT 30").bind(term,term,like,like,like).all<Row>();
 return out({ok:true,products:(rows.results??[]).filter(r=>produkttype(r.varenavn,r.varenr)==='glass').map(r=>({...r,estimate:estimertKundeprisInklMva(r.pris)}))});
 }
 if(path==='/cases'&&request.method==='GET'){
 const rows=await db.prepare(`SELECT i.id,i.regnr,i.navn,i.kontakt,i.status,i.is_test,i.created_at,
 w.version,w.assigned_to,w.next_action,w.due_at,
 CASE WHEN w.sales IN ('CLOSED','LOST') THEN w.sales
 WHEN EXISTS(SELECT 1 FROM ops_offers q WHERE q.inquiry_id=i.id AND q.status='ACCEPTED') THEN 'ACCEPTED'
 WHEN EXISTS(SELECT 1 FROM ops_offers q WHERE q.inquiry_id=i.id AND q.status='SENT') AND COALESCE(w.sales,'NEW') IN ('NEW','CHECKING') THEN 'OFFER_SENT'
 ELSE w.sales END sales,w.payment,w.delivery,
 (SELECT count(*) FROM ops_messages m WHERE m.inquiry_id=i.id AND m.status IN ('FAILED','BOUNCED','SUPPRESSED') AND COALESCE(m.send_reserved_at,m.created_at)>COALESCE((SELECT MAX(COALESCE(s.send_reserved_at,s.created_at)) FROM ops_messages s WHERE s.inquiry_id=i.id AND s.direction='OUT' AND s.status IN ('SENT','DELIVERED')),0)) mail_errors,
 (SELECT max(created_at) FROM ops_messages m WHERE m.inquiry_id=i.id AND m.direction='IN') last_incoming,
 (SELECT max(COALESCE(send_reserved_at,created_at)) FROM ops_messages m WHERE m.inquiry_id=i.id AND m.direction='OUT' AND m.status IN ('SENT','DELIVERED')) last_reply
 FROM beta_inquiries i LEFT JOIN ops_work_state w ON w.inquiry_id=i.id ORDER BY i.id DESC LIMIT 500`).all<Row>();
 return out({ok:true,cases:rows.results??[],templates:TEMPLATES,environment:env.ENVIRONMENT,limits:{emailsPer24Hours:50,providerDailyLimit:100,providerMonthlyLimit:3000},invoice:'Avventer programvalg'});
 }
 const match=/^\/cases\/(\d+)(?:\/(state|messages|offers|customer|export)(?:\/([a-f0-9-]+))?)?$/.exec(path);
 if(match){const id=Number(match[1]),action=match[2];const c=await getCase(db,id);
 if(action==='customer'&&request.method==='POST'){
 const b=await body(request);if(!Number.isInteger(b.version)||b.version<0)throw new Error('Last kundeopplysningene på nytt.');
 const data=customerDetails(b);const now=Date.now();
 await db.prepare("INSERT OR IGNORE INTO ops_case_customer(inquiry_id,version,details_json,updated_at,updated_by) VALUES(?,0,'{}',?,?)").bind(id,now,actor).run();
 const result=await db.prepare('UPDATE ops_case_customer SET version=version+1,details_json=?,updated_at=?,updated_by=? WHERE inquiry_id=? AND version=?').bind(JSON.stringify(data),now,actor,id,b.version).run();
 if(result.meta.changes!==1)return out({error:'Kundeopplysningene er endret i en annen fane. Last saken på nytt.'},409);
 await audit(db,id,'customer_updated',{fields:Object.keys(data)},actor);return out({ok:true});
 }
 if(action==='export'&&request.method==='GET'){
 const customer=await db.prepare('SELECT * FROM ops_case_customer WHERE inquiry_id=?').bind(id).first<Row>();
 const q=await db.prepare("SELECT * FROM ops_offers WHERE inquiry_id=? AND status='ACCEPTED'").bind(id).first<Row>();
 const state=await db.prepare('SELECT * FROM ops_work_state WHERE inquiry_id=?').bind(id).first<Row>();
 const data=invoiceBasis(c,customer?{...JSON.parse(customer.details_json),version:customer.version}:{name:c.navn,email:email(c.kontakt||'')?c.kontakt:'',buyerType:'person',country:'NO'},q,state);
 return new Response(JSON.stringify(data,null,2),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="FBG-${id}-fakturagrunnlag.json"`}});
 }
 if(!action&&request.method==='GET'){
 const customer=await db.prepare('SELECT * FROM ops_case_customer WHERE inquiry_id=?').bind(id).first<Row>();
 const [state,events,messages,offers,legacy,legacyEvents]=await Promise.all([
 db.prepare('SELECT * FROM ops_work_state WHERE inquiry_id=?').bind(id).first<Row>(),
 db.prepare('SELECT * FROM ops_work_events WHERE inquiry_id=? ORDER BY created_at').bind(id).all<Row>(),
 db.prepare('SELECT * FROM ops_messages WHERE inquiry_id=? ORDER BY created_at').bind(id).all<Row>(),
 db.prepare('SELECT * FROM ops_offers WHERE inquiry_id=? ORDER BY version DESC').bind(id).all<Row>(),
 db.prepare('SELECT * FROM glass_quotes WHERE inquiry_id=? ORDER BY versjon DESC').bind(id).all<Row>().catch(()=>({results:[]})),
 db.prepare('SELECT * FROM beta_inquiry_events WHERE inquiry_id=? ORDER BY created_at').bind(id).all<Row>()]);
 const flow=state??{version:0,sales:c.status==='NEW'?'NEW':['CLOSED','REJECTED'].includes(c.status)?'CLOSED':'CHECKING',payment:'NOT_AGREED',delivery:'NOT_ORDERED'};
 if(!['CLOSED','LOST'].includes(flow.sales)&&(offers.results??[]).some(q=>q.status==='ACCEPTED'))flow.sales='ACCEPTED';
 else if((offers.results??[]).some(q=>q.status==='SENT')&&['NEW','CHECKING'].includes(flow.sales))flow.sales='OFFER_SENT';
 return out({ok:true,inquiry:c,customer:customer?{...JSON.parse(customer.details_json),version:customer.version}:{version:0,name:c.navn,email:email(c.kontakt||'')?c.kontakt:'',buyerType:'person',country:'NO'},state:flow,events:events.results,messages:messages.results,offers:(offers.results??[]).map(quoteView),legacyOffers:legacy.results,legacyEvents:legacyEvents.results,templates:TEMPLATES});
 }
 if(action==='state'&&request.method==='POST'){
 const b=await body(request);if(!Number.isInteger(b.version)||b.version<0)throw new Error('Last saken på nytt.');
 if(!SALES.includes(b.sales)||!PAYMENTS.includes(b.payment)||!DELIVERIES.includes(b.delivery))throw new Error('Ugyldig status.');
 const due=b.dueAt?Date.parse(b.dueAt):null;if(due!==null&&!Number.isFinite(due))throw new Error('Ugyldig frist.');
 const tracking=text(b.trackingUrl,500);if(tracking&&(!/^https:\/\//.test(tracking)||new URL(tracking).username))throw new Error('Sporingslenken må starte med https://.');
 const reason=text(b.note,1000);if(!reason)throw new Error('Beskriv hva som er endret.');
 // Sales acceptance comes only from the frozen customer offer, not a dropdown.
 const accepted=await db.prepare("SELECT id FROM ops_offers WHERE inquiry_id=? AND status='ACCEPTED'").bind(id).first();
 if((b.sales==='ACCEPTED'||b.delivery!=='NOT_ORDERED')&&!accepted)throw new Error('Kundens tilbud må være akseptert før bestilling registreres.');
 const args=[text(b.assignedTo,120),text(b.nextAction,250),due,b.sales,b.payment,b.delivery,text(b.supplier,150),text(b.supplierRef,150),tracking,text(b.deliveryAddress,600),Date.now(),actor,id];
 await db.prepare('INSERT OR IGNORE INTO ops_work_state(inquiry_id,version,updated_at,updated_by) VALUES(?,0,?,?)').bind(id,Date.now(),actor).run();
 const r=await db.prepare(`UPDATE ops_work_state SET version=version+1,assigned_to=?,next_action=?,due_at=?,sales=?,payment=?,delivery=?,supplier=?,supplier_ref=?,tracking_url=?,delivery_address=?,updated_at=?,updated_by=? WHERE inquiry_id=? AND version=?`).bind(...args,b.version).run();
 if(r.meta.changes!==1)return out({error:'Saken er endret i en annen fane. Last den på nytt.'},409);
 await audit(db,id,'follow_up',{...b,actor:undefined},actor);return out({ok:true});
 }
 if(action==='messages'&&request.method==='POST'){
 const messageId=match[3];
 const b=await body(request);const key=requestId(b.requestId);const subject=text(b.subject,180),content=text(b.body,15000);
 if(!subject||!content)throw new Error('Fyll inn emne og melding.');if(!email(c.kontakt))throw new Error('Saken mangler en gyldig e-postadresse.');
 if(messageId){
 const existing=await db.prepare("SELECT * FROM ops_messages WHERE id=? AND inquiry_id=? AND direction='OUT' AND offer_id IS NULL").bind(messageId,id).first<Row>();
 if(!existing||existing.status!=='DRAFT'||existing.request_id!==key)return out({error:'Utkastet kan ikke endres. Last saken på nytt.'},409);
 const update=await db.prepare("UPDATE ops_messages SET subject=?,body=?,recipient=?,updated_at=? WHERE id=? AND status='DRAFT'").bind(`[FBG-${id}] ${subject}`,content,c.kontakt,Date.now(),messageId).run();
 if(update.meta.changes!==1)return out({error:'Meldingen behandles allerede.'},409);
 }
 await db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,actor,created_at,updated_at) VALUES(?,?,?,'OUT',?,?,?,'DRAFT',?,?,?)`).bind(crypto.randomUUID(),id,key,c.kontakt,`[FBG-${id}] ${subject}`,content,actor,Date.now(),Date.now()).run();
 const message=await db.prepare('SELECT * FROM ops_messages WHERE request_id=?').bind(key).first<Row>();
 if(!message||message.inquiry_id!==id||message.body!==content||message.subject!==`[FBG-${id}] ${subject}`)return out({error:'Forespørselsnøkkelen er brukt til en annen melding.'},409);
 if(!b.send)return out({ok:true,message});return out({ok:true,...await dispatch(env,db,message)});
 }
 if(action==='offers'&&request.method==='POST'){
 const workState=await db.prepare('SELECT sales FROM ops_work_state WHERE inquiry_id=?').bind(id).first<Row>();
 if(['CLOSED','REJECTED'].includes(c.status)||['CLOSED','LOST'].includes(workState?.sales))return out({error:'Saken er lukket. Avklar gjenåpning før nytt tilbud.'},409);
 const b=await body(request);const key=requestId(b.requestId);
 if(await db.prepare("SELECT id FROM ops_offers WHERE inquiry_id=? AND status='ACCEPTED'").bind(id).first())return out({error:'Saken har et akseptert tilbud. Endringer må avtales særskilt.'},409);
 const existing=await db.prepare('SELECT * FROM ops_offers WHERE request_id=?').bind(key).first<Row>();if(existing){if(existing.inquiry_id!==id)return out({error:'Nøkkelen er allerede brukt.'},409);
 const previous=JSON.parse(existing.snapshot_json);const proposed=priceLines(b.lines);
 const unchanged=JSON.stringify(previous.lines)===JSON.stringify(proposed.lines)&&previous.product.variant_id===text(b.variantId,100)&&previous.address===text(b.address,600)&&previous.delivery===text(b.delivery,250)&&previous.paymentTerms===text(b.paymentTerms,250)&&previous.basis===text(b.basis,1000)&&previous.equipment===text(b.equipment,1500)&&existing.expires_at===Date.parse(b.expiresAt)&&['fitmentChecked','priceChecked','freightChecked','deliveryChecked'].every(k=>b[k]===true);
 if(!unchanged)return out({error:'Tilbudet er allerede lagret med et annet innhold. Last saken på nytt og opprett en ny versjon.'},409);
 return out({ok:true,offer:quoteView(existing),replay:true});}
 if(['fitmentChecked','priceChecked','freightChecked','deliveryChecked'].some(k=>b[k]!==true))throw new Error('Bekreft glassvalg, pris, frakt og levering før tilbudet opprettes.');
 const basis=text(b.basis,1000),address=text(b.address,600),delivery=text(b.delivery,250),paymentTerms=text(b.paymentTerms,250);
 if(!basis||!address||!delivery||!paymentTerms)throw new Error('Fyll inn kontrollgrunnlag, leveringsadresse, leveringstid og betalingsvilkår.');
 const variantId=text(b.variantId,100);const product=await env.FINNBILGLASS_DB.prepare("SELECT variant_id,varenr,varenavn,eurokode,rad_type FROM glass_prisliste WHERE variant_id=?").bind(variantId).first<Row>();
 if(!product||product.rad_type!=='glass'||produkttype(product.varenavn,product.varenr)!=='glass')throw new Error('Velg en eksisterende glassvariant.');
 let bil:Row={};try{bil=JSON.parse(c.vehicle_json||'{}').bil||{};}catch{}
 if(bil.merke&&glassBodyRejection(bil as {merke:string;modell?:string},product.varenavn))throw new Error('Glasset motsier bilens karosseri. Kontroller varianten.');
 const pricing=priceLines(b.lines);const expires=Date.parse(b.expiresAt);if(!Number.isFinite(expires)||expires<Date.now()+60000||expires>Date.now()+90*86400000)throw new Error('Gyldighet må være mellom ett minutt og 90 dager frem i tid.');
 const prev=await db.prepare('SELECT COALESCE(MAX(version),0) v FROM ops_offers WHERE inquiry_id=?').bind(id).first<{v:number}>();
 const snapshot={...pricing,product,customer:{name:c.navn,email:c.kontakt,regnr:c.regnr},address,delivery,paymentTerms,basis,checkedBy:actor,seller:{name:'BLYT AS',orgnr:'929003292'},equipment:text(b.equipment,1500),installation:'Montering avtaler og betaler kunden selv.'};
 const qid=crypto.randomUUID();await db.prepare('INSERT INTO ops_offers(id,inquiry_id,version,request_id,snapshot_json,expires_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)').bind(qid,id,(prev?.v??0)+1,key,JSON.stringify(snapshot),expires,Date.now(),actor).run();
 await audit(db,id,'offer_draft',{offerId:qid,version:(prev?.v??0)+1,totalOre:pricing.totalOre},actor);const q=await db.prepare('SELECT * FROM ops_offers WHERE id=?').bind(qid).first<Row>();return out({ok:true,offer:quoteView(q!)},201);
 }
 }
 const preview=/^\/offers\/([a-f0-9-]+)\/preview$/.exec(path);
 if(preview&&request.method==='GET'){const q=await db.prepare('SELECT * FROM ops_offers WHERE id=?').bind(preview[1]).first<Row>();if(!q)return out({error:'Tilbudet finnes ikke.'},404);return offerHtml({...quoteView(q),status:'PREVIEW'},'',true);}
 const send=/^\/offers\/([a-f0-9-]+)\/send$/.exec(path);
 if(send&&request.method==='POST'){
 const q=await db.prepare('SELECT * FROM ops_offers WHERE id=?').bind(send[1]).first<Row>();if(!q)return out({error:'Tilbudet finnes ikke.'},404);
 const previouslySent=await db.prepare('SELECT * FROM ops_messages WHERE offer_id=? AND provider_id IS NOT NULL').bind(q.id).first<Row>();
 if(previouslySent&&['SENT','DELIVERED','DELAYED','BOUNCED','SUPPRESSED'].includes(previouslySent.status)){await finalizeSent(db,previouslySent);return out({ok:true,alreadyProcessed:true});}
 if(['ACCEPTED','WITHDRAWN'].includes(q.status)||q.expires_at<=Date.now())return out({error:'Tilbudet kan ikke sendes.'},409);
 if(await db.prepare("SELECT id FROM ops_offers WHERE inquiry_id=? AND (status='ACCEPTED' OR (version>? AND status='SENT'))").bind(q.inquiry_id,q.version).first())return out({error:'Tilbudet er erstattet eller saken er allerede akseptert.'},409);
 const c=await getCase(db,q.inquiry_id);if(!email(c.kontakt))throw new Error('Saken mangler gyldig e-postadresse.');
 if(c.kontakt!==JSON.parse(q.snapshot_json).customer.email)throw new Error('Kundens e-postadresse er endret. Opprett en ny tilbudsversjon.');
 const url=publicOrigin(env)+'/tilbud/'+await tokenFor(q.id,env.OPS_LINK_SECRET);const content=offerText(q,url);
 const mId='offer-'+q.id;await db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,offer_id,request_id,direction,recipient,subject,body,status,actor,created_at,updated_at) VALUES(?,?,?,?,'OUT',?,?,?,'DRAFT',?,?,?)`).bind(mId,q.inquiry_id,q.id,mId,c.kontakt,`[FBG-${q.inquiry_id}] Tilbud v${q.version}`,content,actor,Date.now(),Date.now()).run();
 const m=await db.prepare('SELECT * FROM ops_messages WHERE id=?').bind(mId).first<Row>();return out({ok:true,...await dispatch(env,db,m!)});
 }
 const link=/^\/unmatched\/([a-f0-9-]+)\/link$/.exec(path);
 if(link&&request.method==='POST'){
 const b=await body(request);if(!Number.isSafeInteger(b.inquiryId)||!text(b.reason,500)||b.confirm!==true)throw new Error('Velg sak, bekreft tilhørighet og skriv en begrunnelse.');
 await getCase(db,b.inquiryId);
 const r=await db.prepare("UPDATE ops_messages SET inquiry_id=?,updated_at=? WHERE id=? AND direction='IN' AND inquiry_id IS NULL").bind(b.inquiryId,Date.now(),link[1]).run();
 if(r.meta.changes!==1)return out({error:'Meldingen er allerede koblet eller finnes ikke.'},409);
 await audit(db,b.inquiryId,'customer_reply_linked',{messageId:link[1],reason:text(b.reason,500)},actor);return out({ok:true});
 }
 if(path==='/unmatched'&&request.method==='GET'){const rows=await db.prepare("SELECT id,recipient,subject,body,created_at FROM ops_messages WHERE direction='IN' AND inquiry_id IS NULL ORDER BY created_at DESC LIMIT 100").all();return out({ok:true,messages:rows.results});}
 return out({error:'Ikke funnet.'},404);
 }catch(e){const message=e instanceof Error?e.message:'';if(/UNIQUE constraint/.test(message))return out({error:'Saken ble endret samtidig. Last siden på nytt.'},409);if(/no such table/.test(message))return out({error:'Arbeidsflaten er ikke installert i dette miljøet ennå.'},503);return out({error:message||'Kunne ikke behandle forespørselen.'},400);}
}
export async function publicOffer(request:Request,env:Env,token:string):Promise<Response>{
 const db=workDb(env);const id=await tokenValid(token,env.OPS_LINK_SECRET);if(!id)return out({error:'Ugyldig tilbudslenke.'},404);
 const q=await db.prepare('SELECT * FROM ops_offers WHERE id=?').bind(id).first<Row>();if(!q||q.status==='DRAFT')return out({error:'Tilbudet er ikke tilgjengelig.'},404);
 if(request.method==='GET'){const newer=await db.prepare("SELECT id FROM ops_offers WHERE inquiry_id=? AND id<>? AND (status='ACCEPTED' OR (version>? AND status='SENT'))").bind(q.inquiry_id,q.id,q.version).first();return offerHtml({...quoteView(q),...(newer?{status:'WITHDRAWN'}:{})},token,env.ENVIRONMENT!=='production');}
 if(request.method!=='POST')return out({error:'Metode ikke tillatt.'},405);
 const b=await body(request);if(b.action!=='accept'||b.version!==q.version||b.confirm!==true)return out({error:'Bekreft at du godtar denne tilbudsversjonen.'},400);
 if(q.status==='ACCEPTED'){await audit(db,q.inquiry_id,'offer_accepted',{offerId:q.id,version:q.version,totalOre:JSON.parse(q.snapshot_json).totalOre},'kunde','accepted-'+q.id);return out({ok:true,accepted:true,alreadyAccepted:true});}
 if(q.expires_at<=Date.now()||q.status!=='SENT')return out({error:'Tilbudet er utløpt eller trukket tilbake. Be om et nytt tilbud.'},409);
 const result=await db.prepare(`UPDATE ops_offers SET status='ACCEPTED',accepted_at=? WHERE id=? AND status='SENT' AND expires_at>?
 AND NOT EXISTS(SELECT 1 FROM ops_offers x WHERE x.inquiry_id=ops_offers.inquiry_id AND (x.status='ACCEPTED' OR (x.version>ops_offers.version AND x.status='SENT')))`)
 .bind(Date.now(),q.id,Date.now()).run();
 if(result.meta.changes!==1)return out({error:'Tilbudet er erstattet eller allerede behandlet. Kontakt oss.'},409);
 await audit(db,q.inquiry_id,'offer_accepted',{offerId:q.id,version:q.version,totalOre:JSON.parse(q.snapshot_json).totalOre},'kunde','accepted-'+q.id);
 return out({ok:true,accepted:true});
}
async function applyEvent(db:D1Database,event:Row){
 const supported=['email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.suppressed'];
 if(!supported.includes(event.event_type)){await db.prepare('UPDATE ops_mail_events SET processed=1 WHERE id=?').bind(event.id).run();return;}
 const next=deliveryStatus('SENT',event.event_type);
 // Atomic transition: concurrent delivered/bounced events cannot lose the terminal bounce.
 const r=await db.prepare(`UPDATE ops_messages SET status=CASE
 WHEN status IN ('BOUNCED','SUPPRESSED','FAILED') THEN status
 WHEN status='DELIVERED' AND ? NOT IN ('BOUNCED','SUPPRESSED','FAILED') THEN status
 ELSE ? END,updated_at=? WHERE provider_id=?`).bind(next,next,Date.now(),event.provider_id).run();
 if(r.meta.changes===1)await db.prepare('UPDATE ops_mail_events SET processed=1 WHERE id=?').bind(event.id).run();
}

export async function resendWebhook(request:Request,env:Env):Promise<Response>{
 const raw=await request.text();if(raw.length>200000)return out({error:'For stor hendelse.'},413);
 if(!await verifyWebhook(raw,request.headers,env.RESEND_WEBHOOK_SECRET))return out({error:'Ugyldig signatur.'},401);
 const payload=JSON.parse(raw),eventId=request.headers.get('svix-id')!,providerId=payload.data?.email_id;
 if(typeof providerId!=='string')return out({ok:true,ignored:true});
 const db=workDb(env);await db.prepare('INSERT OR IGNORE INTO ops_mail_events(id,provider_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?,?)').bind(eventId,providerId,String(payload.type),Date.parse(payload.created_at)||Date.now(),raw).run();
 if(payload.type==='email.received'){
 if(!env.RESEND_API_KEY)return out({error:'Mottak er ikke konfigurert.'},503);
 const already=await db.prepare('SELECT id FROM ops_messages WHERE provider_id=?').bind(providerId).first();if(!already){
 const response=await fetch('https://api.resend.com/emails/receiving/'+encodeURIComponent(providerId),{headers:{Authorization:'Bearer '+env.RESEND_API_KEY}});if(!response.ok)return out({error:'Kunne ikke hente innkommende melding.'},503);
 const incoming=await response.json() as Row;const from=String(incoming.from??'');const sender=(/<([^>]+)>/.exec(from)?.[1]??from).trim().toLowerCase();const subject=text(incoming.subject,250);const caseId=Number(/\[FBG-(\d+)\]/.exec(subject)?.[1]);
 const c=caseId?await db.prepare('SELECT id,kontakt FROM beta_inquiries WHERE id=?').bind(caseId).first<Row>():null;
 const linked=c&&String(c.kontakt).trim().toLowerCase()===sender?c.id:null;
 await db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at) VALUES(?,?,?,'IN',?,?,?,'RECEIVED',?,?,?,?)`)
 .bind(crypto.randomUUID(),linked,'in-'+providerId,sender,subject,text(incoming.text,30000)||'Meldingen mangler ren tekst. Åpne den i supportpostkassen.',providerId,'kunde',Date.now(),Date.now()).run();
 if(linked)await audit(db,linked,'customer_reply',{providerId,subject},'kunde','in-'+providerId);
 }
 await db.prepare('UPDATE ops_mail_events SET processed=1 WHERE id=?').bind(eventId).run();
 }else await applyEvent(db,{id:eventId,provider_id:providerId,event_type:payload.type});
 return out({ok:true});
}
export {workbenchHtml};
