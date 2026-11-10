export const SALES = ['NEW','CHECKING','WAITING_CUSTOMER','WAITING_SUPPLIER','OFFER_SENT','ACCEPTED','LOST','CLOSED'] as const;
export const PAYMENTS = ['NOT_AGREED','WAITING','PAID','REFUNDED'] as const;
export const DELIVERIES = ['NOT_ORDERED','ORDERED','SENT','DELIVERED','ISSUE'] as const;
export const EQUIPMENT_NOTE = 'Glasset og bilens utstyr kontrolleres manuelt før tilbud. Sensorer og kamera følger bare med når det er uttrykkelig oppgitt.';
export const TEMPLATES = {
 equipment:'Hei! For å kontrollere riktig glass trenger vi opplysninger om bilens utstyr. Har bilen oppvarmet frontrute eller head-up-display (informasjon projisert i frontruten)? Svar gjerne på denne e-posten. Et bilde av merkingen i glasset kan også hjelpe.',
 delivery:'Hei! Hvilken adresse ønsker du glasset levert til? Oppgi gjerne om det er en bedriftsadresse. Vi avklarer fraktpris og levering med leverandøren før vi sender tilbud.',
 supplier:'Hei! Vi undersøker riktig glassvariant, tilgjengelighet og levering hos leverandøren. Vi følger opp når opplysningene er avklart. Ingen bestilling er gjennomført.',
 followup:'Hei! Har du spørsmål til tilbudet vårt? Du kan svare på denne e-posten, så hjelper vi deg videre.',
};
export function text(v: unknown, max=500): string { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
export function requestId(v: unknown): string { const id=text(v,90); if(!/^[a-zA-Z0-9_-]{8,90}$/.test(id)) throw new Error('Ugyldig forespørselsnøkkel. Last siden på nytt.'); return id; }
export function priceLines(raw: unknown) {
 if(!Array.isArray(raw)||!raw.length||raw.length>30) throw new Error('Legg inn 1–30 tilbudslinjer.');
 const lines=raw.map((r: Record<string,unknown>)=>{
  const description=text(r?.description,180); const quantity=r?.quantity;
  const price=String(r?.price??'').trim().replace(',','.');
  if(!description||!Number.isInteger(quantity)||Number(quantity)<1||Number(quantity)>100||!/^\d{1,7}(\.\d{1,2})?$/.test(price)) throw new Error('Kontroller beskrivelse, antall og pris på hver linje.');
  const [whole,fraction='']=price.split('.'); const unitOre=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  const totalOre=unitOre*Number(quantity);const vatOre=Math.round(totalOre/5);
  return {description,quantity:Number(quantity),unitOre,totalOre,vatOre,netOre:totalOre-vatOre};
 });
 const totalOre=lines.reduce((s,l)=>s+l.totalOre,0);if(totalOre<=0||totalOre>100000000) throw new Error('Tilbudets totalbeløp må være positivt og under 1 million kroner.');
 const vatOre=lines.reduce((s,l)=>s+l.vatOre,0);return {lines,totalOre,vatOre,netOre:totalOre-vatOre,currency:'NOK',vatRate:25};
}
export function deliveryStatus(current:string,event:string): string {
 const next:Record<string,string>={'email.sent':'SENT','email.delivered':'DELIVERED','email.delivery_delayed':'DELAYED','email.failed':'FAILED','email.bounced':'BOUNCED','email.suppressed':'SUPPRESSED'};
 if(['BOUNCED','SUPPRESSED','FAILED'].includes(current))return current;
 if(current==='DELIVERED'&&!['email.bounced','email.suppressed','email.failed'].includes(event))return current;
 return next[event]??current;
}
const enc=new TextEncoder();
function base64url(b:Uint8Array){return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function key(secret:string,usage:('sign'|'verify')[]){return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,usage);}
export async function tokenFor(id:string,secret:string|undefined){if(!secret||secret.length<32)throw new Error('Tilbudslenker er ikke konfigurert.');return id+'.'+base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret,['sign']),enc.encode(id))));}
export async function tokenValid(token:string,secret:string|undefined):Promise<string|null>{
 if(!secret||secret.length<32||token.length>200)return null;const [id,sig,...extra]=token.split('.');if(extra.length||!id||!sig||!/^[a-zA-Z0-9_-]+$/.test(id))return null;
 try{const bytes=Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return await crypto.subtle.verify('HMAC',await key(secret,['verify']),bytes,enc.encode(id))?id:null;}catch{return null;}
}
export async function verifyWebhook(raw:string,headers:Headers,secret:string|undefined,now=Date.now()):Promise<boolean>{
 if(!secret)return false;const id=headers.get('svix-id'),ts=headers.get('svix-timestamp'),sig=headers.get('svix-signature');
 if(!id||!ts||!sig||!/^\d+$/.test(ts)||Math.abs(now/1000-Number(ts))>300)return false;
 try{const rawKey=Uint8Array.from(atob(secret.replace(/^whsec_/,'')),c=>c.charCodeAt(0));const k=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const part of sig.split(' ')){if(!part.startsWith('v1,'))continue;const bytes=Uint8Array.from(atob(part.slice(3)),c=>c.charCodeAt(0));if(await crypto.subtle.verify('HMAC',k,bytes,enc.encode(`${id}.${ts}.${raw}`)))return true;}
 }catch{}return false;
}
export function esc(s:unknown):string{return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export function nok(ore:number){return (ore/100).toLocaleString('nb-NO',{minimumFractionDigits:2,maximumFractionDigits:2})+' kr';}
