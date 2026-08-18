/** Finnbilglass Worker — frontrute-matcher API + statisk frontend.
 *  POST /api/frontrute  {merke, modell, aar, profil} → glass
 *  GET  /health
 *  Alt annet (/, styles.css, app.js, index.html) → [assets] public/
 */
import type { Env } from './types';
import { matchFrontrute, tierPris, type BilInput } from './matcher';
import { resolveFrontrute } from './vin-resolver';
import { resolverModus } from './kill-switch';
import { svvLookup, svvLookupVin } from './svv';
import { handleAssistant, assistantUi } from './conversation-v1/worker-handler.js';
import { customerChatUi } from './conversation-v1/customer-chat-ui.js';
import { lesSkilt } from './les-skilt';
import { createCaseId, isEvidenceImageType, MAX_EVIDENCE_IMAGE_BYTES, registrationHash } from './evidence-capture-v01';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  if (typeof b.vin === 'string' && b.vin.trim()) bil.vin = b.vin.trim().toUpperCase();
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

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Session-id fra frontend (localStorage) — kobler hele kundereisen. */
function sessionId(body: unknown, request: Request): string | null {
  if (isRecord(body) && typeof body.sessionId === 'string' && body.sessionId.trim()) {
    return body.sessionId.trim().slice(0, 64) || null;
  }
  return request.headers.get('X-Session-Id')?.slice(0, 64) || null;
}

/** Hent bil-kontekst fra body for opplæringslogging. */
function bilKontekst(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  const b = body as Record<string, unknown>;
  const bil = isRecord(b.bil) ? b.bil as Record<string, unknown> : null;
  const ctx: Record<string, unknown> = {};
  if (typeof b.regnr === 'string' && b.regnr.trim()) ctx.regnr = b.regnr.trim();
  if (typeof b.vin === 'string' && b.vin.trim()) ctx.vin = b.vin.trim();
  if (bil) {
    for (const key of ['merke', 'modell', 'aar', 'import', 'importLand', 'forstegangsregistrert'] as const) {
      if (bil[key] !== undefined && bil[key] !== null) ctx[key] = bil[key];
    }
  }
  return Object.keys(ctx).length ? ctx : null;
}

/** Logg hendelse (valg/inntasting) — aldri blokkerende, feil svelges. */
async function loggHendelse(env: Env, body: unknown, request: Request): Promise<void> {
  try {
    const hendelse = isRecord(body) && typeof (body as Record<string, unknown>).hendelse === 'string'
      ? ((body as Record<string, unknown>).hendelse as string).trim().slice(0, 40)
      : '';
    if (!hendelse) return;
    const data = isRecord(body) && (body as Record<string, unknown>).data !== undefined
      ? JSON.stringify((body as Record<string, unknown>).data)
      : null;
    const utfall = isRecord(body) && typeof (body as Record<string, unknown>).resolverUtfall === 'string'
      ? ((body as Record<string, unknown>).resolverUtfall as string).slice(0, 12)
      : null;
    const sid = sessionId(body, request);
    const ctx = bilKontekst(body);
    await env.FINNBILGLASS_DB.prepare(
      `INSERT INTO opplaering_hendelse (session_id, hendelse, data, bil_kontekst, resolver_utfall, ip, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sid,
      hendelse,
      data,
      ctx ? JSON.stringify(ctx) : null,
      utfall,
      request.headers.get('CF-Connecting-IP') ?? null,
      request.headers.get('User-Agent') ?? null,
    ).run();
  } catch (e) {
    console.error('opplaering-hendelse-logging feilet:', e);
  }
}

/** DataURL → { bytes, mime, ext }. Returnerer null ved ugyldig dataURL. */
function dataUrlTilBytes(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const m = /^data:([a-z0-9/+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const mime = m[1].toLowerCase();
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { bytes, mime, ext };
  } catch {
    return null;
  }
}

function supportAuthorised(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return !!env.SUPPORT_EVIDENCE_TOKEN && !!token && token === env.SUPPORT_EVIDENCE_TOKEN;
}

function supportEvidenceUi(): Response {
  // The token is deliberately requested at runtime and is never embedded in an asset.
  return new Response(`<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finnbilglass support – Evidence</title><style>body{font:16px system-ui;margin:2rem;background:#f8fafc;color:#0f172a}main{max-width:900px;margin:auto}button,input{font:inherit;padding:.65rem}button{background:#f59e0b;border:0;border-radius:.4rem;font-weight:700}.case{background:white;border:1px solid #e2e8f0;border-radius:.6rem;padding:1rem;margin:1rem 0}.images{display:flex;gap:.7rem;flex-wrap:wrap}.images img{width:180px;max-height:140px;object-fit:cover;border-radius:.4rem;border:1px solid #e2e8f0}.muted{color:#64748b}</style><main><h1>Evidence Capture</h1><p class="muted">Internt supportverktøy. Bildene er evidens for manuell oppfølging, ikke en fitment-beslutning.</p><p><input id="token" type="password" placeholder="Support-token" autocomplete="current-password"><button id="load">Last saker</button></p><div id="out"></div><script>const out=document.querySelector('#out'),token=document.querySelector('#token');document.querySelector('#load').onclick=async()=>{out.textContent='Laster…';const h={Authorization:'Bearer '+token.value};const r=await fetch('/api/support/evidence',{headers:h});if(!r.ok){out.textContent=r.status===401?'Ingen tilgang.':'Kunne ikke hente saker.';return}const d=await r.json();out.innerHTML='';d.cases.forEach(c=>{const e=document.createElement('article');e.className='case';e.innerHTML='<b>'+c.caseId+'</b> · '+c.status+'<br><span class="muted">'+new Date(c.createdAt).toLocaleString('nb-NO')+' · '+c.imageCount+' bilde(r)</span>';const imgs=document.createElement('div');imgs.className='images';c.images.forEach(i=>{const a=document.createElement('a');a.href='/api/support/evidence/'+encodeURIComponent(c.caseId)+'/'+encodeURIComponent(i.imageId);a.target='_blank';const img=document.createElement('img');img.alt=i.imageType;fetch(a.href,{headers:h}).then(x=>x.blob()).then(b=>img.src=URL.createObjectURL(b));a.append(img);imgs.append(a)});e.append(imgs);out.append(e)});if(!d.cases.length)out.textContent='Ingen innsendte saker ennå.'}</script></main></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Lagre bilde til R2 + metadata til D1 — aldri blokkerende. */
async function lagreOpplaeringBilde(
  env: Env,
  opts: {
    sessionId: string | null;
    type: 'skilt' | 'verify43r';
    imageDataUrl?: string;
    lesing?: Record<string, unknown>;
    fasit?: Record<string, unknown> | null;
    utfall: 'ok' | 'ikke_funnet' | 'feil';
  }
): Promise<void> {
  try {
    if (!env.OPPLAERING_BUCKET) return;
    let r2Key: string | null = null;
    let mime: string | null = null;
    if (opts.imageDataUrl) {
      const parsed = dataUrlTilBytes(opts.imageDataUrl);
      if (parsed) {
        const ts = Date.now();
        const sid = opts.sessionId ?? 'anonym';
        r2Key = `${opts.type}/${sid}/${ts}.${parsed.ext}`;
        mime = parsed.mime;
        await env.OPPLAERING_BUCKET.put(r2Key, parsed.bytes, { httpMetadata: { contentType: parsed.mime } });
      }
    }
    await env.FINNBILGLASS_DB.prepare(
      `INSERT INTO opplaering_bilde (session_id, type, r2_key, mime, lesing, fasit, utfall)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.sessionId,
      opts.type,
      r2Key,
      mime,
      opts.lesing ? JSON.stringify(opts.lesing) : null,
      opts.fasit ? JSON.stringify(opts.fasit) : null,
      opts.utfall,
    ).run();
  } catch (e) {
    console.error('opplaering-bilde-lagring feilet:', e);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (method === 'GET' && path === '/health') {
      const count = await env.FINNBILGLASS_DB.prepare('SELECT COUNT(*) AS n FROM glass_prisliste').first<{ n: number }>();
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
        // Kill switch (G6): resolver_all → tvungen FALLBACK; resolver_pinpoint → degrader til VERIFY.
        let resolver = await resolveFrontrute(env, bil);
        const modus = await resolverModus(env, resolver.utfall);
        if (modus !== resolver.utfall) {
          resolver = { ...resolver, utfall: modus, grunn: `kill switch: ${resolver.utfall}→${modus} (${resolver.grunn})` };
        }
        if (resolver.utfall !== 'FALLBACK') {
          const topp = resolver.kandidater?.[0] ?? null;
          return json({
            ok: true,
            ...resolver,
            pinpoint: resolver.utfall === 'PINPOINT',
            anbefaling: resolver.utfall === 'PINPOINT'
              ? { varenr: resolver.varenr, varenavn: resolver.varenavn, pris: resolver.pris, listepris: resolver.listepris, eurokode: resolver.eurokode }
              : (topp ? {
                  varenr: topp.varenr,
                  varenavn: topp.varenavn,
                  pris: topp.pris,
                  listepris: topp.listepris,
                  eurokode: topp.eurokode,
                } : null),
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

    if (method === 'POST' && path === '/api/opplaering') {
      // Opplæringslogging av valg/inntasting — frontend kaller ved hver interaksjon.
      // Aldri blokkerende, ingen auth (kun hendelsesdata, ingen PII utover kjennemerke).
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      await loggHendelse(env, body, request);
      return json({ ok: true });
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

    if (method === 'POST' && path === '/api/vin') {
      // Backup-oppslag: kjennemerke fant ikke bilen i SVV → prøv understellsnummer (VIN).
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const vin = (body as Record<string, unknown>)?.vin;
      if (typeof vin !== 'string' || !vin.trim()) return json({ ok: false, error: 'vin påkrevd' }, 400);
      const ren = vin.trim().toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (ren.length < 11 || ren.length > 17) return json({ ok: false, error: 'Ugyldig chassisnummer' }, 400);
      let bil = null;
      let resolver = null;
      try {
        bil = await svvLookupVin(ren, env.SVV_API_KEY);
      } catch (e) {
        console.error('SVV VIN-oppslag feilet:', e);
      }
      if (bil) {
        try {
          resolver = await resolveFrontrute(env, {
            merke: bil.merke,
            modell: bil.modell ?? undefined,
            aar: bil.aar ?? undefined,
            vin: bil.vin ?? ren,
          });
        } catch (e) {
          console.error('Resolver feilet (VIN):', e);
        }
      }
      return json({ ok: true, bil, resolver });
    }

    if (method === 'POST' && path === '/api/les-skilt') {
      // Foto av kjennemerket → AI leser skiltet → SVV gir hele bilen.
      // Erstatter «Fyll inn bilen manuelt»: privatkunder skal ikke gjette merke/modell/år.
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const imageRaw = (body as Record<string, unknown>)?.image;
      if (typeof imageRaw !== 'string' || imageRaw.length < 100 || !imageRaw.startsWith('data:image/')) {
        return json({ ok: false, error: 'image må være dataURL (data:image/jpeg|png|webp;base64,...)' }, 400);
      }
      if (imageRaw.length > 7_000_000) {
        return json({ ok: false, error: 'Bildet er for stort (maks ~5 MB)' }, 413);
      }
      try {
        const lest = await lesSkilt(env.AI, imageRaw);
        // Opplæring: lagre skiltbildet + hva AI-en leste (innlesingsfeil må kunne analyseres).
        const sid = sessionId(body, request);
        await lagreOpplaeringBilde(env, {
          sessionId: sid,
          type: 'skilt',
          imageDataUrl: imageRaw,
          lesing: { regnr: lest.regnr, confidence: lest.confidence, raatekst: lest.raatekst.slice(0, 300) },
          fasit: bilKontekst(body),
          utfall: lest.regnr ? 'ok' : 'ikke_funnet',
        });
        if (!lest.regnr) {
          return json({ ok: false, error: 'Kunne ikke lese kjennemerket i bildet. Prøv igjen i bedre lys, eller skriv det inn manuelt.', lest: { confidence: lest.confidence } }, 422);
        }
        // Samme SVV+resolver-sekvens som /api/regnr.
        let bil = null;
        let resolver = null;
        try {
          bil = await svvLookup(lest.regnr, env.SVV_API_KEY);
        } catch (e) {
          console.error('SVV-oppslag feilet:', e);
        }
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
        return json({ ok: true, regnr: lest.regnr, lest: { confidence: lest.confidence, raatekst: lest.raatekst.slice(0, 120) }, funnet: !!bil, bil, resolver });
      } catch (e) {
        console.error('les-skilt feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/evidence-capture') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const b = isRecord(body) ? body : null;
      const registration = typeof b?.regnr === 'string' ? b.regnr : '';
      const images = Array.isArray(b?.images) ? b.images : [];
      if (!registration.trim()) return json({ ok: false, error: 'Kjennemerke påkrevd' }, 400);
      if (!images.length || images.length > 4) return json({ ok: false, error: 'Legg ved minst ett og maksimalt fire bilder' }, 400);
      if (!env.OPPLAERING_BUCKET) return json({ ok: false, error: 'Bildearkiv er ikke konfigurert' }, 503);
      const decoded: { type: 'plate' | 'windshield' | 'mirror_sensor' | 'interior_optional'; bytes: Uint8Array; mime: string; ext: string }[] = [];
      for (const image of images) {
        if (!isRecord(image) || !isEvidenceImageType(image.type) || typeof image.data !== 'string') return json({ ok: false, error: 'Ugyldig bildedata' }, 400);
        if (image.data.length > 7_000_000) return json({ ok: false, error: 'Et bilde er for stort (maks 5 MB)' }, 413);
        const parsed = dataUrlTilBytes(image.data);
        if (!parsed || !parsed.mime.startsWith('image/') || parsed.bytes.byteLength > MAX_EVIDENCE_IMAGE_BYTES) return json({ ok: false, error: 'Ugyldig bilde eller filen er for stor' }, 400);
        decoded.push({ type: image.type, ...parsed });
      }
      if (new Set(decoded.map((image) => image.type)).size !== decoded.length) return json({ ok: false, error: 'Hver bildetype kan bare sendes én gang' }, 400);
      const createdAt = Date.now();
      const hash = await registrationHash(registration);
      const caseId = createCaseId(new Date(createdAt));
      const sid = sessionId(body, request);
      const records = decoded.map((image, index) => ({ image, imageId: `${caseId}-${index + 1}`, r2Key: `evidence-capture/${caseId}/${image.type}.${image.ext}` }));
      try {
        await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_cases (case_id, registration_hash, vehicle_identity_hash, created_at, session_id, status) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(caseId, hash, hash, createdAt, sid, 'NEW').run();
        await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_status_events (event_id, case_id, status, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
          .bind(`${caseId}-NEW`, caseId, 'NEW', createdAt, 'customer').run();
        for (const record of records) {
          await env.OPPLAERING_BUCKET.put(record.r2Key, record.image.bytes, { httpMetadata: { contentType: record.image.mime } });
          await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_images (image_id, case_id, image_type, r2_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(record.imageId, caseId, record.image.type, record.r2Key, record.image.mime, createdAt).run();
        }
      } catch (e) {
        console.error('evidence-capture lagring feilet:', e);
        return json({ ok: false, error: 'Kunne ikke lagre bildene. Prøv igjen.' }, 500);
      }
      return json({ ok: true, caseId, status: 'NEW', imageCount: records.length, decisionAuthority: 'NONE' }, 201);
    }

    if (method === 'GET' && path === '/support/evidence') return supportEvidenceUi();
    if (method === 'GET' && path === '/api/support/evidence') {
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const rows = await env.FINNBILGLASS_DB.prepare(`SELECT c.case_id, c.created_at, c.status, i.image_id, i.image_type
        FROM evidence_cases c LEFT JOIN evidence_case_images i ON i.case_id = c.case_id ORDER BY c.created_at DESC LIMIT 100`).all<{ case_id: string; created_at: number; status: string; image_id: string | null; image_type: string | null }>();
      const grouped = new Map<string, { caseId: string; createdAt: number; status: string; imageCount: number; images: { imageId: string; imageType: string }[] }>();
      for (const row of rows.results) {
        const item = grouped.get(row.case_id) ?? { caseId: row.case_id, createdAt: row.created_at, status: row.status, imageCount: 0, images: [] };
        if (row.image_id && row.image_type) { item.imageCount++; item.images.push({ imageId: row.image_id, imageType: row.image_type }); }
        grouped.set(row.case_id, item);
      }
      return json({ ok: true, cases: [...grouped.values()] });
    }
    const imageMatch = /^\/api\/support\/evidence\/([^/]+)\/([^/]+)$/.exec(path);
    if (method === 'GET' && imageMatch) {
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      if (!env.OPPLAERING_BUCKET) return json({ ok: false, error: 'Bildearkiv er ikke konfigurert' }, 503);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT r2_key, mime FROM evidence_case_images WHERE case_id = ? AND image_id = ?').bind(imageMatch[1], imageMatch[2]).first<{ r2_key: string; mime: string }>();
      if (!row) return json({ ok: false, error: 'Ikke funnet' }, 404);
      const object = await env.OPPLAERING_BUCKET.get(row.r2_key);
      if (!object) return json({ ok: false, error: 'Bilde mangler' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, no-store' } });
    }

    // STAGING-ONLY: konversasjonell fitment-assistent (fitment-v1/conversation-v1).
    // Aktiv kun når env ASSISTANT_ENABLED=true|staging. Berører ALDRI prod-resolveren.
    const assistantEnabled = env.ASSISTANT_ENABLED === 'true' || env.ASSISTANT_ENABLED === 'staging';
    if (assistantEnabled && path.startsWith('/api/assistant')) {
      return await handleAssistant(request, env);
    }
    if (assistantEnabled && method === 'GET' && path === '/assistant') {
      return assistantUi();
    }
    if (assistantEnabled && method === 'GET' && path === '/ai') {
      return customerChatUi();
    }

    // Statiske undersider for GEO/SEO (ren URL → .html): «Bilglass uten forsikring», «Personvern»
    const STATISKE_SIDER = ['/bilglass-uten-forsikring', '/personvern', '/om-oss'];
    if (method === 'GET' && STATISKE_SIDER.includes(path)) {
      const html = await env.ASSETS.fetch(new Request(url.origin + path + '.html'));
      if (html.ok) return html;
    }

    // Alt annet (/, index.html, styles.css, app.js, …) → statiske assets fra public/
    const asset = await env.ASSETS.fetch(request);
    // Pen 404 for HTML-navigasjon (ukjente sider) — assets gir ellers tom 404
    if (asset.status === 404 && (request.headers.get('Accept') || '').includes('text/html')) {
      const notFound = await env.ASSETS.fetch(new Request(url.origin + '/404'));
      if (notFound.ok) {
        return new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }
    return asset;
  },
};
