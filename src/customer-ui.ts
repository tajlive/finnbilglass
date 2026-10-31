/**
 * Kundesider: /logg-inn og /min-side (P0, Spor D).
 *
 * Mobilvennlig, norsk, FinnBilGlass-designtokens (amber #F59E0B, Inter Tight).
 * Server-side autorisasjon: «Min side» henter kun via /api/me/inquiries med
 * økt-cookie — klienten får aldri tilgang til andres saker.
 */

const CSS = `
:root{--brand:#F59E0B;--brand-hover:#D97706;--ink:#0B1220;--text-2:#5B6572;--bg:#fff;--surface:#F7F9FC;--border:#E4E9F0;--success:#10B981;--danger:#EF4444}
*{box-sizing:border-box}body{margin:0;font-family:'Inter Tight',system-ui,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:420px;margin:0 auto;padding:24px 20px 48px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:24px 0 8px}
p.sub{color:var(--text-2);margin:0 0 24px;font-size:15px}
label{display:block;font-size:14px;font-weight:600;margin:16px 0 6px}
input{width:100%;min-height:56px;padding:0 14px;font-size:16px;border:1px solid var(--border);border-radius:12px;background:#fff}
button{width:100%;min-height:56px;border:0;border-radius:12px;background:var(--brand);color:#0B1220;font-size:16px;font-weight:600;cursor:pointer;margin-top:20px}
button.ghost{background:transparent;border:1px solid var(--border);color:var(--text-2)}
.msg{padding:14px;border-radius:12px;font-size:14px;margin-top:16px;display:none}
.msg.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;display:block}
.msg.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;display:block}
.kort{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px}
.kort .t{font-weight:600}.kort .s{color:var(--text-2);font-size:14px;margin-top:4px}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;margin-top:8px}
.badge.NEW{background:#fef3c7;color:#92400e}.badge.CONTACTED{background:#dbeafe;color:#1e40af}
.badge.APPROVED{background:#ecfdf5;color:#065f46}.badge.REJECTED{background:#fef2f2;color:#991b1b}
.tom{color:var(--text-2);font-size:13px;text-align:center;margin-top:32px}
`;

const SKJELL = `<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logg inn — FinnBilglass</title><style>${CSS}</style>`;

function avslutt() {
  return `<div class="tom">FinnBilglass · leverandør av bilglass</div></div></body></html>`;
}

/** /logg-inn — passordfri innlogging (e-post + invitasjonskode). */
export function loggInnPage(): string {
  return `${SKJELL}<div class="wrap">
  <h1>Logg inn</h1>
  <p class="sub">Få tilsendt en innloggingslenke på e-post. Du trenger invitasjonskoden fra FinnBilglass.</p>
  <label for="email">E-post</label>
  <input id="email" type="email" autocomplete="email" placeholder="deg@epost.no">
  <label for="invite">Invitasjonskode</label>
  <input id="invite" type="text" autocomplete="off" placeholder="Lim inn koden din">
  <button id="send">Send innloggingslenke</button>
  <div class="msg" id="msg"></div>
  <script>
    const msg=document.getElementById('msg');
    const vis=(t,ok)=>{msg.textContent=t;msg.className='msg '+(ok?'ok':'err');};
    document.getElementById('send').onclick=async()=>{
      const email=document.getElementById('email').value.trim();
      const invite=document.getElementById('invite').value.trim();
      if(!email){vis('Skriv inn e-postadressen din.',false);return;}
      if(!invite){vis('Skriv inn invitasjonskoden din.',false);return;}
      try{
        const r=await fetch('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,invite})});
        const d=await r.json();
        if(r.ok){vis('Sjekk e-posten din. Lenken utløper om 15 minutter.',true);}
        else{vis(d.error||'Noe gikk galt. Prøv igjen.',false);}
      }catch(e){vis('Kunne ikke nå serveren. Prøv igjen.',false);}
    };
  </script>
  ${avslutt()}`;
}

/** /min-side — brukerens egne henvendelser. */
export function minSidePage(): string {
  return `${SKJELL}<div class="wrap">
  <h1>Min side</h1>
  <p class="sub">Dine henvendelser til FinnBilglass.</p>
  <div id="liste"><p class="sub">Henter…</p></div>
  <button class="ghost" id="logout">Logg ut</button>
  <script>
    async function last(){
      const b=document.getElementById('liste');
      try{
        const r=await fetch('/api/me/inquiries');
        if(r.status===401){b.innerHTML='<div class="msg err" style="display:block">Du er ikke innlogget. <a href="/logg-inn">Logg inn</a></div>';return;}
        const d=await r.json();
        if(!d.ok){b.innerHTML='<div class="msg err" style="display:block">'+(d.error||'Kunne ikke hente henvendelser.')+'</div>';return;}
        if(!d.henvendelser.length){b.innerHTML='<div class="msg ok" style="display:block">Du har ingen henvendelser ennå.</div>';return;}
        b.innerHTML=d.henvendelser.map(h=>'<div class="kort"><div class="t">'+(h.regnr||'—')+'</div><div class="s">#'+h.id+' · '+new Date(h.created_at).toLocaleDateString('nb-NO')+'</div><span class="badge '+(h.status||'NEW')+'">'+(h.status||'NEW')+'</span></div>').join('');
      }catch(e){b.innerHTML='<div class="msg err" style="display:block">Kunne ikke nå serveren.</div>';}
    }
    document.getElementById('logout').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location.href='/logg-inn';};
    last();
  </script>
  ${avslutt()}`;
}
