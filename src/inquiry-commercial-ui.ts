/** Internal Finnbilglass UI only. No script or credentials added to public storefront. */
export function commercialPanel(): string {
  return `<section id="commercial" class="view"><div class="card"><p class="eyebrow">Finnbilglass · Arch aXN</p><h2>Salg og oppfølging</h2><p>Forespørsel → tilbud → nettbetaling → levering. Finnbilglass selger glass og tilbehør; eventuell montering er en separat avtale mellom kunden og verkstedet.</p><p class="muted">Alle beløp ekskl. mva. Hele perioden; demo holdes utenfor økonomien. Veiledende glasspris på nettsiden er ikke bokført omsetning.</p><button id="commercial-refresh" class="secondary">Oppdater salgsoversikt</button><p id="commercial-message" role="status" aria-live="polite"></p><div id="commercial-metrics" class="grid"></div><div id="commercial-list"></div><p class="muted">Viser inntil 100 registrerte salgsutfall, sortert etter oppfølgingsdato. Økonomitallene dekker alle registrerte utfall. Åpne en eksisterende henvendelse under Saker for å registrere et nytt utfall.</p><div id="commercial-detail"></div></div></section>`;
}
export function commercialScript(): string {
  return String.raw`<script>
(() => {
 const el = id => document.getElementById(id);
 const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money = ore => new Intl.NumberFormat('nb-NO',{style:'currency',currency:'NOK'}).format((ore||0)/100);
 const stages={OPEN:'Åpen',BOOKED:'Ordre/levering avtalt',FULFILLED:'Glass levert',PAID:'Betalt',LOST:'Tapt'};
 const deliveries={UNKNOWN:'Ikke avklart',GLASS_ONLY:'Levering til kunden',PARTNER_INSTALL:'Levering til avtaleverksted'};
 const sources={WEB:'Nettsiden',PHONE:'Telefon',MANUAL:'Manuell',DEMO:'Demo / test'};
 function message(s){el('commercial-message').textContent=s;}
 async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+el('token').value,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Kunne ikke hente eller lagre salgsutfall.');return d;}
 async function refresh(){try{const d=await api('/api/ops/commercial');const t=d.totals||{};
 el('commercial-metrics').innerHTML=[['Betalte oppdrag',t.paid||0],['Registrert inntekt',money(t.revenueOre)],['Dekningsbidrag',money(t.contributionOre)],['Vurdert ekstra bidrag',money(t.incrementalOre)]].map(x=>'<article class="card"><span class="muted">'+x[0]+'</span><div class="metric">'+esc(x[1])+'</div></article>').join('');
 const today=new Date().toLocaleDateString('sv-SE');
 el('commercial-list').innerHTML=d.rows.length?d.rows.map(r=>'<div class="case"><div><b>'+esc(r.navn)+'</b> · '+esc(r.regnr||'')+'<br>'+esc(stages[r.stage])+' · '+esc(sources[r.source])+(r.follow_up?'<br>Følg opp '+esc(r.follow_up)+(r.follow_up<=today&&!['PAID','LOST'].includes(r.stage)?' · <b>Må følges opp</b>':''):'')+'</div><button class="secondary" data-commercial="'+r.inquiry_id+'">Åpne salgsutfall</button></div>').join(''):'<p class="empty">Ingen salgsutfall registrert ennå.</p>';
 }catch(e){message(e.message);}}
 function options(map,value){return Object.entries(map).map(([key,label])=>'<option value="'+key+'"'+(key===value?' selected':'')+'>'+label+'</option>').join('');}
 let opening=0;
 window.openCommercial=async function(id){const requestNumber=++opening;
 document.querySelector('[data-view="commercial"]').click();el('commercial-detail').innerHTML='<p>Laster salgsutfall…</p>';message('');
 try{const d=await api('/api/ops/inquiries/'+id+'/commercial');if(requestNumber!==opening)return;
 const c=d.current||{version:0,stage:'OPEN',delivery:'UNKNOWN',source:'WEB',follow_up:'',paid_on:'',revenue_ore:0,direct_cost_ore:0,incremental:0,attribution:''};
 let eventId=crypto.randomUUID();
 el('commercial-detail').innerHTML='<div class="card"><h3>Salgsutfall · '+esc(d.inquiry.navn)+' · #'+id+'</h3><p>Registreres av ansvarlig. Betalt betyr at betalingen er kontrollert; dette er ingen betalingsintegrasjon.</p><form id="commercial-form"><div class="detail-grid">'+
 '<label>Salgsstatus<br><select name="stage">'+options(stages,c.stage)+'</select></label>'+ '<label>Leveranse<br><select name="delivery">'+options(deliveries,c.delivery)+'</select></label>'+ '<label>Kilde<br><select name="source"'+(d.current?' disabled':'')+'>'+options(sources,c.source)+'</select></label>'+ '<label>Oppfølgingsdato<br><input name="followUp" type="date" value="'+esc(c.follow_up)+'"></label>'+ '<label>Inntekt ekskl. mva, kr<br><input name="revenue" type="number" min="0" max="1000000" step="0.01" required value="'+c.revenue_ore/100+'"></label>'+ '<label>Direkte kostnad ekskl. mva, kr<br><input name="cost" type="number" min="0" max="1000000" step="0.01" required value="'+c.direct_cost_ore/100+'"></label>'+ '<label>Betalingsdato<br><input name="paidOn" type="date" value="'+esc(c.paid_on)+'"></label>'+ '<label>Ansvarlig<br><input name="actor" required minlength="2" maxlength="64" value=""></label></div>'+ '<p><label><input name="incremental" type="checkbox"'+(c.incremental?' checked':'')+'> Vi vurderer at oppdraget ellers ville gått tapt</label></p><label>Begrunnelse for ekstra oppdrag<textarea name="attribution" maxlength="600">'+esc(c.attribution)+'</textarea></label><label>Notat om denne registreringen<textarea name="note" required maxlength="600"></textarea></label><p class="muted">Ta bare med inntekter og kostnader som tilhører Finnbilglass. Verkstedets egen faktura skal ikke telles som Finnbilglass-omsetning. Kilden låses etter første lagring.</p><button type="submit">Lagre salgsutfall</button></form><details><summary>Siste 20 registreringer</summary>'+((d.history||[]).map(h=>'<p><b>'+esc(h.actor)+'</b> · '+esc(new Date(h.created_at).toLocaleString('nb-NO'))+' · '+esc(stages[h.stage])+'<br>'+esc(h.note)+'</p>').join('')||'<p>Ingen historikk ennå.</p>')+'</details></div>';
 const form=el('commercial-form');
 form.onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;const f=new FormData(form);try{
 await api('/api/ops/inquiries/'+id+'/commercial',{eventId,version:c.version,stage:f.get('stage'),delivery:f.get('delivery'),source:c.source&&d.current?c.source:f.get('source'),followUp:f.get('followUp'),paidOn:f.get('paidOn'),revenueOre:Math.round(Number(f.get('revenue'))*100),directCostOre:Math.round(Number(f.get('cost'))*100),incremental:f.has('incremental'),attribution:f.get('attribution'),note:f.get('note'),actor:f.get('actor')});
 el('commercial-detail').innerHTML='<p>Salgsutfallet er lagret. Åpne saken på nytt for å gjøre en ny registrering.</p>';message('Lagret med ansvarlig og tidspunkt.');await refresh();
 }catch(e){message(e.message);button.disabled=false;}};
 }catch(e){if(requestNumber===opening){el('commercial-detail').innerHTML='';message(e.message);}}};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-commercial]');if(button)window.openCommercial(Number(button.dataset.commercial));});
 el('commercial-refresh').onclick=refresh;
 document.querySelector('[data-view="commercial"]').addEventListener('click',refresh);
})();
</script>`;
}
