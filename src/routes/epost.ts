/** Read-only, case-scoped email history for Operations Center. */
import type { Env } from '../types';
import { syncDb } from '../ops-workbench/mail-sync';

type Row = Record<string, unknown>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

export async function getEpostHistorikk(env:Env,inquiryId:number):Promise<Response>{
  const db=syncDb(env);
  const inquiry=await db.prepare('SELECT id FROM beta_inquiries WHERE id=?').bind(inquiryId).first();
  if(!inquiry)return json({ok:false,error:'SAK_IKKE_FUNNET'},404);
  try{
    const [activity,messages]=await Promise.all([
      db.prepare("SELECT event_id,event_type,note,created_at,created_by,meta_json FROM beta_inquiry_events WHERE inquiry_id=? AND event_type IN ('reply','status','note') ORDER BY created_at DESC LIMIT 100").bind(inquiryId).all<Row>(),
      db.prepare("SELECT id,direction,recipient,subject,body,status,provider_id,actor,created_at FROM ops_messages WHERE inquiry_id=? AND status<>'DRAFT' ORDER BY created_at DESC LIMIT 100").bind(inquiryId).all<Row>(),
    ]);
    const providerIds=new Set((messages.results||[]).map(row=>String(row.provider_id||'')).filter(Boolean));
    const legacy=(activity.results||[]).flatMap(row=>{
      let meta:Record<string,unknown>|null=null;
      try{if(row.meta_json)meta=JSON.parse(String(row.meta_json))}catch{}
      if(meta?.provider_message_id&&providerIds.has(String(meta.provider_message_id)))return[];
      return[{id:String(row.event_id),tid:Number(row.created_at),type:row.event_type,fra:row.created_by,innhold:row.note,meta}];
    });
    const synced=(messages.results||[]).map(row=>({
      id:String(row.id),tid:Number(row.created_at),type:row.direction==='IN'?'incoming':'sent',
      fra:row.direction==='IN'?'kunde':row.actor||'ansatt',innhold:row.body,
      meta:{direction:row.direction,status:row.status,subject:row.subject,recipient:row.recipient,providerId:row.provider_id},
    }));
    return json({ok:true,historikk:[...legacy,...synced].sort((a,b)=>b.tid-a.tid)});
  }catch{return json({ok:false,error:'EPOSTMIGRASJON_MANGLER'},503)}
}
