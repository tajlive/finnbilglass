/** Finnbilglass Worker — frontrute-matcher API + statisk frontend.
 *  POST /api/frontrute  {merke, modell, aar, profil} → glass
 *  GET  /health
 *  Alt annet (/, styles.css, app.js, index.html) → [assets] public/
 */
import type { Env } from './types';
import { matchFrontrute, type BilInput } from './matcher';
import { resolveFrontrute } from './vin-resolver';
import { svvLookup } from './svv';

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

/** IP + geolokalisering gratis fra Cloudflare (request.cf) — ingen ekstern API. */
function geoAv(request: Request) {
  const cf = (request as unknown as { cf?: { country?: string; city?: string; asOrganization?: string } }).cf;
  return {
    ip: request.headers.get('CF-Connecting-IP') ?? null,
    land: cf?.country ?? null,
    by: cf?.city ?? null,
    asn: cf?.asOrganization ?? null,
  };
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
        // Resolver først (PINPOINT/VERIFY). FALLBACK → eksisterende tekstmatcher (uendret).
        const resolver = await resolveFrontrute(env, bil);
        if (resolver.utfall !== 'FALLBACK') {
          return json({
            ok: true,
            ...resolver,
            pinpoint: resolver.utfall === 'PINPOINT',
            anbefaling: resolver.utfall === 'PINPOINT'
              ? { varenr: resolver.varenr, varenavn: resolver.varenavn, pris: resolver.pris, listepris: resolver.listepris, eurokode: resolver.eurokode }
              : null,
            meta: { resolver: true, grunn: resolver.grunn },
          });
        }
        const resultat = await matchFrontrute(env, bil);
        return json({ ok: true, ...resultat, meta: { ...resultat.meta, resolver: false } });
      } catch (e) {
        console.error('matchFrontrute feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/regnr') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const regnr = (body as Record<string, unknown>)?.regnr;
      if (typeof regnr !== 'string' || !regnr.trim()) return json({ ok: false, error: 'regnr påkrevd' }, 400);
      const ren = regnr.trim();
      const norm = ren.toUpperCase().replace(/[\s\-–—.]+/g, '');
      let lagret = false;
      try {
        await env.FINNBILGLASS_DB.prepare(
          'INSERT OR IGNORE INTO regnr_logg (regnr, regnr_norm, ua) VALUES (?, ?, ?)'
        ).bind(ren, norm, request.headers.get('User-Agent') ?? null).run();
        lagret = true;
      } catch (e) {
        console.error('regnr-lagring feilet:', e);
      }
      // Søkelogg: hvert søk med IP + geolokalisering (land/by/ISP) — aldri blokkerende.
      try {
        const g = geoAv(request);
        await env.FINNBILGLASS_DB.prepare(
          'INSERT INTO sok_logg (regnr, regnr_norm, ip, land, by, asn, ua) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(ren, norm, g.ip, g.land, g.by, g.asn, request.headers.get('User-Agent') ?? null).run();
      } catch (e) {
        console.error('søkelogg feilet:', e);
      }
      // SVV-oppslag: kjennemerke → bil. Null ved feil/ukjent — frontend faller til manuell.
      let bil = null;
      let resolver = null;
      try {
        bil = await svvLookup(norm, env.SVV_API_KEY);
      } catch (e) {
        console.error('SVV-oppslag feilet:', e);
      }
      // OE/VIN-pinpoint: SVV-bil → resolver (PINPOINT/VERIFY/FALLBACK) — aldri blokkerende.
      if (bil) {
        try {
          resolver = await resolveFrontrute(env, {
            merke: bil.merke,
            modell: bil.modell ?? undefined,
            aar: bil.aar ?? undefined,
            vin: bil.vin ?? undefined,
          });
        } catch (e) {
          console.error('Resolver feilet:', e);
        }
      }
      return json({ ok: true, lagret, bil, resolver });
    }

    // Alt annet (/, index.html, styles.css, app.js, …) → statiske assets fra public/
    return env.ASSETS.fetch(request);
  },
};
