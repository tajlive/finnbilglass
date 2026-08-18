/**
 * conversation-v1/worker-handler — STAGING Worker-ruting for /api/assistant/* og /assistant-UI.
 * Kun nådd når env ASSISTANT_ENABLED=true|staging (gate i src/index.ts). Prod default: AV.
 *
 * Sesjonspersistens: Workers-isolater er statsløse → sesjoner lagres i D1
 * (assistant_sessions-tabell, migrasjon 0009). Minne-cache i isolatet for gjenbruk.
 */
import { AssistantApi, ASSISTANT_SESSION_TTL_MS } from './api.js';
import { FitmentSession, type Channel } from './session.js';
import { D1EvidenceLedger } from '../learning-v1/d1-ledger.js';

const memoryApi = new AssistantApi();

/** C8.1: ledger-instans per isolate — D1-evidens (append-only) når DB-binding finnes. */
function apiWithLedger(env: Env): AssistantApi {
  if (env.FINNBILGLASS_DB) return new AssistantApi({ ledger: new D1EvidenceLedger(env.FINNBILGLASS_DB) });
  return memoryApi;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// ── D1-sesjonsbutikk (staging-D1; prod-ruter er env-gated AV) ──
class D1SessionStore {
  constructor(private readonly db: D1Database) {}

  async get(id: string): Promise<FitmentSession | null> {
    const row = await this.db.prepare('SELECT payload FROM assistant_sessions WHERE session_id = ?').bind(id).first<{ payload: string }>();
    if (!row) return null;
    const s = FitmentSession.hydrate(JSON.parse(row.payload) as Record<string, unknown>);
    if (Date.now() - s.lastActivityAt > ASSISTANT_SESSION_TTL_MS) {
      await this.remove(id);
      return null;
    }
    return s;
  }

  async put(s: FitmentSession): Promise<void> {
    await this.db.prepare(
      'INSERT INTO assistant_sessions (session_id, payload, last_activity) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET payload = excluded.payload, last_activity = excluded.last_activity',
    ).bind(s.fitmentSessionId, JSON.stringify(s.toJSON()), Date.now()).run();
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM assistant_sessions WHERE session_id = ?').bind(id).run();
  }
}

export async function handleAssistant(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const ip = clientIp(request);
  const store = new D1SessionStore(env.FINNBILGLASS_DB);
  const api = apiWithLedger(env); // C8.1: D1-evidens-ledger når DB-binding finnes (staging)

  const load = async (id: string): Promise<boolean> => {
    if (api.peek(id)) return true;
    const s = await store.get(id);
    if (s) { api.loadSession(s); return true; }
    return false;
  };
  const persist = async (id: string): Promise<void> => {
    const s = api.peek(id);
    if (s) await store.put(s);
  };

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    // POST /api/assistant/session
    if (method === 'POST' && path === '/api/assistant/session') {
      const body = (await request.json().catch(() => ({}))) as { channel?: Channel };
      const r = api.createSession(body.channel ?? 'WEB_CHAT', { ip });
      if (!r.ok || !r.sessionId) return json({ ok: false, error: r.error }, 429);
      await store.put(api.peek(r.sessionId)!);
      return json({ ok: true, sessionId: r.sessionId, stateLabel: r.stateLabel });
    }

    // POST /api/assistant/message
    if (method === 'POST' && path === '/api/assistant/message') {
      const body = (await request.json().catch(() => ({}))) as { sessionId?: string; text?: string };
      if (!body.sessionId) return json({ ok: false, error: 'sessionId påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.message(body.sessionId, body.text ?? '', { ip });
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, reply: r.reply, stateLabel: r.stateLabel }) : json({ ok: false, error: r.error }, r.error?.startsWith('RATE_LIMITED') ? 429 : 404);
    }

    // POST /api/assistant/observation
    if (method === 'POST' && path === '/api/assistant/observation') {
      const body = (await request.json().catch(() => ({}))) as { sessionId?: string; questionId?: string; value?: string | boolean };
      if (!body.sessionId || !body.questionId) return json({ ok: false, error: 'sessionId+questionId påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.observation(body.sessionId, body.questionId, body.value ?? true);
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, reply: r.reply }) : json({ ok: false, error: r.error }, 404);
    }

    // POST /api/assistant/photo
    if (method === 'POST' && path === '/api/assistant/photo') {
      const body = (await request.json().catch(() => ({}))) as Parameters<AssistantApi['photo']>[1] & { sessionId?: string };
      if (!body.sessionId) return json({ ok: false, error: 'sessionId påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.photo(body.sessionId, body);
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, reply: r.reply, requiresConfirmation: r.requiresConfirmation, stateLabel: r.stateLabel }) : json({ ok: false, error: r.error }, 400);
    }

    // POST /api/assistant/identifier-confirmation
    if (method === 'POST' && path === '/api/assistant/identifier-confirmation') {
      const body = (await request.json().catch(() => ({}))) as { sessionId?: string; parsedValue?: string; confirmed?: boolean };
      if (!body.sessionId || !body.parsedValue) return json({ ok: false, error: 'sessionId+parsedValue påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.identifierConfirmation(body.sessionId, body.parsedValue, body.confirmed ?? true);
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, reply: r.reply }) : json({ ok: false, error: r.error }, 404);
    }

    // GET /api/assistant/session/:id/state
    const stateMatch = path.match(/^\/api\/assistant\/session\/([^/]+)\/state$/);
    if (method === 'GET' && stateMatch) {
      const loaded = await load(stateMatch[1]);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.state(stateMatch[1]);
      return r.ok ? json({ ok: true, state: r.state, stateLabel: r.stateLabel }) : json({ ok: false, error: r.error }, 404);
    }

    // POST /api/assistant/handoff
    if (method === 'POST' && path === '/api/assistant/handoff') {
      const body = (await request.json().catch(() => ({}))) as { sessionId?: string; reason?: string };
      if (!body.sessionId) return json({ ok: false, error: 'sessionId påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.handoff(body.sessionId, body.reason ?? 'kundeforespørsel');
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, packet: r.packet }) : json({ ok: false, error: r.error }, 404);
    }

    // POST /api/assistant/quote (orderable | estimate)
    if (method === 'POST' && path === '/api/assistant/quote') {
      const body = (await request.json().catch(() => ({}))) as { sessionId?: string; kind?: 'orderable' | 'estimate' };
      if (!body.sessionId) return json({ ok: false, error: 'sessionId påkrevd' }, 400);
      const loaded = await load(body.sessionId);
      if (!loaded) return json({ ok: false, error: 'SESSION_NOT_FOUND_OR_EXPIRED' }, 404);
      const r = api.quote(body.sessionId, body.kind ?? 'orderable');
      await persist(body.sessionId);
      return r.ok ? json({ ok: true, ...(body.kind === 'estimate' ? { estimate: r.estimate } : { quote: r.quote }) }) : json({ ok: false, error: r.error }, r.error?.startsWith('ORDERABLE_QUOTE') ? 403 : 404);
    }

    return json({ ok: false, error: 'assistant-rute ikke funnet' }, 404);
  } catch (e) {
    console.error('assistant-api feilet:', e);
    return json({ ok: false, error: 'Intern feil' }, 500);
  }
}

interface Env {
  FINNBILGLASS_DB: D1Database;
  ASSETS?: Fetcher;
  ASSISTANT_ENABLED?: string;
}

/** STAGING-UI: separat assistent-grensesnitt (kun staging, env-gated). */
export function assistantUi(): Response {
  return new Response(ASSISTANT_UI_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } });
}

const ASSISTANT_UI_HTML = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FinnBilGlass-assistent — STAGING</title>
<style>
  :root { --fg:#111; --muted:#666; --border:#ddd; --accent:#0a6cff; --bg:#fafafa; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin:0; background:var(--bg); color:var(--fg); }
  header { padding: 16px 20px; border-bottom:1px solid var(--border); background:#fff; display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; }
  .badge { background:#ffe9a8; color:#5c4000; border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600; }
  main { max-width:680px; margin:0 auto; padding:16px; }
  #status { background:#fff; border:1px solid var(--border); border-radius:10px; padding:12px 16px; margin-bottom:12px; font-size:14px; }
  #status b { color: var(--accent); }
  #chat { background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px; min-height:200px; margin-bottom:12px; }
  .msg { margin-bottom:10px; }
  .msg .who { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .msg .txt { margin-top:2px; }
  form { display:flex; gap:8px; }
  input[type=text] { flex:1; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:15px; }
  button { padding:12px 18px; border:0; border-radius:8px; background:var(--accent); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button.secondary { background:#e8e8e8; color:#333; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
</style>
</head>
<body>
<header><h1>FinnBilGlass-assistent</h1><span class="badge">STAGING — testgrensesnitt</span></header>
<main>
  <div id="status">Status: –</div>
  <div id="chat"><div class="msg"><div class="who">assistent</div><div class="txt">Hei! Oppgi registreringsnummeret for å starte.</div></div></div>
  <form id="f" autocomplete="off">
    <input type="text" id="inp" placeholder="Skriv her… (f.eks. SU18018)" autofocus>
    <button type="submit">Send</button>
  </form>
  <div class="row">
    <button type="button" id="btn-photo" class="secondary">Simuler fotobekreftelse (7H0845101H)</button>
    <button type="button" id="btn-handoff" class="secondary">Overfør til manuell kontroll</button>
  </div>
  <p style="font-size:12px;color:var(--muted)">Staging-grensesnitt for teknisk validering. Ingen betaling, ingen prod-data.</p>
</main>
<script>
  let sid = null;
  const $ = (id) => document.getElementById(id);
  function append(who, txt) {
    const d = document.createElement('div'); d.className = 'msg';
    d.innerHTML = '<div class="who">' + who + '</div><div class="txt"></div>';
    d.querySelector('.txt').textContent = txt;
    $('chat').appendChild(d); $('chat').scrollTop = $('chat').scrollHeight;
  }
  async function post(p, body) {
    const r = await fetch('/api/assistant/' + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    return r.json();
  }
  async function init() {
    const r = await post('session', { channel: 'WEB_CHAT' });
    sid = r.sessionId;
    setStatus(r.stateLabel);
  }
  function setStatus(label) { $('status').innerHTML = 'Status: <b>' + (label ?? '–') + '</b>'; }
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('inp').value; $('inp').value = '';
    if (!text || !sid) return;
    append('deg', text);
    const r = await post('message', { sessionId: sid, text });
    append('assistent', r.reply ?? r.error ?? '…');
    setStatus(r.stateLabel);
  });
  $('btn-photo').addEventListener('click', async () => {
    append('system', '📷 simulert foto: OE 7H0845101H (conf 0.82)');
    const r = await post('photo', { sessionId: sid, sourceImageId: 'staging-demo-1', oes: [{ rawText: '7H0845101H', normalizedCandidate: '7H0845101H', visionConfidence: 0.82 }] });
    append('assistent', r.reply ?? r.error ?? '…');
    setStatus(r.stateLabel);
  });
  $('btn-handoff').addEventListener('click', async () => {
    const r = await post('handoff', { sessionId: sid, reason: 'test: manuell overføring fra staging-UI' });
    append('assistent', r.ok ? 'Saken er sendt til manuell kontroll.' : (r.error ?? '…'));
    setStatus('Sendt til manuell kontroll');
  });
  init();
</script>
</body>
</html>`;
