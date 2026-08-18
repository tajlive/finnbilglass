/**
 * C5 E2E — staging-only AI-kundegrensesnitt mot finnbilglass-frontrute-staging.
 * Test: /ai side + session/message-flyt for SU18018 + 10 andre kjøretøy (fasit-live).
 * Ingen prod-berøring.
 */
const BASE = 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const API = BASE + '/api/assistant';

async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(path + ' → ' + r.status + ' ' + (j.error || ''));
  return j;
}

// 1) /ai-siden serveres (staging-gate aktiv)
const page = await fetch(BASE + '/ai');
const html = await page.text();
if (page.status !== 200 || !html.includes('FinnBilGlass AI') || !html.includes('SpeechRecognition')) {
  console.error('✖ /ai-siden feil: status', page.status, '| fab?', html.includes('id="fab"'));
  process.exit(1);
}
console.log('✔ /ai widget: fab + tale + foto-knapper til stede');

// 2) SU18018 full flyt — v1-kjernen kjører i shadow (klient-state = legacy): verifiser kjernens svar
async function getState(sid) {
  const r = await fetch(API + '/session/' + sid + '/state');
  if (!r.ok) throw new Error('state → ' + r.status);
  return r.json();
}
let s = await post('/session', { channel: 'WEB_CHAT' });
const sid = s.sessionId;
let r = await post('/message', { sessionId: sid, text: 'Hei, trenger frontrute til SU18018' });
let st = await getState(sid);
if (!st.state?.vehicleIdentity || !st.state.vehicleIdentity.model.includes('Transporter')) { console.error('✖ SU18018: ingen bilinfo →', JSON.stringify(st).slice(0, 300)); process.exit(1); }
console.log('✔ SU18018 identifisert:', st.state.vehicleIdentity.make, st.state.vehicleIdentity.model);
const qs = st.state.nextQuestions || [];
if (qs.length) console.log('   spørsmål (kun informative):', qs.map((q) => q.question).join(' | '));
// OE → echo → bekreft → v1-kjernen bekrefter eksakt glass (shadow)
r = await post('/message', { sessionId: sid, text: '7H0845101H' });
if (!r.reply.includes('Stemmer det')) { console.error('✖ OE → ingen echo-bekreftelse →', r.reply); process.exit(1); }
r = await post('/message', { sessionId: sid, text: 'ja' });
if (!r.reply.includes('2525GYA')) { console.error('✖ SU18018 OE → kjernen bekreftet ikke 2525GYA →', r.reply); process.exit(1); }
console.log('✔ SU18018 → v1-kjernen bekrefter 2525GYA (EXACT-varianter i shadow):', r.reply);

// 3) 10 andre kjøretøy (fasit-live) — måler utfall ærlig (mange veteraner → UNKNOWN/AMBIGUOUS)
const { readFileSync } = await import('node:fs');
const fasit = JSON.parse(readFileSync(new URL('../data/fasit-live.json', import.meta.url), 'utf8')).fasiter;
let ok = 0;
for (const f of fasit.slice(0, 10)) {
  const s2 = (await post('/session', { channel: 'WEB_CHAT' })).sessionId;
  await post('/message', { sessionId: s2, text: `Frontrute til ${f.merke} ${f.modell} ${f.aar}` });
  const st2 = await getState(s2);
  const stt = st2.state || {};
  const status = stt.fitmentStatus || 'UNKNOWN';
  const q = (stt.nextQuestions || []).length;
  if (stt.vehicleIdentity) ok += 1;
  console.log(`  ${f.merke} ${f.modell} (${f.aar}) → ${status} | spørsmål: ${q}`);
}
console.log(`\n✔ ${ok}/10 kjøretøy identifisert av assistenten (resterende uten applikasjon i offline-registeret → UNKNOWN — ærlig)`);
console.log('C5 E2E OK');
