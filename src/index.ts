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
import { featureEnabled, featureDisabled, erGyldigReviewDecision } from './evidence-features';
import { analyseEvidenceImage, createCaseId, isEvidenceImageType, MAX_EVIDENCE_IMAGE_BYTES, registrationHash, type EvidenceImageQuality, type EvidenceImageType } from './evidence-capture-v01';
import { canTransition, isSupportCaseStatus, legacyStatus, validReviewReason, type SupportCaseStatus } from './support-evidence-workflow';
import { canTransitionInquiry, isInquiryStatus, validInquiryReason, INQUIRY_STATUS_LABELS, type InquiryStatus } from './inquiry-workflow';
import { operationsCenterUi } from './ops-center-ui';
import { skuDecisionUi } from './sku-decision-ui';
import { godkjenningsGate, skrivBeslutning, skrivOverride, snapshotKandidatTilSku, type BeslutningType } from './approval/decisions';
import type { GlassAttributes } from './fitment-v1/glass-sku';
import { AccessoryApplicabilityEngine } from './accessory-v1/engine.js';
import { defaultRelations } from './accessory-v1/catalogue.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Frosset kundereise-snapshot (G9: vehicle_json i beta_inquiries). */
interface SnapshotVehicle {
  bil?: { merke?: string; modell?: string; vin?: string | null };
  resolver?: { kandidater?: Record<string, unknown>[] };
}

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

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function supportEvidenceUiLegacy(): Response {
  // The token is deliberately requested at runtime and is never embedded in an asset.
  return new Response(`<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finnbilglass support – Evidence</title><style>body{font:16px system-ui;margin:2rem;background:#f8fafc;color:#0f172a}main{max-width:900px;margin:auto}button,input{font:inherit;padding:.65rem}button{background:#f59e0b;border:0;border-radius:.4rem;font-weight:700}.case{background:white;border:1px solid #e2e8f0;border-radius:.6rem;padding:1rem;margin:1rem 0}.images{display:flex;gap:.7rem;flex-wrap:wrap}.images img{width:180px;max-height:140px;object-fit:cover;border-radius:.4rem;border:1px solid #e2e8f0}.muted{color:#64748b}</style><main><h1>Evidence Capture</h1><p class="muted">Internt supportverktøy. Bildene er evidens for manuell oppfølging, ikke en fitment-beslutning.</p><p><input id="token" type="password" placeholder="Support-token" autocomplete="current-password"><button id="load">Last saker</button></p><div id="out"></div><script>const out=document.querySelector('#out'),token=document.querySelector('#token');document.querySelector('#load').onclick=async()=>{out.textContent='Laster…';const h={Authorization:'Bearer '+token.value};const r=await fetch('/api/support/evidence',{headers:h});if(!r.ok){out.textContent=r.status===401?'Ingen tilgang.':'Kunne ikke hente saker.';return}const d=await r.json();out.innerHTML='';d.cases.forEach(c=>{const e=document.createElement('article');e.className='case';e.innerHTML='<b>'+c.caseId+'</b> · '+c.status+'<br><span class="muted">'+new Date(c.createdAt).toLocaleString('nb-NO')+' · '+c.imageCount+' bilde(r)</span>';const imgs=document.createElement('div');imgs.className='images';c.images.forEach(i=>{const a=document.createElement('a');a.href='/api/support/evidence/'+encodeURIComponent(c.caseId)+'/'+encodeURIComponent(i.imageId);a.target='_blank';const img=document.createElement('img');img.alt=i.imageType;fetch(a.href,{headers:h}).then(x=>x.blob()).then(b=>img.src=URL.createObjectURL(b));a.append(img);imgs.append(a)});e.append(imgs);out.append(e)});if(!d.cases.length)out.textContent='Ingen innsendte saker ennå.'}</script></main></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function supportEvidenceUi(): Response {
  return new Response(`<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finnbilglass support – Evidence</title><style>body{font:16px system-ui;margin:2rem;background:#f8fafc;color:#0f172a}main{max-width:960px;margin:auto}.case{background:#fff;border:1px solid #e2e8f0;border-radius:.6rem;padding:1rem;margin:1rem 0}.images{display:flex;gap:.7rem;flex-wrap:wrap}.images img{width:180px;max-height:140px;object-fit:cover;border-radius:.4rem;border:1px solid #e2e8f0}.q{display:block;margin-top:.25rem;color:#64748b;font-size:12px;max-width:180px}.muted{color:#64748b}.warn{color:#9a3412;font-weight:600}button,input,select,textarea{font:inherit;padding:.6rem}textarea{width:100%;box-sizing:border-box}button{background:#f59e0b;border:0;border-radius:.4rem;font-weight:700}label{display:block;margin:.5rem 0}.check{display:inline-block;margin-right:1rem}</style><main><h1>Evidence Capture</h1><p class="warn">Intern support. Kandidater er kun støtte og aldri en beslutning om glassvalg.</p><p><input id="token" type="password" placeholder="Support-token" autocomplete="current-password"><button id="load">Last saker</button></p><div id="out"></div><script>const out=document.querySelector('#out'),token=document.querySelector('#token'),statuses=['NEW','UNDER_REVIEW','NEEDS_CUSTOMER_INFO','CONFIRMED','REJECTED'];const h=()=>({Authorization:'Bearer '+token.value,'Content-Type':'application/json'});function esc(s){const e=document.createElement('span');e.textContent=s;return e.innerHTML}async function load(){out.textContent='Laster…';const r=await fetch('/api/support/evidence',{headers:h()});if(!r.ok){out.textContent=r.status===401?'Ingen tilgang.':'Kunne ikke hente saker.';return}const d=await r.json();out.innerHTML='';d.cases.forEach(c=>{const e=document.createElement('article');e.className='case';e.innerHTML='<b>'+esc(c.caseId)+'</b> · '+esc(c.status)+'<br><span class="muted">'+new Date(c.createdAt).toLocaleString('nb-NO')+' · '+c.imageCount+' bilde(r)</span><div class="images"></div><p><b>Sjekkliste</b><br>'+['Kjennemerke synlig','Frontrute synlig og skarp','Speil-/sensorområde synlig','Innvendig bilde vedlagt'].map((x,i)=>'<label class="check"><input type="checkbox" data-check="'+i+'" '+(c.checklist[i]?'checked':'')+'>'+x+'</label>').join('')+'</p><label>Status <select>'+statuses.map(s=>'<option '+(s===c.status?'selected':'')+'>'+s+'</option>').join('')+'</select></label><label>Ansvarlig <input value="support" maxlength="64"></label><label>Begrunnelse (maks 3 setninger)<textarea maxlength="600" placeholder="Kort begrunnelse for statusendringen"></textarea></label><button>Oppdater status</button><p class="muted">Kandidater: '+(c.candidates.length?c.candidates.map(x=>esc(x.varenr)).join(', '):'Ikke knyttet til saken')+' — ikke beslutning.</p><details><summary>Revisjonsspor</summary>'+c.history.map(x=>'<p>'+new Date(x.createdAt).toLocaleString('nb-NO')+' · '+esc(x.createdBy)+' · '+esc(x.previousStatus)+' → '+esc(x.status)+'<br>'+esc(x.reason)+'</p>').join('')+'</details>';const images=e.querySelector('.images');c.images.forEach(i=>{const wrap=document.createElement('div');const a=document.createElement('a');a.href='/api/support/evidence/'+encodeURIComponent(c.caseId)+'/'+encodeURIComponent(i.imageId);a.target='_blank';const img=document.createElement('img');img.alt=i.imageType;fetch(a.href,{headers:h()}).then(x=>x.blob()).then(b=>img.src=URL.createObjectURL(b));const q=document.createElement('span');q.className='q';const dims=i.quality&&i.quality.width?i.quality.width+'×'+i.quality.height:'ukjent størrelse';q.textContent=i.imageType+' · '+((i.quality&&i.quality.class)||'UNKNOWN')+' · '+dims;a.append(img);wrap.append(a,q);images.append(wrap)});e.querySelector('button').onclick=async()=>{const status=e.querySelector('select').value,actor=e.querySelector('input').value,reason=e.querySelector('textarea').value,checklist=[0,1,2,3].map(i=>e.querySelector('[data-check="'+i+'"]').checked);const r=await fetch('/api/support/evidence/'+encodeURIComponent(c.caseId)+'/status',{method:'POST',headers:h(),body:JSON.stringify({status,actor,reason,checklist})});if(!r.ok){alert((await r.json()).error||'Kunne ikke oppdatere');return}load()};out.append(e)});if(!d.cases.length)out.textContent='Ingen innsendte saker ennå.'}document.querySelector('#load').onclick=load;</script></main>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

/** Lagre bilde til R2 + metadata til D1 — aldri blokkerende. */
async function lagreOpplaeringBilde(
  env: Env,
  opts: {
    sessionId: string | null;
    type: 'skilt' | 'verify43r';
    imageDataUrl?: string;
    thumbnailDataUrl?: string | null;
    lesing?: Record<string, unknown>;
    fasit?: Record<string, unknown> | null;
    utfall: 'ok' | 'ikke_funnet' | 'feil';
  }
): Promise<void> {
  try {
    if (!env.OPPLAERING_BUCKET) return;
    let r2Key: string | null = null;
    let thumbR2Key: string | null = null;
    let mime: string | null = null;
    if (opts.imageDataUrl) {
      const parsed = dataUrlTilBytes(opts.imageDataUrl);
      if (parsed) {
        const ts = Date.now();
        const sid = opts.sessionId ?? 'anonym';
        r2Key = `${opts.type}/${sid}/${ts}.${parsed.ext}`;
        mime = parsed.mime;
        await env.OPPLAERING_BUCKET.put(r2Key, parsed.bytes, { httpMetadata: { contentType: parsed.mime } });
        // Thumbnail (Oppgave 7): nedskalert JPEG for raskere lasting i /ops/sku.
        if (opts.thumbnailDataUrl) {
          const thumb = dataUrlTilBytes(opts.thumbnailDataUrl);
          if (thumb) {
            thumbR2Key = `${opts.type}/${sid}/${ts}.thumb.${thumb.ext}`;
            await env.OPPLAERING_BUCKET.put(thumbR2Key, thumb.bytes, { httpMetadata: { contentType: thumb.mime } });
          }
        }
      }
    }
    await env.FINNBILGLASS_DB.prepare(
      `INSERT INTO opplaering_bilde (session_id, type, r2_key, thumb_r2_key, mime, lesing, fasit, utfall)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.sessionId,
      opts.type,
      r2Key,
      thumbR2Key,
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

    if (method === 'POST' && path === '/api/inquiry') {
      // Beta-henvendelse: kunden ber om tilbud/bekreftelse. Kun mottak + lagring.
      // Ingen prisberegning, ingen ordrebekreftelse, ingen automatisk beslutning.
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const b = body as Record<string, unknown>;
      const regnr = typeof b.regnr === 'string' ? b.regnr.trim().slice(0, 10) : '';
      const navn = typeof b.navn === 'string' ? b.navn.trim() : '';
      const kontakt = typeof b.kontakt === 'string' ? b.kontakt.trim() : '';
      const melding = typeof b.melding === 'string' ? b.melding.trim().slice(0, 500) : '';
      if (!navn || navn.length < 2) return json({ ok: false, error: 'Navn påkrevd (minst 2 tegn)' }, 400);
      if (!kontakt) return json({ ok: false, error: 'Telefon eller e-post påkrevd' }, 400);
      // Enkel validering: minst 8 siffer ELLER e-postformat.
      const sifre = kontakt.replace(/[^0-9]/g, '');
      const erTelefon = sifre.length >= 8;
      const erEpost = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontakt);
      if (!erTelefon && !erEpost) return json({ ok: false, error: 'Ugyldig telefon eller e-post' }, 400);
      // G12: abuse-beskyttelse — maks 5 henvendelser per IP per 10 min. Aldri blokkerende.
      try {
        const ip = geoAv(request).ip ?? 'ukjent';
        if (ip !== 'ukjent') {
          const WINDOW_MS = 10 * 60 * 1000;
          const MAX_PER_WINDOW = 5;
          const nowRl = Date.now();
          const rl = await env.FINNBILGLASS_DB.prepare('SELECT window_start, count FROM inquiry_rate_limits WHERE ip = ?').bind(ip).first<{ window_start: number; count: number }>();
          if (rl && nowRl - rl.window_start < WINDOW_MS && rl.count >= MAX_PER_WINDOW) {
            return json({ ok: false, error: 'For mange forespørsler. Prøv igjen senere.' }, 429);
          }
          if (rl) {
            if (nowRl - rl.window_start >= WINDOW_MS) {
              await env.FINNBILGLASS_DB.prepare('UPDATE inquiry_rate_limits SET window_start = ?, count = 1 WHERE ip = ?').bind(nowRl, ip).run();
            } else {
              await env.FINNBILGLASS_DB.prepare('UPDATE inquiry_rate_limits SET count = count + 1 WHERE ip = ?').bind(ip).run();
            }
          } else {
            await env.FINNBILGLASS_DB.prepare('INSERT INTO inquiry_rate_limits (ip, window_start, count) VALUES (?, ?, 1)').bind(ip, nowRl).run();
          }
        }
      } catch (e) {
        console.error('rate-limit feilet (non-blokkerende):', e);
      }
      // G9: frosset kundereise-snapshot — best-effort, aldri blokkerende.
      // Kunden så en bil + resolver-utfall + pris; fryses ved innsending slik at
      // saksbehandling i /ops har kontekst selv om session_id forsvinner.
      let vehicleJson: string | null = null;
      if (regnr) {
        try {
          const normRegnr = regnr.toUpperCase().replace(/[\s\-–—.]+/g, '');
          const bilSnap = await svvLookup(normRegnr, env.SVV_API_KEY);
          if (bilSnap) {
            let resolverSnap: unknown = null;
            try {
              resolverSnap = await resolveFrontrute(env, {
                merke: bilSnap.merke,
                modell: bilSnap.modell ?? undefined,
                aar: bilSnap.aar ?? undefined,
                vin: bilSnap.vin ?? undefined,
              });
            } catch {
              /* resolver-snapshot er ikke kritisk */
            }
            vehicleJson = JSON.stringify({
              bil: { merke: bilSnap.merke, modell: bilSnap.modell ?? null, aar: bilSnap.aar ?? null, vin: bilSnap.vin ?? null },
              resolver: resolverSnap,
              tattVedInnsending: Date.now(),
            });
          }
        } catch {
          /* kundereise-snapshot er best-effort */
        }
      }
      try {
        const inserted = await env.FINNBILGLASS_DB.prepare(
          'INSERT INTO beta_inquiries (regnr, navn, kontakt, melding, session_id, vehicle_json) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(regnr, navn, kontakt, melding, sessionId(body, request), vehicleJson).run();
        // Append-only 'created'-hendelse — starten på tidslinjen (G5).
        const id = inserted.meta?.last_row_id;
        if (id) {
          try {
            await env.FINNBILGLASS_DB.prepare(
              "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by) VALUES (?, ?, 'created', NULL, 'NEW', ?, ?, 'kunde')"
            ).bind(`created-${id}-${crypto.randomUUID()}`, id, melding || null, Date.now()).run();
          } catch (e) {
            console.error('inquiry-created-event feilet:', e);
          }
        }
        return json({ ok: true, inquiryId: id ?? null }, 201);
      } catch (e) {
        console.error('inquiry-lagring feilet:', e);
        return json({ ok: false, error: 'Kunne ikke lagre forespørselen. Prøv igjen.' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/accessories') {
      // P0.1 (Tom-doktrine): tilbehør er kandidat- og glassstyrt via
      // AccessoryApplicabilityEngine (deterministisk fasit, ikke if/else i UI).
      // Ingen relasjon dokumentert → ingen tilbehør. UNKNOWN/NOT_APPLICABLE
      // returneres men markeres — frontend viser dem aldri.
      const eng = new AccessoryApplicabilityEngine(defaultRelations());
      let body: unknown;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const varenr = typeof (body as Record<string, unknown>)?.varenr === 'string' ? (body as Record<string, unknown>).varenr as string : null;
      const eurokode = typeof (body as Record<string, unknown>)?.eurokode === 'string' ? (body as Record<string, unknown>).eurokode as string : null;
      const features = (body as Record<string, unknown>)?.features && typeof (body as Record<string, unknown>).features === 'object' ? (body as Record<string, unknown>).features as Record<string, unknown> : {};
      const fs = (body as Record<string, unknown>)?.fitmentStatus;
      if (!varenr && !eurokode) return json({ ok: false, error: 'varenr eller eurokode påkrevd' }, 400);
      const app = eng.evaluate({
        vehicleIdentity: null,
        applicationIdentity: null,
        selectedGlass: { glass: eurokode ?? '', varenr },
        glassFeatures: features as Record<string, string | boolean | null>,
        fitmentStatus: fs === 'EXACT' ? 'EXACT' : fs === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNKNOWN',
        verificationMode: null,
      });
      return json({
        ok: true,
        accessories: app.map((a) => ({
          accessory: { productId: a.accessory.productId, name: a.accessory.name, category: a.accessory.category, kind: a.accessory.kind },
          state: a.state,
          reason: a.reason,
          requiresInstallerConfirmation: !!a.requiresInstallerConfirmation,
          duplicateOfGlassComponent: !!a.duplicateOfGlassComponent,
        })),
      });
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
        const thumbRaw = (body as Record<string, unknown>)?.thumbnail;
        await lagreOpplaeringBilde(env, {
          sessionId: sid,
          type: 'skilt',
          imageDataUrl: imageRaw,
          thumbnailDataUrl: typeof thumbRaw === 'string' && thumbRaw.startsWith('data:image/') ? thumbRaw : null,
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
      if (!featureEnabled(env, 'EVIDENCE_UPLOAD_ENABLED')) return featureDisabled('EVIDENCE_UPLOAD_ENABLED');
      let body: unknown;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const b = isRecord(body) ? body : null;
      const registration = typeof b?.regnr === 'string' ? b.regnr : '';
      const images = Array.isArray(b?.images) ? b.images : [];
      if (!registration.trim()) return json({ ok: false, error: 'Kjennemerke påkrevd' }, 400);
      if (!images.length || images.length > 4) return json({ ok: false, error: 'Legg ved minst ett og maksimalt fire bilder' }, 400);
      if (!env.OPPLAERING_BUCKET) return json({ ok: false, error: 'Bildearkiv er ikke konfigurert' }, 503);
      const decoded: { type: EvidenceImageType; bytes: Uint8Array; mime: string; ext: string; quality: EvidenceImageQuality; thumbnail: string | null }[] = [];
      for (const image of images) {
        if (!isRecord(image) || !isEvidenceImageType(image.type) || typeof image.data !== 'string') return json({ ok: false, error: 'Ugyldig bildedata' }, 400);
        if (image.data.length > 7_000_000) return json({ ok: false, error: 'Et bilde er for stort (maks 5 MB)' }, 413);
        const parsed = dataUrlTilBytes(image.data);
        if (!parsed || !parsed.mime.startsWith('image/') || parsed.bytes.byteLength > MAX_EVIDENCE_IMAGE_BYTES) return json({ ok: false, error: 'Ugyldig bilde eller filen er for stor' }, 400);
        const quality = analyseEvidenceImage(parsed.bytes, parsed.mime);
        if (quality.qualityClass === 'REJECT') {
          return json({ ok: false, error: `Bildet ${image.type} kan ikke brukes: ${quality.reasonCodes.join(', ')}`, imageType: image.type, quality }, 422);
        }
        const thumbnail = typeof image.thumbnail === 'string' && image.thumbnail.startsWith('data:image/') ? image.thumbnail : null;
        decoded.push({ type: image.type, ...parsed, quality, thumbnail });
      }
      if (new Set(decoded.map((image) => image.type)).size !== decoded.length) return json({ ok: false, error: 'Hver bildetype kan bare sendes én gang' }, 400);
      const createdAt = Date.now();
      const hash = await registrationHash(registration);
      const caseId = createCaseId(new Date(createdAt));
      const sid = sessionId(body, request);
      let candidateSnapshot: unknown[] = [];
      const vehicle = isRecord(b?.vehicle) ? b.vehicle : null;
      if (typeof vehicle?.merke === 'string' && vehicle.merke.trim()) {
        try {
          const resolved = await resolveFrontrute(env, { merke: vehicle.merke.trim(), modell: typeof vehicle.modell === 'string' ? vehicle.modell.trim() : undefined, aar: typeof vehicle.aar === 'number' ? vehicle.aar : undefined });
          candidateSnapshot = (resolved.kandidater ?? []).slice(0, 12).map(k => ({ varenr: k.varenr, varenavn: k.varenavn, eurokode: k.eurokode, attributter: k.attributter }));
        } catch { /* Candidate support is optional and never blocks image capture. */ }
      }
      const records = decoded.map((image, index) => ({ image, imageId: `${caseId}-${index + 1}`, r2Key: `evidence-capture/${caseId}/${image.type}.${image.ext}`, thumbR2Key: image.thumbnail ? `evidence-capture/${caseId}/${image.type}.thumb.jpg` : null }));
      try {
        await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_cases (case_id, registration_hash, vehicle_identity_hash, created_at, session_id, status) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(caseId, hash, hash, createdAt, sid, 'NEW').run();
        await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_status_events (event_id, case_id, status, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
          .bind(`${caseId}-NEW`, caseId, 'NEW', createdAt, 'customer').run();
        await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_review_events (event_id, case_id, previous_status, status, created_at, created_by, reason, checklist_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(`${caseId}-NEW`, caseId, 'NEW', 'NEW', createdAt, 'customer', 'Kunde sendte inn dokumentasjon.', '{}').run();
        if (candidateSnapshot.length) await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_candidate_snapshots (case_id, created_at, candidates_json) VALUES (?, ?, ?)').bind(caseId, createdAt, JSON.stringify(candidateSnapshot)).run();
        for (const record of records) {
          await env.OPPLAERING_BUCKET.put(record.r2Key, record.image.bytes, { httpMetadata: { contentType: record.image.mime } });
          if (record.thumbR2Key && record.image.thumbnail) {
            const thumb = dataUrlTilBytes(record.image.thumbnail);
            if (thumb) await env.OPPLAERING_BUCKET.put(record.thumbR2Key, thumb.bytes, { httpMetadata: { contentType: thumb.mime } });
          }
          await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_images (image_id, case_id, image_type, r2_key, thumb_r2_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(record.imageId, caseId, record.image.type, record.r2Key, record.thumbR2Key, record.image.mime, createdAt).run();
          await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_image_quality_events (event_id, image_id, case_id, quality_class, reason_codes_json, width, height, byte_length, mime, analysis_version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(`${record.imageId}-quality-v1`, record.imageId, caseId, record.image.quality.qualityClass, JSON.stringify(record.image.quality.reasonCodes), record.image.quality.width, record.image.quality.height, record.image.quality.byteLength, record.image.quality.mime, record.image.quality.analysisVersion, createdAt, 'system').run();
        }
      } catch (e) {
        console.error('evidence-capture lagring feilet:', e);
        return json({ ok: false, error: 'Kunne ikke lagre bildene. Prøv igjen.' }, 500);
      }
      return json({ ok: true, caseId, status: 'NEW', imageCount: records.length, decisionAuthority: 'NONE' }, 201);
    }

    if (method === 'GET' && path === '/ops') {
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      return operationsCenterUi();
    }
    if (method === 'GET' && path === '/api/ops/summary') {
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const statuses = await env.FINNBILGLASS_DB.prepare(`WITH review_latest AS (
        SELECT case_id, status, ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY created_at DESC) AS n
        FROM evidence_case_review_events
      ),
      all_cases AS (
        SELECT c.case_id,
               COALESCE(r.status, CASE c.status WHEN 'REVIEWING' THEN 'UNDER_REVIEW' WHEN 'NEEDS_MORE_DATA' THEN 'NEEDS_CUSTOMER_INFO' WHEN 'COMPLETE' THEN 'CONFIRMED' ELSE 'NEW' END) AS status
        FROM evidence_cases c
        LEFT JOIN review_latest r ON r.case_id = c.case_id AND r.n = 1
      )
      SELECT status, COUNT(*) AS n FROM all_cases GROUP BY status`).all<{ status: string; n: number }>();
      const byStatus = new Map(statuses.results.map(x => [x.status, x.n]));
      const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
      let aiObservations = 0;
      try { aiObservations = (await env.FINNBILGLASS_DB.prepare('SELECT COUNT(*) AS n FROM evidence_events').first<{ n: number }>())?.n ?? 0; } catch { /* ledger may be intentionally absent in a new staging database */ }
      let inquiries = 0;
      let latestInquiries: { id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; created_at: string; status: string }[] = [];
      let inquiryStatus: Record<string, number> = {};
      try {
        const q = await env.FINNBILGLASS_DB.prepare('SELECT id, regnr, navn, kontakt, melding, created_at, status FROM beta_inquiries ORDER BY (status = \'NEW\') DESC, created_at DESC LIMIT 10').all<{ id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; created_at: string; status: string }>();
        latestInquiries = q.results;
        inquiries = (await env.FINNBILGLASS_DB.prepare('SELECT COUNT(*) AS n FROM beta_inquiries').first<{ n: number }>())?.n ?? latestInquiries.length;
        const st = await env.FINNBILGLASS_DB.prepare('SELECT status, COUNT(*) AS n FROM beta_inquiries GROUP BY status').all<{ status: string; n: number }>();
        for (const r of st.results) inquiryStatus[r.status] = r.n;
      } catch { /* beta_inquiries krever migrasjon 0017 — eldre staging-DB uten tabellen er ok */ }
      return json({ ok: true, environment: env.ENVIRONMENT, cases: total, newCases: byStatus.get('NEW') ?? 0, needsInfo: byStatus.get('NEEDS_CUSTOMER_INFO') ?? 0, confirmed: byStatus.get('CONFIRMED') ?? 0, aiObservations, inquiries, inquiryStatus, latestInquiries, d1: 'tilkoblet', r2: env.OPPLAERING_BUCKET ? 'tilkoblet' : 'ikke konfigurert', fitmentAuthority: 'ingen — menneskelig beslutning kreves' });
    }
    if (method === 'GET' && path === '/api/ops/inquiries') {
      // Beta-henvendelser med statusfilter + paginering (G8). Lesing er åpent i staging+prod (som summary).
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const url = new URL(request.url);
      const statusFilter = url.searchParams.get('status') ?? '';
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1), 200);
      const offset = Math.max(Number(url.searchParams.get('offset') ?? '0') || 0, 0);
      let where = '';
      const bind: unknown[] = [];
      if (statusFilter) {
        if (!isInquiryStatus(statusFilter)) return json({ ok: false, error: 'Ugyldig statusfilter' }, 400);
        where = 'WHERE status = ?';
        bind.push(statusFilter);
      }
      bind.push(limit, offset);
      const rows = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, navn, kontakt, melding, status, assigned_to, created_at, updated_at FROM beta_inquiries ${where} ORDER BY (status = 'NEW') DESC, created_at DESC LIMIT ? OFFSET ?`).bind(...bind).all<{ id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; status: string; assigned_to: string | null; created_at: string; updated_at: number | null }>();
      return json({ ok: true, inquiries: rows.results.map(r => ({ ...r, status: isInquiryStatus(r.status) ? r.status : 'NEW' })) });
    }
    if (method === 'GET' && path.startsWith('/api/ops/inquiries/')) {
      // Saksdetalj: én inquiry + append-only tidslinje + kundereise-kontekst (G3, G5, G9).
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const idRaw = path.slice('/api/ops/inquiries/'.length).split('/')[0];
      if (!/^\d+$/.test(idRaw)) return json({ ok: false, error: 'Ugyldig id' }, 400);
      const id = Number(idRaw);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT id, regnr, navn, kontakt, melding, status, assigned_to, vehicle_json, session_id, created_at, updated_at FROM beta_inquiries WHERE id = ?').bind(id).first<{ id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; status: string; assigned_to: string | null; vehicle_json: string | null; session_id: string | null; created_at: string; updated_at: number | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      const events = await env.FINNBILGLASS_DB.prepare('SELECT event_type, previous_status, status, note, created_at, created_by, meta_json FROM beta_inquiry_events WHERE inquiry_id = ? ORDER BY created_at ASC').bind(id).all<{ event_type: string; previous_status: string | null; status: string | null; note: string | null; created_at: number; created_by: string; meta_json: string | null }>();
      let vehicle = null;
      try { if (row.vehicle_json) vehicle = JSON.parse(row.vehicle_json); } catch { /* ugyldig snapshot = ignorert */ }
      return json({ ok: true, inquiry: { ...row, status: isInquiryStatus(row.status) ? row.status : 'NEW', vehicle, history: events.results.map(e => { let meta: unknown = null; try { if (e.meta_json) meta = JSON.parse(e.meta_json); } catch { /* ugyldig meta = ignorert */ } return { ...e, meta }; }) } });
    }
    const inquiryStatusMatch = /^\/api\/ops\/inquiries\/(\d+)\/status$/.exec(path);
    if (method === 'POST' && inquiryStatusMatch) {
      // Statusendring er skriving — åpen i staging+prod (beta er live, Tom er eneste operatør).
      // Beskyttet av support-token + append-only-displin. Aldri fitment-autoritet.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const to = body.status, actor = typeof body.actor === 'string' ? body.actor.trim() : '', reason = body.reason;
      if (!isInquiryStatus(to) || !/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !validInquiryReason(reason)) return json({ ok: false, error: 'Status, ansvarlig og kort begrunnelse er påkrevd.' }, 400);
      const id = Number(inquiryStatusMatch[1]);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT status FROM beta_inquiries WHERE id = ?').bind(id).first<{ status: string }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      const from: InquiryStatus = isInquiryStatus(row.status) ? row.status : 'NEW';
      if (!canTransitionInquiry(from, to)) return json({ ok: false, error: `Overgang fra ${from} til ${to} er ikke tillatt.` }, 409);
      const meta = typeof body.meta === 'object' && body.meta !== null ? JSON.stringify(body.meta) : '{}';
      const now = Date.now();
      await env.FINNBILGLASS_DB.batch([
        env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by, meta_json) VALUES (?, ?, 'status', ?, ?, ?, ?, ?, ?)").bind(`status-${id}-${now}-${crypto.randomUUID()}`, id, from, to, reason.trim(), now, actor, meta),
        env.FINNBILGLASS_DB.prepare('UPDATE beta_inquiries SET status = ?, updated_at = ?, assigned_to = ? WHERE id = ?').bind(to, now, actor, id),
      ]);
      return json({ ok: true, status: to });
    }
    const inquiryNoteMatch = /^\/api\/ops\/inquiries\/(\d+)\/notes$/.exec(path);
    if (method === 'POST' && inquiryNoteMatch) {
      // Internt notat — append-only, aldri synlig i kundeflyten. Åpen i staging+prod som status.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const actor = typeof body.actor === 'string' ? body.actor.trim() : '', note = body.note;
      if (!/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !validInquiryReason(note)) return json({ ok: false, error: 'Ansvarlig og notat er påkrevd.' }, 400);
      const id = Number(inquiryNoteMatch[1]);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT id FROM beta_inquiries WHERE id = ?').bind(id).first<{ id: number }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      const now = Date.now();
      await env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by) VALUES (?, ?, 'note', ?, ?, ?)").bind(`note-${id}-${now}-${crypto.randomUUID()}`, id, note.trim(), now, actor).run();
      return json({ ok: true });
    }
    if (method === 'GET' && path === '/ops/sku') {
      // Operatørflate for SKU-godkjenning (Oppgave 3) — staging+prod, token-gate i UI-et.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      return skuDecisionUi();
    }
    if (method === 'GET' && path === '/api/ops/thumb') {
      // Thumbnail-serving (Oppgave 7): nedskalert skilt-bilde for raskere
      // lasting i /ops/sku. Token-beskyttet; nøkkelen er kun fra D1 (aldri brukerstyrt).
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      if (!env.OPPLAERING_BUCKET) return json({ ok: false, error: 'Bildearkiv er ikke konfigurert' }, 503);
      const key = new URL(request.url).searchParams.get('key') ?? '';
      if (!key) return json({ ok: false, error: 'Mangler key' }, 400);
      const object = await env.OPPLAERING_BUCKET.get(key);
      if (!object) return json({ ok: false, error: 'Bilde mangler' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, no-store' } });
    }
    if (method === 'GET' && path === '/api/ops/ai-observasjoner') {
      // AI-støtte-fanen: lese/triaging-flate over AI-observasjoner av opplastede
      // bilder (skilt/43R) + siste operatør-review. Token-beskyttet, lesing.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const observasjoner: unknown[] = [];
      try {
        const rows = await env.FINNBILGLASS_DB.prepare(
          'SELECT id, session_id, type, r2_key, thumb_r2_key, lesing, utfall, created_at FROM opplaering_bilde ORDER BY id DESC LIMIT 200',
        ).all<{ id: number; session_id: string | null; type: string; r2_key: string; thumb_r2_key: string | null; lesing: string | null; utfall: string; created_at: string }>();
        for (const r of rows.results ?? []) {
          let lesing: unknown = null;
          try { if (r.lesing) lesing = JSON.parse(r.lesing); } catch { /* ugyldig JSON */ }
          const review = await env.FINNBILGLASS_DB.prepare(
            'SELECT decision, notat, actor, created_at FROM ai_observasjon_review WHERE bilde_id = ? ORDER BY id DESC LIMIT 1',
          ).bind(r.id).first<{ decision: string; notat: string | null; actor: string; created_at: string }>();
          observasjoner.push({
            id: r.id,
            type: r.type,
            thumbUrl: `/api/ops/thumb?key=${encodeURIComponent(r.thumb_r2_key ?? r.r2_key)}`,
            fullUrl: `/api/ops/thumb?key=${encodeURIComponent(r.r2_key)}`,
            lesing,
            utfall: r.utfall,
            createdAt: r.created_at,
            review: review ?? null,
          });
        }
      } catch { /* opplaering_bilde er valgfri — tabellen kan mangle i ny staging-DB */ }
      // Evidenssaker (evidence_cases): supportdokumentasjon med kildebilder +
      // kandidatdata. Leses i samme AI-støtte-fane, men review går via
      // evidence_case_review_events (append-only, token-gate).
      let evidenssaker: unknown[] = [];
      try {
        const cases = await env.FINNBILGLASS_DB.prepare('SELECT case_id, created_at, status FROM evidence_cases ORDER BY created_at DESC LIMIT 50').all<{ case_id: string; created_at: number; status: string }>();
        for (const c of cases.results ?? []) {
          const images = await env.FINNBILGLASS_DB.prepare('SELECT image_id, image_type, r2_key, thumb_r2_key FROM evidence_case_images WHERE case_id = ? ORDER BY created_at').bind(c.case_id).all<{ image_id: string; image_type: string; r2_key: string; thumb_r2_key: string | null }>();
          const snap = await env.FINNBILGLASS_DB.prepare('SELECT candidates_json FROM evidence_case_candidate_snapshots WHERE case_id = ?').bind(c.case_id).first<{ candidates_json: string }>();
          let kandidater: unknown[] = [];
          try { kandidater = snap ? JSON.parse(snap.candidates_json) : []; } catch { /* ugyldig */ }
          const latest = await env.FINNBILGLASS_DB.prepare('SELECT status, created_by, reason FROM evidence_case_review_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').bind(c.case_id).first<{ status: string; created_by: string; reason: string }>();
          evidenssaker.push({
            caseId: c.case_id,
            createdAt: c.created_at,
            status: c.status,
            kandidater: Array.isArray(kandidater) ? kandidater.slice(0, 6) : [],
            images: (images.results ?? []).map(i => ({ imageId: i.image_id, imageType: i.image_type, thumbUrl: `/api/ops/thumb?key=${encodeURIComponent(i.thumb_r2_key ?? i.r2_key)}`, fullUrl: `/api/ops/thumb?key=${encodeURIComponent(i.r2_key)}` })),
            sisteReview: latest ?? null,
          });
        }
      } catch { /* evidenssaker er valgfri — tabellen kan mangle i ny staging-DB */ }
      return json({ ok: true, observasjoner, evidenssaker });
    }
    if (method === 'POST' && path === '/api/ops/observasjon') {
      // Operatør-gjennomgang av én AI-observasjon (append-only): godkjenn
      // (→ evidens, evidence_events VERIFIED) eller avvis. Aldri en
      // fitment-beslutning — kun om observasjonen kan brukes som evidens.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const bildeId = Number(body.bilde_id);
      const decision = String(body.decision ?? '');
      const notat = typeof body.notat === 'string' ? body.notat.trim().slice(0, 600) : '';
      const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
      if (!Number.isInteger(bildeId) || !erGyldigReviewDecision(decision)) return json({ ok: false, error: 'Ugyldig bilde-id eller beslutning.' }, 400);
      if (!/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor)) return json({ ok: false, error: 'Ansvarlig er påkrevd.' }, 400);
      const bilde = await env.FINNBILGLASS_DB.prepare('SELECT id, type, session_id FROM opplaering_bilde WHERE id = ?').bind(bildeId).first<{ id: number; type: string; session_id: string | null }>();
      if (!bilde) return json({ ok: false, error: 'Bildet finnes ikke.' }, 404);
      await env.FINNBILGLASS_DB.prepare('INSERT INTO ai_observasjon_review (bilde_id, decision, notat, actor) VALUES (?, ?, ?, ?)').bind(bildeId, decision, notat || null, actor).run();
      if (decision === 'godkjenn') {
        const now = Date.now();
        await env.FINNBILGLASS_DB.prepare(
          "INSERT INTO evidence_events (id, vehicle_identity_hash, created_at, source_type, evidence_type, value, confidence, status, created_by, notes) VALUES (?, ?, ?, 'SYSTEM', 'OTHER', ?, 100, 'VERIFIED', ?, ?)",
        ).bind(`evt-ai-${bildeId}-${now}`, `ai-obs-${bilde.session_id ?? 'anonym'}-${bilde.type}`, now, bilde.type, 'system', `godkjent AI-observasjon (type=${bilde.type}) av ${actor}${notat ? ' — ' + notat : ''}`).run();
      }
      return json({ ok: true, decision, bildeId });
    }
    if (method === 'GET' && path === '/api/ops/sku-cases') {
      // SKU-beslutningsflate (Oppgave 3): henvendelser med kundereise-snapshot
      // (resolver-kandidater) + siste beslutning. Token-beskyttet, lesing.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const rows = await env.FINNBILGLASS_DB.prepare(
        `SELECT id, regnr, status, vehicle_json, session_id, created_at FROM beta_inquiries
         WHERE vehicle_json IS NOT NULL AND vehicle_json != ''
         ORDER BY (status = 'NEW') DESC, created_at DESC LIMIT 100`,
      ).all<{ id: number; regnr: string | null; status: string; vehicle_json: string; session_id: string | null; created_at: string }>();
      const result = [];
      for (const r of rows.results ?? []) {
        let vehicle = null;
        try { vehicle = JSON.parse(r.vehicle_json); } catch { continue; }
        const kandidater = Array.isArray(vehicle?.resolver?.kandidater) ? vehicle.resolver.kandidater : [];
        const beslutning = await env.FINNBILGLASS_DB.prepare(
          'SELECT decision_type, sku, eurocode, reason, created_by, created_at FROM case_sku_decisions WHERE case_id = ? ORDER BY created_at DESC LIMIT 1',
        ).bind(String(r.id)).first<{ decision_type: string; sku: string | null; eurocode: string | null; reason: string | null; created_by: string; created_at: string }>();
        // Thumbnail av skilt-foto (Oppgave 7) — fallback til full-bilde hvis ingen thumb.
        let thumbUrl: string | null = null;
        if (r.session_id) {
          const b = await env.FINNBILGLASS_DB.prepare(
            "SELECT r2_key, thumb_r2_key FROM opplaering_bilde WHERE session_id = ? AND type = 'skilt' AND r2_key IS NOT NULL ORDER BY created_at DESC LIMIT 1",
          ).bind(r.session_id).first<{ r2_key: string; thumb_r2_key: string | null }>();
          if (b) thumbUrl = `/api/ops/thumb?key=${encodeURIComponent(b.thumb_r2_key ?? b.r2_key)}`;
        }
        result.push({ id: r.id, regnr: r.regnr, status: r.status, createdAt: r.created_at, kandidater, sisteBeslutning: beslutning ?? null, thumbUrl });
      }
      return json({ ok: true, cases: result });
    }
    if (method === 'POST' && path === '/api/ops/decision') {
      // Operatør-beslutning (Oppgave 3): godkjenn SKU / be om bedre bilde /
      // velg alternativ SKU / avslå. Append-only; overrides logges i
      // evidence_events. «godkjenn SKU» passerer godkjenningsGate (hard regel 1).
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const idRaw = body.inquiry_id;
      const decision = String(body.decision ?? '');
      const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const sku = typeof body.sku === 'string' && body.sku ? body.sku.trim() : null;
      const eurocode = typeof body.eurocode === 'string' && body.eurocode ? body.eurocode.trim() : null;
      const attrs = (typeof body.attributes === 'object' && body.attributes !== null) ? (body.attributes as Record<string, unknown>) : null;
      if (!/^\d+$/.test(String(idRaw ?? '')) || !['approve_sku', 'request_better_image', 'choose_alternative_sku', 'reject'].includes(decision)) {
        return json({ ok: false, error: 'Ugyldig henvendelse-id eller beslutningstype.' }, 400);
      }
      if (!/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !validInquiryReason(reason)) {
        return json({ ok: false, error: 'Ansvarlig og kort begrunnelse er påkrevd.' }, 400);
      }
      const id = Number(idRaw);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT id, regnr, status, vehicle_json FROM beta_inquiries WHERE id = ?').bind(id).first<{ id: number; regnr: string | null; status: string; vehicle_json: string | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);

      // Kundereise-snapshot → kandidater for policy-sjekk.
      let vehicle: SnapshotVehicle | null = null;
      try { if (row.vehicle_json) vehicle = JSON.parse(row.vehicle_json) as SnapshotVehicle; } catch { /* ugyldig snapshot */ }
      const snapshotKandidater = (Array.isArray(vehicle?.resolver?.kandidater) ? vehicle.resolver.kandidater : []) as Record<string, unknown>[];
      const kandidater = snapshotKandidater.map((k) => snapshotKandidatTilSku(k));
      const make = String(vehicle?.bil?.merke ?? '').toUpperCase() || 'UKJENT';
      const modelSeries = String(vehicle?.bil?.modell ?? '') || null;
      const vin = (vehicle?.bil?.vin as string | null) ?? null;
      const bevis = attrs ? (attrs as Partial<GlassAttributes>) : {};

      const now = Date.now();
      if (decision === 'request_better_image') {
        await env.FINNBILGLASS_DB.batch([
          env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by) VALUES (?, ?, 'status', ?, 'NEEDS_INFO', ?, ?, ?)").bind(`status-${id}-${now}-${crypto.randomUUID()}`, id, row.status, reason, now, actor),
          env.FINNBILGLASS_DB.prepare('UPDATE beta_inquiries SET status = ?, updated_at = ?, assigned_to = ? WHERE id = ?').bind('NEEDS_INFO', now, actor, id),
        ]);
        await skrivBeslutning(env, { caseId: String(id), decision: decision as BeslutningType, reason, actor });
        return json({ ok: true, status: 'NEEDS_INFO' });
      }
      if (decision === 'reject') {
        await env.FINNBILGLASS_DB.batch([
          env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by) VALUES (?, ?, 'status', ?, 'REJECTED', ?, ?, ?)").bind(`status-${id}-${now}-${crypto.randomUUID()}`, id, row.status, reason, now, actor),
          env.FINNBILGLASS_DB.prepare('UPDATE beta_inquiries SET status = ?, updated_at = ?, assigned_to = ? WHERE id = ?').bind('REJECTED', now, actor, id),
        ]);
        await skrivBeslutning(env, { caseId: String(id), decision: decision as BeslutningType, reason, actor });
        return json({ ok: true, status: 'REJECTED' });
      }
      // approve_sku / choose_alternative_sku: krever sku-valg som finnes i kandidatene.
      if (!sku) return json({ ok: false, error: 'SKU er påkrevd for godkjenning.' }, 400);
      const valgt = snapshotKandidater.find((k) =>
        String(k.varenr ?? '') === sku || String(k.eurokode ?? '') === (eurocode ?? '') ||
        (eurocode && String(k.eurokode ?? '') === eurocode),
      );
      if (!valgt && !kandidater.length) return json({ ok: false, error: 'Saken har ingen kandidater å godkjenne.' }, 409);
      const valgtEuro = String(valgt?.eurocode ?? eurocode ?? '') || null;

      if (decision === 'approve_sku') {
        const vurdering = godkjenningsGate(kandidater, bevis);
        if (vurdering.status !== 'approved') {
          return json({ ok: false, status: 'needs_verification', error: `Kan ikke godkjenne automatisk: ${vurdering.grunn.join('; ')}. Bruk «velg alternativ SKU» for eksplisitt operatørvalg.` }, 422);
        }
      }
      // Felles for approve_sku (etter gate) og choose_alternative_sku (operatørvalg):
      const { overrideId } = await skrivOverride(env, {
        vin, make, modelSeries, attrs: bevis, sku, eurocode: valgtEuro, actor,
        notes: `${decision}${valgt ? ` — kandidat fra sak ${row.regnr ?? ''}` : ''}${reason ? ` — ${reason}` : ''}`,
      });
      await skrivBeslutning(env, { caseId: String(id), decision: decision as BeslutningType, sku, eurocode: valgtEuro, reason, actor });
      await env.FINNBILGLASS_DB.batch([
        env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by, meta_json) VALUES (?, ?, 'status', ?, 'CONFIRMED', ?, ?, ?, ?)").bind(`status-${id}-${now}-${crypto.randomUUID()}`, id, row.status, `${decision}: ${sku}${valgtEuro ? ` (${valgtEuro})` : ''}${reason ? ` — ${reason}` : ''}`, now, actor, JSON.stringify({ overrideId })),
        env.FINNBILGLASS_DB.prepare('UPDATE beta_inquiries SET status = ?, updated_at = ?, assigned_to = ? WHERE id = ?').bind('CONFIRMED', now, actor, id),
      ]);
      return json({ ok: true, status: 'CONFIRMED', overrideId });
    }
    if (method === 'GET' && path === '/support/evidence') {
      // Behandlingsflaten (statusendring/sjekkliste) styres av feature-flag.
      if (!featureEnabled(env, 'EVIDENCE_REVIEW_ENABLED')) return featureDisabled('EVIDENCE_REVIEW_ENABLED');
      return supportEvidenceUi();
    }
    if (method === 'GET' && path === '/api/support/evidence') {
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const cases = await env.FINNBILGLASS_DB.prepare('SELECT case_id, created_at, status FROM evidence_cases ORDER BY created_at DESC LIMIT 100').all<{ case_id: string; created_at: number; status: string }>();
      const result = [];
      for (const c of cases.results) {
        let images: { results: { image_id: string; image_type: string; quality_class: string | null; reason_codes_json: string | null; width: number | null; height: number | null; byte_length: number | null }[] };
        try {
          images = await env.FINNBILGLASS_DB.prepare(`WITH latest_quality AS (
            SELECT image_id, quality_class, reason_codes_json, width, height, byte_length,
                   ROW_NUMBER() OVER (PARTITION BY image_id ORDER BY created_at DESC) AS n
            FROM evidence_case_image_quality_events
            WHERE case_id = ?
          )
          SELECT i.image_id, i.image_type, q.quality_class, q.reason_codes_json, q.width, q.height, q.byte_length
          FROM evidence_case_images i
          LEFT JOIN latest_quality q ON q.image_id = i.image_id AND q.n = 1
          WHERE i.case_id = ?
          ORDER BY i.created_at`).bind(c.case_id, c.case_id).all<{ image_id: string; image_type: string; quality_class: string | null; reason_codes_json: string | null; width: number | null; height: number | null; byte_length: number | null }>();
        } catch {
          const legacyImages = await env.FINNBILGLASS_DB.prepare('SELECT image_id, image_type FROM evidence_case_images WHERE case_id = ? ORDER BY created_at').bind(c.case_id).all<{ image_id: string; image_type: string }>();
          images = { results: legacyImages.results.map(i => ({ ...i, quality_class: null, reason_codes_json: null, width: null, height: null, byte_length: null })) };
        }
        const events = await env.FINNBILGLASS_DB.prepare('SELECT previous_status, status, created_at, created_by, reason, checklist_json FROM evidence_case_review_events WHERE case_id = ? ORDER BY created_at DESC').bind(c.case_id).all<{ previous_status: string; status: string; created_at: number; created_by: string; reason: string; checklist_json: string }>();
        const snapshot = await env.FINNBILGLASS_DB.prepare('SELECT candidates_json FROM evidence_case_candidate_snapshots WHERE case_id = ?').bind(c.case_id).first<{ candidates_json: string }>();
        const current = events.results[0]?.status;
        const checklist = events.results[0] ? (() => { try { const x = JSON.parse(events.results[0].checklist_json); return Array.isArray(x) ? x.map(Boolean).slice(0, 4) : []; } catch { return []; } })() : [];
        const candidates = (() => { try { const x = snapshot ? JSON.parse(snapshot.candidates_json) : []; return Array.isArray(x) ? x : []; } catch { return []; } })();
        result.push({ caseId: c.case_id, createdAt: c.created_at, status: isSupportCaseStatus(current) ? current : legacyStatus(c.status), imageCount: images.results.length, images: images.results.map(i => ({ imageId: i.image_id, imageType: i.image_type, quality: { class: i.quality_class ?? 'UNKNOWN', reasonCodes: parseJsonArray(i.reason_codes_json), width: i.width, height: i.height, byteLength: i.byte_length } })), checklist, candidates, history: events.results.reverse().map(e => ({ previousStatus: e.previous_status, status: e.status, createdAt: e.created_at, createdBy: e.created_by, reason: e.reason })) });
      }
      return json({ ok: true, cases: result });
    }
    const statusMatch = /^\/api\/support\/evidence\/([^/]+)\/status$/.exec(path);
    if (method === 'POST' && statusMatch) {
      // Statusendring er skriving — styres av feature-flag (append-only, token-gate).
      if (!featureEnabled(env, 'EVIDENCE_STATUS_CHANGE_ENABLED')) return featureDisabled('EVIDENCE_STATUS_CHANGE_ENABLED');
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const to = body.status, actor = typeof body.actor === 'string' ? body.actor.trim() : '', reason = body.reason;
      if (!isSupportCaseStatus(to) || !/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !validReviewReason(reason)) return json({ ok: false, error: 'Status, ansvarlig og kort begrunnelse er påkrevd.' }, 400);
      const c = await env.FINNBILGLASS_DB.prepare('SELECT status FROM evidence_cases WHERE case_id = ?').bind(statusMatch[1]).first<{ status: string }>();
      if (!c) return json({ ok: false, error: 'Saken finnes ikke.' }, 404);
      const latest = await env.FINNBILGLASS_DB.prepare('SELECT status FROM evidence_case_review_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').bind(statusMatch[1]).first<{ status: string }>();
      const from: SupportCaseStatus = isSupportCaseStatus(latest?.status) ? latest.status : legacyStatus(c.status);
      if (!canTransition(from, to)) return json({ ok: false, error: `Overgang fra ${from} til ${to} er ikke tillatt.` }, 409);
      const checklist = Array.isArray(body.checklist) ? body.checklist.slice(0, 4).map(Boolean) : [];
      const now = Date.now();
      await env.FINNBILGLASS_DB.prepare('INSERT INTO evidence_case_review_events (event_id, case_id, previous_status, status, created_at, created_by, reason, checklist_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(`${statusMatch[1]}-${now}-${crypto.randomUUID()}`, statusMatch[1], from, to, now, actor, reason.trim(), JSON.stringify(checklist)).run();
      return json({ ok: true, status: to, decisionAuthority: 'NONE' });
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
    if (method === 'GET' && path === '/') {
      const index = await env.ASSETS.fetch(request);
      return new Response(index.body, {
        status: index.status,
        headers: {
          ...Object.fromEntries(index.headers),
          'Cache-Control': 'no-store',
        },
      });
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
