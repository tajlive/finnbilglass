// Local-only synthetic browser fixture. Never deploy; no mail or supplier requests leave this process.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {localD1} from './lib/local-d1.mjs';
import {workbenchApi,publicOffer,workbenchHtml} from '../src/ops-workbench/api.ts';
const db=localD1(':memory:',{readOnly:false});
db.exec(`CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,navn TEXT,kontakt TEXT,regnr TEXT,melding TEXT,status TEXT,is_test INTEGER,created_at TEXT,vehicle_json TEXT);CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER,event_type TEXT,note TEXT,created_at INTEGER);CREATE TABLE glass_prisliste(variant_id TEXT PRIMARY KEY,varenr TEXT,varenavn TEXT,eurokode TEXT,rad_type TEXT,pris REAL);INSERT INTO beta_inquiries VALUES(1,'Demokunde A','demo-a@example.invalid','TEST001','Syntetisk test av frontrute. Ingen kundebestilling.','NEW',0,'2026-11-05','{}');INSERT INTO beta_inquiries VALUES(2,'Demokunde B','demo-b@example.invalid','TEST002','Syntetisk leveringsavklaring.','NEW',0,'2026-11-05','{}');INSERT INTO glass_prisliste VALUES('5508AGAC:5508AGACHMVZ1L','5508AGAC','MERCEDES GLE COUPE W167 20- WS','5508AGACHMVZ1L','glass',14390);`);
db.exec(readFileSync('migrations/pending/0051_ops_workbench.sql','utf8'));db.exec(readFileSync('migrations/pending/0052_ops_customer_handoff.sql','utf8'));
const env={ENVIRONMENT:'local',FINNBILGLASS_DB:db,OPS_LINK_SECRET:crypto.randomUUID()+crypto.randomUUID(),RESEND_API_KEY:'local-simulation-only',OPS_PUBLIC_ORIGIN:'http://localhost:8789'};
let lastMail=null,mailCount=0;
globalThis.fetch=async(url,init)=>{if(!String(url).startsWith('https://api.resend.com/emails'))throw new Error('External network is disabled in local demo');lastMail=JSON.parse(init.body);mailCount++;return Response.json({id:'local-provider-'+mailCount});};
createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const path=new URL(req.url,'http://localhost:8789').pathname;const request=new Request('http://localhost:8789'+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});let response;
 if(path==='/local-test/last-email')response=Response.json({mailCount,lastMail});
 else if(path.startsWith('/api/ops/workbench/'))response=await workbenchApi(request,env,'lokal-demobruker');
 else if(path.startsWith('/api/tilbud/'))response=await publicOffer(request,env,path.slice('/api/tilbud/'.length));
 else if(path.startsWith('/tilbud/'))response=await publicOffer(request,env,path.slice('/tilbud/'.length));
 else if(/^\/ops-(?:workbench|offer)\.(?:js|css)$/.test(path))response=new Response(readFileSync('public'+path),{headers:{'Content-Type':path.endsWith('.js')?'application/javascript':'text/css'}});
 else response=workbenchHtml();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500,{'Content-Type':'text/plain'});res.end(String(e));}}).listen(8789,'127.0.0.1',()=>console.log('Synthetic local workspace: http://localhost:8789/ops/workbench (no external mail)'));
