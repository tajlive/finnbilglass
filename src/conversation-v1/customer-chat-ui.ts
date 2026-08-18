/**
 * conversation-v1/customer-chat-ui — FinnBilGlass AI Customer Interface v1 (C5).
 * STAGING-ONLY, env-gated (ASSISTANT_ENABLED). Mobil-først: flytende AI-knapp,
 * chat-panel, 4 store handlingsknapper, tale (Web Speech API + echo-bekreftelse),
 * skiltfoto (kamera-API), koblet mot eksisterende /api/assistant/* (C2-verktøy +
 * R1 accessorier). Kunden får ALDRI en fri «spør meg om alt»-AI — kun verktøy-styrt flyt.
 */
export function customerChatUi(): Response {
  return new Response(CUSTOMER_CHAT_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const CUSTOMER_CHAT_HTML = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FinnBilGlass AI — STAGING</title>
<style>
  :root { --fg:#111; --muted:#667; --border:#e2e5ea; --accent:#0a6cff; --accent-2:#0052cc; --bg:#f5f6f8; --card:#fff; --ok:#0e8a3e; --warn:#b45309; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { height:100%; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  .fab { position:fixed; right:16px; bottom:calc(16px + env(safe-area-inset-bottom)); width:60px; height:60px; border-radius:50%; border:0;
    background:var(--accent); color:#fff; font-size:26px; cursor:pointer; box-shadow:0 6px 20px rgba(10,108,255,.4); z-index:99;
    display:flex; align-items:center; justify-content:center; transition:transform .15s; }
  .fab::before { content:""; position:absolute; inset:-6px; border-radius:50%; border:2px solid rgba(10,108,255,.35); animation:pulse 2s infinite; }
  @keyframes pulse { 0%{transform:scale(.9);opacity:1} 70%{transform:scale(1.25);opacity:0} 100%{opacity:0} }
  .panel { position:fixed; inset:0; z-index:100; background:var(--bg); display:flex; flex-direction:column; }
  @media (min-width:560px) { .panel { inset:auto; right:16px; bottom:calc(88px + env(safe-area-inset-bottom)); width:400px; height:min(660px, calc(100dvh - 120px)); border-radius:18px; box-shadow:0 12px 40px rgba(0,0,0,.18); overflow:hidden; } }
  .hidden { display:none !important; }
  header { padding:14px 16px; background:var(--card); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; }
  header .t { font-size:15px; font-weight:700; }
  header .badge { background:#ffe9a8; color:#5c4000; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:700; }
  header .close { margin-left:auto; border:0; background:none; font-size:22px; cursor:pointer; color:var(--muted); padding:4px 8px; }
  #msgs { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch; }
  .m { max-width:88%; padding:10px 14px; border-radius:16px; font-size:15px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word; }
  .ai { align-self:flex-start; background:var(--card); border:1px solid var(--border); border-bottom-left-radius:4px; }
  .us { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
  .m.bil { background:#eef4ff; border-color:#cfe0ff; }
  .m.adv { background:#fff8e6; border-color:#f3e3b8; }
  .m.err { background:#ffecec; border-color:#f5c6c6; }
  .chiprow { display:flex; flex-wrap:wrap; gap:8px; padding:10px 16px 0; }
  .chip { border:1.5px solid var(--accent); background:#fff; color:var(--accent); border-radius:999px; padding:10px 16px; font-size:14px; font-weight:600; cursor:pointer; }
  .chip:active { background:var(--accent); color:#fff; }
  .bigbtns { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:12px 16px 4px; }
  .big { border:1px solid var(--border); background:var(--card); border-radius:14px; padding:14px 10px; font-size:14px; font-weight:700; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--fg); }
  .big .ic { font-size:24px; }
  .big.prim { grid-column:1 / -1; background:var(--accent); color:#fff; border-color:var(--accent); }
  .inrow { display:flex; gap:8px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:var(--card); border-top:1px solid var(--border); }
  .inrow input { flex:1; padding:13px 14px; border:1px solid var(--border); border-radius:12px; font-size:16px; }
  .inrow button { border:0; background:var(--accent); color:#fff; border-radius:12px; padding:0 20px; font-size:15px; font-weight:700; cursor:pointer; }
  .spk { border:0; background:none; font-size:22px; cursor:pointer; padding:0 6px; }
  .spk.rec { color:#d33; animation:pulse 1s infinite; }
  #rec { display:none; padding:4px 16px 8px; font-size:12px; color:var(--muted); text-align:center; }
</style>
</head>
<body>
<button id="fab" class="fab" aria-label="Åpne AI-assistent">💬</button>
<div id="panel" class="panel hidden" role="dialog" aria-label="FinnBilGlass AI-assistent">
  <header>
    <div class="t">FinnBilGlass AI</div>
    <span class="badge">STAGING</span>
    <button class="close" id="close" aria-label="Lukk">×</button>
  </header>
  <div id="msgs"></div>
  <div id="rec">🎙 Lytter… si registreringsnummeret</div>
  <div id="chips" class="chiprow"></div>
  <div id="bigbtns" class="bigbtns">
    <button class="big prim" id="b-regnr"><span class="ic">🚗</span>Skriv reg.nr</button>
    <button class="big" id="b-foto"><span class="ic">📷</span>Ta bilde av skilt</button>
    <button class="big" id="b-tale"><span class="ic">🎙</span>Snakk med meg</button>
    <button class="big" id="b-finn"><span class="ic">🔍</span>Finn selv</button>
  </div>
  <form id="inrow" class="inrow hidden" autocomplete="off">
    <button type="button" id="mic" class="spk" aria-label="Snakk">🎙</button>
    <input id="inp" type="text" placeholder="F.eks. SU 18018" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send">
    <button type="submit">Send</button>
  </form>
  <input id="foto" type="file" accept="image/*" capture="environment" class="hidden">
</div>
<script>
const $ = (id) => document.getElementById(id);
let sid = null;
const BASE = '/api/assistant';
const msgs = $('msgs');
function add(who, txt, cls) {
  const d = document.createElement('div');
  d.className = 'm ' + (who === 'us' ? 'us' : 'ai') + (cls ? ' ' + cls : '');
  d.textContent = txt;
  msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  return d;
}
async function api(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function showChips(arr) {
  const c = $('chips'); c.innerHTML = '';
  (arr || []).forEach((t) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => send(t); c.appendChild(b); });
}
async function send(text) {
  if (!sid) sid = (await api('/session', { channel: 'WEB_CHAT' })).sessionId;
  add('us', text);
  const j = await api('/message', { sessionId: sid, text });
  render(j);
}
function render(j) {
  for (const t of j.assistantMessages || [j.assistantText]) if (t) add('ai', t, j.fitmentStatus === 'AMBIGUOUS' ? 'adv' : (j.vehicle ? 'bil' : ''));
  if (j.vehicle) add('ai', '🚗 ' + j.vehicle, 'bil');
  if (j.pendingConfirmation) { add('ai', '✅ ' + j.pendingConfirmation, 'bil'); showChips(['Ja, stemmer', 'Nei']); return; }
  if (j.fitmentStatus === 'EXACT' && j.selectedGlass) {
    add('ai', '✅ Eksakt glass: ' + j.selectedGlass.varenr + ' (' + j.selectedGlass.glass + ')\nPris: ' + (j.price ? j.price + ' kr' : 'se ordreforslag'), 'bil');
    if (j.accessories && j.accessories.length) {
      const inkl = j.accessories.filter(a => a.state === 'INCLUDED_WITH_GLASS');
      const opt = j.accessories.filter(a => a.state === 'OPTIONAL_COMPATIBLE');
      if (inkl.length) add('ai', 'Medfølger glasset: ' + inkl.map(a => a.accessory.name).join(', '), 'bil');
      if (opt.length) showChips(opt.map(a => 'Legg til: ' + a.accessory.name));
    }
    showChips(['Bestill glasset', 'Start på nytt']);
    return;
  }
  if (j.nextQuestions && j.nextQuestions.length) showChips(j.nextQuestions.map(q => q.question));
  if (j.quoteEligible) showChips(['Se ordreforslag', 'Start på nytt']);
}
async function photo(file) {
  if (!sid) sid = (await api('/session', { channel: 'PHOTO' })).sessionId;
  const fd = new FormData(); fd.append('image', file);
  const r = await fetch(BASE + '/photo?sessionId=' + encodeURIComponent(sid), { method: 'POST', body: fd });
  const j = await r.json();
  add('us', '📷 [bilde sendt]');
  render(j);
}
// ── tale med echo-bekreftelse (C2-policy: SPOKEN → PARSED → ECHO → CONFIRMED → ACCEPTED)
let rec = null;
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { add('ai', 'Tale støttes ikke i denne nettleseren — skriv heller registreringsnummeret.'); return; }
  rec = new SR(); rec.lang = 'nb-NO'; rec.interimResults = false;
  $('rec').style.display = 'block';
  rec.onresult = (e) => {
    $('rec').style.display = 'none';
    const heard = e.results[0][0].transcript.trim();
    const parsed = heard.replace(/\\s+/g, '').toUpperCase();
    add('us', '🎙 ' + heard);
    add('ai', 'Jeg hørte «' + heard + '». Stemmer det?', 'bil');
    showChips(['Ja, stemmer', 'Nei, la meg skrive']);
    window.__heard = parsed;
  };
  rec.onerror = () => { $('rec').style.display = 'none'; add('ai', 'Kunne ikke høre deg — prøv igjen eller skriv.'); };
  rec.start();
}
// ── knapper
$('fab').onclick = () => { $('panel').classList.remove('hidden'); if (!sid) add('ai', 'Hei 👋 Jeg kan hjelpe deg å finne riktig frontrute.\\n\\nSkriv registreringsnummeret, eller ta bilde av skiltet.'); };
$('close').onclick = () => $('panel').classList.add('hidden');
$('b-regnr').onclick = () => { $('bigbtns').classList.add('hidden'); $('inrow').classList.remove('hidden'); $('inp').focus(); };
$('b-foto').onclick = () => $('foto').click();
$('foto').onchange = (e) => { if (e.target.files[0]) photo(e.target.files[0]); e.target.value = ''; };
$('b-tale').onclick = () => startMic();
$('b-finn').onclick = () => { window.location.href = '/'; };
$('mic').onclick = () => startMic();
$('inrow').onsubmit = async (e) => {
  e.preventDefault();
  const t = $('inp').value.trim(); if (!t) return;
  $('inp').value = '';
  if (window.__heard && (t === 'Ja, stemmer' || t.toLowerCase() === 'ja')) {
    const parsed = window.__heard; window.__heard = null;
    add('us', t);
    const j = await api('/identifier-confirmation', { sessionId: sid, confirm: true, identifier: parsed });
    render(j); return;
  }
  if (t.toLowerCase() === 'nei, la meg skrive' || t.toLowerCase() === 'nei') { window.__heard = null; showChips([]); add('ai', 'Ok — skriv registreringsnummeret eller OE-merkingen på ruta.'); return; }
  await send(t);
};
window.onload = () => { add('ai', 'Hei 👋 Jeg kan hjelpe deg å finne riktig frontrute.'); };
</script>
</body>
</html>`;
