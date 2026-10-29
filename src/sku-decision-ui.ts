/**
 * sku-decision-ui — intern operatørflate for SKU-godkjenning (Oppgave 3).
 *
 * Handlinger: godkjenn SKU (policy-gate) · be om bedre bilde · velg alternativ
 * SKU (eksplisitt operatørvalg) · avslå. Alle beslutninger append-only.
 * Flaten er aldri en fitment-autoritet alene: «godkjenn SKU» respekterer
 * approvalPolicy; «velg alternativ SKU» er et dokumentert menneskelig valg.
 */
export function skuDecisionUi(): Response {
  return new Response(`<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SKU-godkjenning — Finnbilglass ops</title><style>
body{font:15px system-ui;background:#f4f7fb;color:#10243a;margin:0}.shell{max-width:1100px;margin:auto;padding:26px}h1{font-size:24px}.guard{border-left:4px solid #b45309;background:#fff7ed;padding:10px 14px;margin:14px 0}.card{background:#fff;border:1px solid #dbe4ee;border-radius:10px;padding:16px;margin:14px 0}button{font:inherit;padding:8px 12px;border-radius:7px;border:0;background:#10243a;color:#fff;font-weight:700;cursor:pointer}button.sec{background:#e8eef5;color:#10243a}button:disabled{opacity:.45}select,input,textarea{font:inherit;padding:8px;border:1px solid #dbe4ee;border-radius:7px;width:100%;box-sizing:border-box;margin:4px 0}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.muted{color:#637286}.pill{display:inline-block;padding:3px 8px;border-radius:99px;background:#e8eef5;font-size:12px;font-weight:700}.pill.new{background:#fee2e2;color:#991b1b}.pill.ok{background:#dcfce7;color:#166534}.err{color:#b91c1c;background:#fef2f2;padding:8px;border-radius:7px;margin:6px 0}.okmsg{color:#166534;background:#f0fdf4;padding:8px;border-radius:7px;margin:6px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eef2f7;font-size:14px}
</style><main class="shell"><h1>SKU-godkjenning</h1><p class="guard">Automatisk godkjenning skjer KUN ved én kandidat + verifisert regel + ingen attributkonflikt. Alt annet krever menneskelig valg — logget append-only med ansvarlig.</p><div class="row"><input id="token" type="password" placeholder="Support-token" style="max-width:260px"><button id="load">Last saker</button></div><div id="out"></div></main><script>
const q=s=>document.querySelector(s),H=()=>({Authorization:'Bearer '+q('#token').value,'Content-Type':'application/json'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrsTxt=k=>{const a=k.attributter||{};return Object.entries(a).filter(([,v])=>typeof v==='boolean').map(([n,v])=>(v?'✓ ':'✗ ')+n).join(' ')||'ingen kjente attributter'};
async function load(){const r=await fetch('/api/ops/sku-cases',{headers:H()});if(!r.ok){q('#out').innerHTML='<p class="err">Ingen tilgang.</p>';return}
const d=await r.json();q('#out').innerHTML=d.cases.length?d.cases.map(c=>'<div class="card" data-id="'+c.id+'"><div class="row"><b>Sak #'+c.id+'</b> '+(c.regnr?'· '+esc(c.regnr):'')+' '+pill(c.status)+' <span class="muted">'+new Date(c.createdAt).toLocaleString('nb-NO')+'</span></div>'+(c.sisteBeslutning?'<p class="muted">Siste: '+esc(c.sisteBeslutning.decision_type)+' — '+esc(c.sisteBeslutning.sku||'')+' ('+esc(c.sisteBeslutning.created_by)+', '+new Date(c.sisteBeslutning.created_at).toLocaleString('nb-NO')+')</p>':'')+
'<table><tr><th>Varenr</th><th>Eurokode</th><th>Pris</th><th>Attributter</th></tr>'+c.kandidater.map(k=>'<tr><td>'+esc(k.varenr)+'</td><td>'+esc(k.eurokode||'')+'</td><td>'+(k.pris??'—')+'</td><td class="muted">'+esc(attrsTxt(k))+'</td></tr>').join('')+'</table>'+
'<div class="row" style="margin-top:10px"><select class="sku-valg" style="max-width:260px"><option value="">Velg SKU…</option>'+c.kandidater.map(k=>'<option value="'+esc(k.varenr)+'" data-euro="'+esc(k.eurokode||'')+'">'+esc(k.varenr)+(k.eurokode?' ('+esc(k.eurokode)+')':'')+'</option>').join('')+'</select>'+
(c.kandidater.length===1?'<button class="sec" data-decision="approve_sku">Godkjenn SKU</button>':'')+
'<button class="sec" data-decision="choose_alternative_sku">Velg alternativ SKU</button>'+
'<button class="sec" data-decision="request_better_image">Be om bedre bilde</button>'+
'<button class="sec" data-decision="reject">Avslå</button></div>'+
'<input class="aktor" placeholder="Ansvarlig (f.eks. Tom)" value="Tom" style="max-width:220px"><input class="grunn" placeholder="Kort begrunnelse" style="max-width:340px"><div class="resultat"></div></div>').join(''):'<p class="muted">Ingen saker med kundereise-snapshot.</p>';}
const pill=s=>'<span class="pill'+(s==='NEW'?' new':(s==='CONFIRMED'?' ok':''))+'">'+esc(s)+'</span>';
async function beslut(id,type){const card=q('[data-id="'+id+'"]'),sel=card.querySelector('.sku-valg'),sku=sel.value,opt=sel.selectedOptions[0],euro=opt?opt.dataset.euro:null,actor=card.querySelector('.aktor').value.trim(),reason=card.querySelector('.grunn').value.trim(),out=card.querySelector('.resultat');
if(!actor||!reason){out.innerHTML='<p class="err">Ansvarlig og begrunnelse er påkrevd.</p>';return}
if((type==='approve_sku'||type==='choose_alternative_sku')&&!sku){out.innerHTML='<p class="err">Velg en SKU fra listen.</p>';return}
const body={inquiry_id:id,decision:type,sku:sku||null,eurocode:euro||null,actor,reason};const r=await fetch('/api/ops/decision',{method:'POST',headers:H(),body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));
if(r.ok){out.innerHTML='<p class="okmsg">✅ '+esc(d.status||'ok')+(d.overrideId?' — override #'+d.overrideId:'')+'</p>';load()}else{out.innerHTML='<p class="err">'+esc(d.error||'Feil')+(d.status==='needs_verification'?' <b>(needs_verification)</b>':'')+'</p>'}}
q('#out').addEventListener('click',function(e){const button=e.target.closest('[data-decision]');if(!button)return;const card=button.closest('[data-id]');if(card)beslut(Number(card.dataset.id),button.dataset.decision)});
q('#load').onclick=load;</script></main>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
