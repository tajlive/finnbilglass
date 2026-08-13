/** Finnbilglass Worker — frontrute-matcher API.
 *  POST /api/frontrute  {merke, modell, aar, profil} → glass
 *  GET  /health
 */
import type { Env } from './types';
import { matchFrontrute, type BilInput } from './matcher';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function validateBil(body: unknown): BilInput | string {
  if (!body || typeof body !== 'object') return 'JSON-body påkrevd';
  const b = body as Record<string, unknown>;
  if (typeof b.merke !== 'string' || !b.merke.trim()) return 'merke påkrevd (f.eks. "VW")';
  const bil: BilInput = { merke: b.merke.trim() };
  if (typeof b.modell === 'string') bil.modell = b.modell.trim();
  if (typeof b.aar === 'number' && Number.isInteger(b.aar) && b.aar > 1900 && b.aar < 2100) bil.aar = b.aar;
  if (Array.isArray(b.nokkelord)) bil.nokkelord = (b.nokkelord as unknown[]).filter((k) => typeof k === 'string').map((k) => (k as string).trim());
  if (b.profil && typeof b.profil === 'object') {
    const p = b.profil as Record<string, unknown>;
    const profil: BilInput['profil'] = {};
    for (const key of ['coated', 'sensor', 'antenne', 'sensorgel', 'innkapslet'] as const) {
      if (typeof p[key] === 'boolean') profil[key] = p[key] as boolean;
    }
    if (typeof p.fargetone === 'string') profil.fargetone = p.fargetone;
    bil.profil = profil;
  }
  return bil;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    // Mini-landingsside (apex/www inntil Pages-frontenden er klar)
    if (method === 'GET' && (path === '/' || path === '')) {
      const html = `<!doctype html><html lang="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finnbilglass — kommer snart</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;max-width:34rem;padding:2rem}
h1{font-size:2.2rem;margin:0 0 .5rem}h1 span{color:#38bdf8}
p{color:#94a3b8;line-height:1.6}.badge{display:inline-block;background:#1e293b;border:1px solid #334155;border-radius:999px;padding:.35rem 1rem;font-size:.85rem;margin-top:1.2rem}</style></head>
<body><div class="box">
<h1>Finn<span>bilglass</span></h1>
<p>Bilglass til ekte pris — uten forsikring. Vi bygger nettsiden. Sjekk API-et: <code>/api/frontrute</code></p>
<div class="badge">Åpner etter beta</div>
</div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS } });
    }

    if (method === 'GET' && path === '/health') {
      const count = await env.FINNBILGLASS_DB.prepare('SELECT COUNT(*) AS n FROM autoglass_prisliste').first<{ n: number }>();
      return json({ ok: true, service: 'finnbilglass-frontrute', katalogRader: count?.n ?? 0 });
    }

    if (method === 'POST' && path === '/api/frontrute') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const bil = validateBil(body);
      if (typeof bil === 'string') return json({ ok: false, error: bil }, 400);
      try {
        const resultat = await matchFrontrute(env, bil);
        return json({ ok: true, ...resultat });
      } catch (e) {
        console.error('matchFrontrute feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    return json({ ok: false, error: `Ukjent rute: ${method} ${path}`, ruter: ['POST /api/frontrute', 'GET /health'] }, 404);
  },
};
