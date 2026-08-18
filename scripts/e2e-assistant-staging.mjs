// E2E staging: full SU18018-flyt over HTTP med D1-persistens (flere isolater/requests).
const BASE = process.env.STAGING_BASE ?? 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
async function post(p, body) {
  const r = await fetch(`${BASE}/api/assistant/${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
const s = await post('session', { channel: 'WEB_CHAT' });
console.log('session:', s.status, s.data.ok, s.data.sessionId?.slice(0, 12));
const sid = s.data.sessionId;
const m1 = await post('message', { sessionId: sid, text: 'SU18018' });
console.log('m1:', m1.data.reply);
const m2 = await post('message', { sessionId: sid, text: '7H0845101H' });
console.log('m2:', m2.data.reply);
const m3 = await post('message', { sessionId: sid, text: 'ja' });
console.log('m3:', m3.data.reply, '| label:', m3.data.stateLabel);
const st = await fetch(`${BASE}/api/assistant/session/${sid}/state`).then((r) => r.json());
console.log('status:', st.state.fitmentStatus, st.state.verificationMode, '| varenr:', st.state.selectedGlass?.varenr);
const q = await post('quote', { sessionId: sid, kind: 'orderable' });
console.log('quote:', q.status, JSON.stringify(q.data));
// kryss-sesjon: tilfeldig ID skal gi 404
const bad = await fetch(`${BASE}/api/assistant/session/fs-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/state`).then((r) => r.json());
console.log('cross-session (ugyldig ID):', bad.error);
