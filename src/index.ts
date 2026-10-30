import { commercialRoute } from './inquiry-commercial';
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
import { finnValgtSnapshotKandidat, godkjenningsGate, skrivBeslutning, skrivOverride, snapshotKandidatTilSku, type BeslutningType } from './approval/decisions';
import type { GlassAttributes } from './fitment-v1/glass-sku';
import { AccessoryApplicabilityEngine } from './accessory-v1/engine.js';
import { defaultRelations } from './accessory-v1/catalogue.js';
import { konsoliderSaker, type InquiryRow, type EvidenceCaseRow } from './ops-consolidation';
import { handleInboundEmail } from './email-ingest';
import { closeVoiceSession, createVoiceSession, voiceSummary, voiceTool } from './voice-lab';
import { voiceLabUi } from './voice-lab-ui';
import { publicFrontruteDto, publicVehicleLookupDto } from './customer-price-gate';
import { parseGlassRequest, type GlassRequest } from './glass-selection';
import { isValidClientRequestId, persistInquiry } from './inquiry-glass-request';
import { glassRequestFingerprint } from './glass-search';
import { searchGlass } from './glass-search';

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

/** Reject broad catalogue hits that name a different model family. A single
 * row is not enough evidence when the catalogue matched only on make/year. */
function resolverMatchesVehicleModel(make: string | null | undefined, model: string | null | undefined, candidates: Array<{ varenavn?: string | null; varenr?: string | null }> | undefined): boolean {
  if (!model || !candidates?.length) return true;
  const brand = String(make ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const normalizedModel = model.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const modelKey = brand && normalizedModel.startsWith(brand) ? normalizedModel.slice(brand.length) : normalizedModel;
  if (modelKey.length < 3 || /^\d{4}$/.test(modelKey)) return true;
  return candidates.every((candidate) => {
    const name = String(candidate.varenavn ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    return name.includes(modelKey) || (modelKey.length >= 5 && name.includes(modelKey.slice(0, 5)));
  });
}

/** Known generation boundary: old Vito 2036/2568 families are W638/W639,
 * never W447 vehicles from 2014 onward. If the catalogue lacks W447 proof,
 * force manual review instead of surfacing an old-family glass. */
function resolverMatchesVehicleGeneration(make: string | null | undefined, model: string | null | undefined, year: number | null | undefined, candidates: Array<{ varenr?: string | null }> | undefined): boolean {
  const m = String(make ?? '').toUpperCase();
  const v = String(model ?? '').toUpperCase();
  if (!m.includes('MERCEDES') || !/\bVITO\b/.test(v) || year == null || year < 2014 || !candidates?.length) return true;
  return candidates.every((candidate) => !/^(2036|2568)/.test(String(candidate.varenr ?? '').toUpperCase()));
}

function manualFitmentResponse(message = 'Vi fant ikke en sikker variant ut fra bildataene. Send oss en forespørsel, så kontrollerer vi frontruten manuelt.') {
  return { ok: true, pinpoint: false, anbefaling: null, kandidater: [], meta: { resolver: true }, message };
}

async function inquiryHasGlassRequestColumn(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('SELECT glass_request_json FROM beta_inquiries LIMIT 0').all();
    return true;
  } catch {
    return false;
  }
}

async function medResolverModus(env: Env, resolver: Awaited<ReturnType<typeof resolveFrontrute>> | null) {
  if (!resolver) return null;
  const modus = await resolverModus(env, resolver.utfall);
  return modus === resolver.utfall
    ? resolver
    : { ...resolver, utfall: modus, grunn: `kill switch: ${resolver.utfall}→${modus} (${resolver.grunn})` };
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

/** Send svar til kunde på e-post via Brevo (tidl. Sendinblue) v3 SMTP. Fra: SUPPORT_FROM_EMAIL (default support@finnbilglass.no). */
async function sendReplyEmail(env: Env, to: string, navn: string | null, regnr: string | null, message: string): Promise<{ ok: boolean; error?: string }> {
  const from = env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
  const escHtml = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const body = { navn: navn || '', regnr: regnr || '' };
  const subject = `Svar fra FinnBilglass — din forespørsel${body.regnr ? ' (' + body.regnr + ')' : ''}`;
  const html =
    '<p>Hei' + (body.navn ? ' ' + escHtml(body.navn) : '') + ',</p>' +
    '<p>' + escHtml(message).replace(/\n/g, '<br>') + '</p>' +
    '<p>— FinnBilglass</p>' +
    '<p style="color:#637286;font-size:12px">Svar på e-post til ' + escHtml(from) + '. Vi svarer gjerne på spørsmål om glasset eller leveransen.</p>';
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'FinnBilglass' },
        to: [{ email: to, name: body.navn || undefined }],
        subject,
        htmlContent: html,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `Brevo ${r.status}${txt ? ': ' + txt.slice(0, 120) : ''}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ukjent feil ved sending.' };
  }
}

/** Varsler support når en ny kundeforespørsel er lagret. */
async function sendSupportInquiryEmail(env: Env, inquiry: { id: number; navn: string; kontakt: string; regnr: string; melding: string; vehicleJson: string | null }): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY) return { ok: false, error: 'BREVO_API_KEY mangler' };
  const from = env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
  const to = 'support@finnbilglass.no';
  const escHtml = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  let vehicle = '';
  try {
    const parsed = inquiry.vehicleJson ? JSON.parse(inquiry.vehicleJson) as Record<string, unknown> : null;
    const bil = parsed?.bil as Record<string, unknown> | undefined;
    if (bil) vehicle = [bil.merke, bil.modell, bil.aar].filter(Boolean).join(' ');
  } catch { /* ikke blokker varsling */ }
  const subject = `Ny forespørsel om bilglass${inquiry.regnr ? ` — ${inquiry.regnr}` : ''}`;
  const text = [`Ny forespørsel #${inquiry.id}`, `Registreringsnummer: ${inquiry.regnr || 'ikke oppgitt'}`, `Bil: ${vehicle || 'ikke bekreftet'}`, `Navn: ${inquiry.navn}`, `Kontakt: ${inquiry.kontakt}`, `Melding: ${inquiry.melding || '—'}`].join('\n');
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'FinnBilglass' },
        to: [{ email: to, name: 'FinnBilglass support' }],
        replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.kontakt) ? { email: inquiry.kontakt } : undefined,
        subject,
        textContent: text,
        htmlContent: '<h2>Ny forespørsel #' + inquiry.id + '</h2><p><b>Registreringsnummer:</b> ' + escHtml(inquiry.regnr || 'ikke oppgitt') + '<br><b>Bil:</b> ' + escHtml(vehicle || 'ikke bekreftet') + '<br><b>Navn:</b> ' + escHtml(inquiry.navn) + '<br><b>Kontakt:</b> ' + escHtml(inquiry.kontakt) + '</p><p><b>Melding:</b><br>' + escHtml(inquiry.melding || '—').replace(/\n/g, '<br>') + '</p>',
      }),
    });
    if (!r.ok) return { ok: false, error: `Brevo ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ukjent feil ved support-varsling.' };
  }
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
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleInboundEmail(message, env).catch((e) => console.error('email-ingest feilet:', e)));
    // NB: forward skjer i handleInboundEmail — men raw er single-use og allerede
    // konsumert der. Derfor forward FØR parsing i handleren er umulig; vi buffer
    // raw selv. Denne ytre kroppen gjør ingenting utover å unngå drop.
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (method === 'GET' && path === '/health') {
      // Liveness checks must not scan the complete catalogue. Health probes can
      // run frequently and D1 charges each scanned row against the daily cap.
      return json({ ok: true, service: 'finnbilglass-frontrute', katalogRader: null });
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
        resolver = (await medResolverModus(env, resolver))!;
        if (resolver.utfall === 'FALLBACK' || !resolverMatchesVehicleModel(bil.merke, bil.modell, resolver.kandidater)
          || !resolverMatchesVehicleGeneration(bil.merke, bil.modell, bil.aar, resolver.kandidater)) {
          return json(manualFitmentResponse());
        }
        const topp = resolver.kandidater?.[0] ?? null;
        return json(publicFrontruteDto({
          ok: true,
          ...resolver,
          pinpoint: false,
          anbefaling: resolver.varenr
            ? { varenr: resolver.varenr, varenavn: resolver.varenavn, pris: resolver.pris, listepris: resolver.listepris, eurokode: resolver.eurokode }
            : (topp ? { varenr: topp.varenr, varenavn: topp.varenavn, pris: topp.pris, listepris: topp.listepris, eurokode: topp.eurokode } : null),
          meta: { resolver: true, grunn: resolver.grunn },
        }));
      } catch (e) {
        console.error('matchFrontrute feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/glass') {
      let body: unknown;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 8192) return json({ ok: false, error: 'Forespørselen er for stor' }, 413);
        body = JSON.parse(raw);
      } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      if (!isRecord(body) || Object.keys(body).some(key => !['regnr', 'glassRequest'].includes(key))) return json({ ok: false, error: 'Ugyldig forespørsel' }, 400);
      if (typeof body.regnr !== 'string') return json({ ok: false, error: 'regnr påkrevd' }, 400);
      const regnr = body.regnr.trim().toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (!/^[A-Z]{2}[0-9]{4,5}$/.test(regnr)) return json({ ok: false, error: 'Ugyldig norsk registreringsnummer' }, 400);
      const glassRequest = parseGlassRequest(body.glassRequest);
      if (!glassRequest || glassRequest.searchId) return json({ ok: false, error: 'Ugyldig glassvalg eller søkereferanse' }, 400);
      if (glassRequest && glassRequest.selection.kind !== 'windshield' && env.MULTI_GLASS_ENABLED !== 'true') {
        return json({ ok: false, code: 'GLASS_TYPE_UNAVAILABLE', error: 'Vi tilbyr foreløpig bare søk og forespørsler om frontrute.' }, 409);
      }

      const ip = geoAv(request).ip;
      if (ip) {
        try {
          const now = Date.now();
          const rate = await env.FINNBILGLASS_DB.prepare(`INSERT INTO api_rate_limits (bucket_key,window_start,count) VALUES (?, ?, 1)
            ON CONFLICT(bucket_key) DO UPDATE SET
              window_start=CASE WHEN api_rate_limits.window_start <= ? THEN excluded.window_start ELSE api_rate_limits.window_start END,
              count=CASE WHEN api_rate_limits.window_start <= ? THEN 1 ELSE api_rate_limits.count + 1 END
            RETURNING count`).bind(`glass:${ip}`, now, now - 60_000, now - 60_000).first<{ count: number }>();
          if (!rate) return json({ ok: false, error: 'Søk er midlertidig utilgjengelig' }, 503);
          if (rate.count > 30) return json({ ok: false, error: 'For mange søk. Vent litt og prøv igjen.' }, 429);
        } catch {
          return json({ ok: false, error: 'Søk er midlertidig utilgjengelig' }, 503);
        }
      }

      let vehicle: Awaited<ReturnType<typeof svvLookup>> = null;
      try { vehicle = await svvLookup(regnr, env.SVV_API_KEY); }
      catch { /* handled as manual review; do not disclose provider internals */ }
      if (!vehicle) return json({
        ok: true, status: 'MANUAL_REVIEW', selection: glassRequest.selection, candidates: [], questions: [], truncated: false,
        canRequestQuote: true, message: 'Vi fikk ikke bekreftet bilen i oppslaget. Du kan sende en manuell forespørsel.',
      });

      // Release A: a public search never returns or persists product candidates.
      // The operator resolves the product from the private inquiry context.
      return json({ ok: true, status: 'MANUAL_REVIEW', selection: glassRequest.selection,
        candidates: [], questions: [], truncated: false, canRequestQuote: true,
        message: 'Vi kontrollerer riktig glass, pris og levering før tilbud.' });
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
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ ok: false, error: 'Forespørselen er for stor' }, 413);
        body = JSON.parse(raw);
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      if (!isRecord(body)) return json({ ok: false, error: 'Ugyldig forespørsel' }, 400);
      const b = body;
      const hasGlassRequest = Object.prototype.hasOwnProperty.call(b, 'glassRequest');
      const glassRequest = hasGlassRequest ? parseGlassRequest(b.glassRequest) : null;
      if (hasGlassRequest && !glassRequest) return json({ ok: false, error: 'Ugyldig glassvalg' }, 400);
      if (glassRequest && glassRequest.selection.kind !== 'windshield' && env.MULTI_GLASS_ENABLED !== 'true') {
        return json({ ok: false, code: 'GLASS_TYPE_UNAVAILABLE', error: 'Vi tilbyr foreløpig bare søk og forespørsler om frontrute.' }, 409);
      }
      if (b.clientRequestId !== undefined && !isValidClientRequestId(b.clientRequestId)) return json({ ok: false, error: 'Ugyldig forespørsels-ID' }, 400);
      let manualVehicle: { make: string; model: string; year: string } | null = null;
      if (b.manualVehicle !== undefined) {
        if (!isRecord(b.manualVehicle) || Object.keys(b.manualVehicle).some(key => !['make', 'model', 'year'].includes(key))) {
          return json({ ok: false, error: 'Ugyldige manuelle bilopplysninger' }, 400);
        }
        const { make, model, year } = b.manualVehicle;
        const cleanMake = typeof make === 'string' ? make.trim() : '';
        const cleanModel = typeof model === 'string' ? model.trim() : '';
        const cleanYear = typeof year === 'string' ? year.trim() : '';
        const maxManualYear = new Date().getFullYear() + 1;
        if (cleanMake.length < 2 || cleanMake.length > 50 || /[\u0000-\u001f\u007f]/.test(cleanMake)
          || cleanModel.length < 1 || cleanModel.length > 80 || /[\u0000-\u001f\u007f]/.test(cleanModel)
          || !/^\d{4}$/.test(cleanYear) || Number(cleanYear) < 1900 || Number(cleanYear) > maxManualYear) {
          return json({ ok: false, error: 'Ugyldige manuelle bilopplysninger' }, 400);
        }
        if (typeof b.regnr === 'string' && b.regnr.trim()) return json({ ok: false, error: 'Manuelle bilopplysninger kan ikke kombineres med registreringsnummer' }, 400);
        if (glassRequest) return json({ ok: false, error: 'Manuell bilforespørsel skal ikke inneholde et katalogbasert glassvalg' }, 400);
        manualVehicle = { make: cleanMake, model: cleanModel, year: cleanYear };
      }
      const regnr = typeof b.regnr === 'string' ? b.regnr.trim().slice(0, 10) : '';
      const navn = typeof b.navn === 'string' ? b.navn.trim() : '';
      const kontakt = typeof b.kontakt === 'string' ? b.kontakt.trim() : '';
      const contactPreference = b.contactPreference === 'telefon' || b.contactPreference === 'epost' || b.contactPreference === 'begge' ? b.contactPreference : null;
      const contactPhone = typeof b.contactPhone === 'string' ? b.contactPhone.trim() : '';
      const melding = manualVehicle
        ? (typeof b.melding === 'string' ? b.melding : '')
        : (typeof b.melding === 'string' ? b.melding.trim().slice(0, 500) : '');
      if (manualVehicle && melding.length > 500) return json({ ok: false, error: 'Meldingen kan ikke være over 500 tegn' }, 400);
      // Release A accepts no customer product selection. Historical preferences
      // already stored in older inquiries remain explicitly unverified in /ops.
      if (!navn || navn.length < 2 || navn.length > 80) return json({ ok: false, error: 'Navn må være 2–80 tegn' }, 400);
      if (!kontakt || kontakt.length > 120) return json({ ok: false, error: 'Telefon eller e-post må være 1–120 tegn' }, 400);
      // Enkel validering: minst 8 siffer ELLER e-postformat.
      const sifre = kontakt.replace(/[^0-9]/g, '');
      const erTelefon = sifre.length >= 8;
      const erEpost = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontakt);
      if (!erTelefon && !erEpost) return json({ ok: false, error: 'Ugyldig telefon eller e-post' }, 400);
      if (contactPreference === 'telefon' && !/^(?:\+47|0047)?\d{8}$/.test(kontakt.replace(/[\s-]/g, ''))) return json({ ok: false, error: 'Ugyldig telefonnummer' }, 400);
      if ((contactPreference === 'epost' || contactPreference === 'begge') && !erEpost) return json({ ok: false, error: 'Ugyldig e-postadresse' }, 400);
      if (contactPreference === 'begge' && !/^(?:\+47|0047)?\d{8}$/.test(contactPhone.replace(/[\s-]/g, ''))) return json({ ok: false, error: 'Ugyldig telefonnummer for kontaktvalg' }, 400);
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
      // Freeze vehicle context. Non-windshield requests must never invoke the windshield resolver.
      let vehicleJson: string | null = null;
      if (manualVehicle) {
        vehicleJson = JSON.stringify({
          customerVehicle: { ...manualVehicle, source: 'customer', verified: false },
          requiresManualReview: true,
        });
      }
      const searchId = glassRequest?.searchId;
      if (searchId && !glassRequest) return json({ ok: false, error: 'Søket mangler glassvalg' }, 400);
      if (searchId && glassRequest) {
        try {
          const snapshot = await env.FINNBILGLASS_DB.prepare(
            'SELECT regnr_norm, request_fingerprint, vehicle_json, candidate_ids_json, catalog_version, expires_at FROM glass_search_snapshots WHERE search_id = ?'
          ).bind(searchId).first<{ regnr_norm: string; request_fingerprint: string; vehicle_json: string; candidate_ids_json: string; catalog_version: string; expires_at: number }>();
          const normRegnr = regnr.toUpperCase().replace(/[\s\-–—.]+/g, '');
          if (!snapshot || snapshot.expires_at <= Date.now()) return json({ ok: false, error: 'Søket er utløpt. Søk på nytt eller send en manuell forespørsel uten søkereferanse.' }, 409);
          if (snapshot.regnr_norm !== normRegnr || snapshot.request_fingerprint !== await glassRequestFingerprint(normRegnr, glassRequest)) {
            return json({ ok: false, error: 'Søket stemmer ikke med bil eller rutevalg. Søk på nytt eller send en manuell forespørsel uten søkereferanse.' }, 409);
          }
          vehicleJson = JSON.stringify({
            bil: JSON.parse(snapshot.vehicle_json),
            glassSearch: { searchId, candidateIds: JSON.parse(snapshot.candidate_ids_json), catalogVersion: snapshot.catalog_version, capturedAt: Date.now() },
          });
        } catch (e) {
          console.error('glass snapshot validation failed');
          return json({ ok: false, error: 'Søket kan ikke bekreftes akkurat nå. Du kan sende en manuell forespørsel uten søkereferanse.' }, 503);
        }
      }
      if (glassRequest && !searchId && glassRequest.selection.kind !== 'windshield') {
        // An explicit manual fallback after an expired search keeps its chosen
        // glass type and does not invoke either the windshield resolver or a new search.
        vehicleJson = JSON.stringify({ glassSearch: { manual: true, reason: 'customer_requested_without_search' } });
      }
      if (regnr) {
        try {
          if (!searchId && (!glassRequest || glassRequest.selection.kind === 'windshield')) {
          const normRegnr = regnr.toUpperCase().replace(/[\s\-–—.]+/g, '');
          const bilSnap = await svvLookup(normRegnr, env.SVV_API_KEY);
          if (bilSnap) {
            let resolverSnap: unknown = null;
            if (!glassRequest || glassRequest.selection.kind === 'windshield') {
              try {
                resolverSnap = await medResolverModus(env, await resolveFrontrute(env, {
                  merke: bilSnap.merke, modell: bilSnap.modell ?? undefined,
                  aar: bilSnap.aar ?? undefined, vin: bilSnap.vin ?? undefined,
                }));
              } catch { /* resolver-snapshot is best effort for legacy/front requests */ }
            }
            vehicleJson = JSON.stringify({
              bil: { merke: bilSnap.merke, modell: bilSnap.modell ?? null, aar: bilSnap.aar ?? null, vin: bilSnap.vin ?? null },
              ...(resolverSnap ? { resolver: resolverSnap } : {}),
              tattVedInnsending: Date.now(),
            });
          }
          }
        } catch {
          /* kundereise-snapshot er best-effort */
        }
      }
      try {
        const legacyWindshield = glassRequest?.selection.kind === 'windshield'
          && !glassRequest.searchId
          && env.MULTI_GLASS_ENABLED !== 'true';
        if (contactPreference) {
          const context = vehicleJson ? JSON.parse(vehicleJson) as Record<string, unknown> : {};
          context.customerContact = { preference: contactPreference, ...(contactPreference === 'begge' ? { phone: contactPhone } : {}) };
          vehicleJson = JSON.stringify(context);
        }
        const stored = await persistInquiry(env.FINNBILGLASS_DB, {
          regnr, name: navn, contact: kontakt, message: melding, sessionId: sessionId(body, request),
          glassRequest: legacyWindshield ? null : glassRequest,
          clientRequestId: legacyWindshield ? null : (isValidClientRequestId(b.clientRequestId) ? b.clientRequestId : null),
          vehicleJson,
        });
        if (stored.conflict) return json({ ok: false, error: 'Forespørsels-ID-en er allerede brukt med andre opplysninger.' }, 409);
        let supportEmail: { ok: boolean; error?: string } | null = null;
        if (stored.created) {
          supportEmail = await sendSupportInquiryEmail(env, { id: Number(stored.id), navn, kontakt, regnr, melding, vehicleJson });
          if (!supportEmail.ok) console.error('support-varsling feilet:', supportEmail.error || 'ukjent feil');
        }
        return json({ ok: true, inquiryId: stored.id, duplicate: !stored.created, supportEmailSent: supportEmail?.ok ?? false }, stored.created ? 201 : 200);
      } catch (e) {
        console.error('inquiry-lagring feilet:', e);
        return json({ ok: false, error: 'Kunne ikke lagre forespørselen. Prøv igjen.' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/accessories') {
      return json({ ok: true, accessories: [], status: 'MANUAL_REVIEW',
        message: 'Tilbehør kontrolleres manuelt i tilbudet.' });
    }

    if (method === 'POST' && path === '/api/regnr') {
      let body: unknown;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 4096) return json({ ok: false, error: 'Forespørselen er for stor' }, 413);
        body = JSON.parse(raw);
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      if (!isRecord(body)) return json({ ok: false, error: 'Ugyldig forespørsel' }, 400);
      if (body.lookupOnly !== undefined && typeof body.lookupOnly !== 'boolean') return json({ ok: false, error: 'lookupOnly må være true eller false' }, 400);
      const lookupOnly = body.lookupOnly === true;
      const regnr = body.regnr;
      if (typeof regnr !== 'string' || !regnr.trim()) return json({ ok: false, error: 'regnr påkrevd' }, 400);
      const ren = regnr.trim();
      const norm = ren.toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (!/^[A-Z]{2}[0-9]{4,5}$/.test(norm)) return json({ ok: false, error: 'Ugyldig norsk registreringsnummer' }, 400);
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
      if (bil && !lookupOnly) {
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
        resolver = await medResolverModus(env, resolver);
        if (resolver && (!resolverMatchesVehicleModel(bil?.merke, bil?.modell, resolver.kandidater)
          || !resolverMatchesVehicleGeneration(bil?.merke, bil?.modell, bil?.aar, resolver.kandidater))) resolver = null;
      }
      return json(publicVehicleLookupDto({ ok: true, lagret, bil, resolver }));
    }

    if (method === 'POST' && path === '/api/vin') {
      // Backup-oppslag: kjennemerke fant ikke bilen i SVV → prøv understellsnummer (VIN).
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const lookupOnlyRaw = (body as Record<string, unknown> | null)?.lookupOnly;
      if (lookupOnlyRaw !== undefined && typeof lookupOnlyRaw !== 'boolean') {
        return json({ ok: false, error: 'lookupOnly må være true eller false' }, 400);
      }
      const lookupOnly = lookupOnlyRaw === true;
      const vin = (body as Record<string, unknown>)?.vin;
      if (typeof vin !== 'string' || !vin.trim()) return json({ ok: false, error: 'vin påkrevd' }, 400);
      const ren = vin.trim().toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(ren)) return json({ ok: false, error: 'Ugyldig chassisnummer' }, 400);
      let bil = null;
      let resolver = null;
      try {
        bil = await svvLookupVin(ren, env.SVV_API_KEY);
      } catch (e) {
        console.error('SVV VIN-oppslag feilet:', e);
      }
      if (bil && !lookupOnly) {
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
        resolver = await medResolverModus(env, resolver);
        if (resolver && (!resolverMatchesVehicleModel(bil?.merke, bil?.modell, resolver.kandidater)
          || !resolverMatchesVehicleGeneration(bil?.merke, bil?.modell, bil?.aar, resolver.kandidater))) resolver = null;
      }
      return json(publicVehicleLookupDto({ ok: true, bil, resolver }));
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
          resolver = await medResolverModus(env, resolver);
          if (resolver && (!resolverMatchesVehicleModel(bil?.merke, bil?.modell, resolver.kandidater)
            || !resolverMatchesVehicleGeneration(bil?.merke, bil?.modell, bil?.aar, resolver.kandidater))) resolver = null;
        }
        return json(publicVehicleLookupDto({ ok: true, regnr: lest.regnr, lest: { confidence: lest.confidence, raatekst: lest.raatekst.slice(0, 120) }, funnet: !!bil, bil, resolver }));
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
    if (method === 'GET' && path === '/ops/stemmelab') {
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      return voiceLabUi();
    }
    if (method === 'POST' && path === '/api/ops/voice/session') {
      return createVoiceSession(request, env);
    }
    if (method === 'POST' && path === '/api/ops/voice/tool') {
      return voiceTool(request, env);
    }
    if (method === 'POST' && path === '/api/ops/voice/close') {
      return closeVoiceSession(request, env);
    }
    if (method === 'GET' && path === '/api/ops/voice/summary') {
      return voiceSummary(env);
    }
    const commercialMatch = /^\/api\/ops\/inquiries\/(\d+)\/commercial$/.exec(path);
    if (path === '/api/ops/commercial' || commercialMatch) {
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok:false, error:'Ikke tilgjengelig i dette miljøet.' },404);
      if (!supportAuthorised(request, env)) return json({ ok:false, error:'Unauthorised' },401);
      return commercialRoute(request, env.FINNBILGLASS_DB, commercialMatch ? Number(commercialMatch[1]) : null);
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
      const glassRequestProjection = await inquiryHasGlassRequestColumn(env.FINNBILGLASS_DB)
        ? 'glass_request_json' : 'NULL AS glass_request_json';
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
      const rows = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, navn, kontakt, melding, status, assigned_to, ${glassRequestProjection}, vehicle_json, created_at, updated_at FROM beta_inquiries ${where} ORDER BY (status = 'NEW') DESC, created_at DESC LIMIT ? OFFSET ?`).bind(...bind).all<{ id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; status: string; assigned_to: string | null; glass_request_json: string | null; vehicle_json: string | null; created_at: string; updated_at: number | null }>();
      return json({ ok: true, inquiries: rows.results.map(r => ({ ...r, status: isInquiryStatus(r.status) ? r.status : 'NEW' })) });
    }
    if (method === 'GET' && path.startsWith('/api/ops/inquiries/')) {
      // Saksdetalj: én inquiry + append-only tidslinje + kundereise-kontekst (G3, G5, G9).
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const idRaw = path.slice('/api/ops/inquiries/'.length).split('/')[0];
      if (!/^\d+$/.test(idRaw)) return json({ ok: false, error: 'Ugyldig id' }, 400);
      const id = Number(idRaw);
      const glassRequestProjection = await inquiryHasGlassRequestColumn(env.FINNBILGLASS_DB)
        ? 'glass_request_json' : 'NULL AS glass_request_json';
      const row = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, navn, kontakt, melding, status, assigned_to, ${glassRequestProjection}, vehicle_json, session_id, created_at, updated_at FROM beta_inquiries WHERE id = ?`).bind(id).first<{ id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; status: string; assigned_to: string | null; glass_request_json: string | null; vehicle_json: string | null; session_id: string | null; created_at: string; updated_at: number | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      const events = await env.FINNBILGLASS_DB.prepare('SELECT event_type, previous_status, status, note, created_at, created_by, meta_json FROM beta_inquiry_events WHERE inquiry_id = ? ORDER BY created_at ASC').bind(id).all<{ event_type: string; previous_status: string | null; status: string | null; note: string | null; created_at: number; created_by: string; meta_json: string | null }>();
      let vehicle = null;
      try { if (row.vehicle_json) vehicle = JSON.parse(row.vehicle_json); } catch { /* ugyldig snapshot = ignorert */ }
      let glassRequest = null;
      try { if (row.glass_request_json) glassRequest = JSON.parse(row.glass_request_json); } catch { /* ugyldig glass-request-snapshot = ignorert */ }
      return json({ ok: true, inquiry: { ...row, status: isInquiryStatus(row.status) ? row.status : 'NEW', vehicle, glassRequest, history: events.results.map(e => { let meta: unknown = null; try { if (e.meta_json) meta = JSON.parse(e.meta_json); } catch { /* ugyldig meta = ignorert */ } return { ...e, meta }; }) } });
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
      let meta: Record<string, unknown> = {};
      if (to === 'OFFERED') {
        const proposed = typeof body.meta === 'object' && body.meta !== null
          ? (body.meta as Record<string, unknown>).prisTilbudt : null;
        if (!Number.isInteger(proposed) || (proposed as number) <= 0) {
          return json({ ok: false, error: 'Godkjent tilbud krever en positiv tilbudspris i hele kroner.' }, 400);
        }
        meta = {
          prisTilbudt: proposed,
          currency: 'NOK',
          priceSource: 'PRODUCT_CATALOG',
          stockAssumption: 'PRICE_PRESENT',
          approvedBy: actor,
          approvedAt: Date.now(),
        };
      }
      const now = Date.now();
      await env.FINNBILGLASS_DB.batch([
        env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by, meta_json) VALUES (?, ?, 'status', ?, ?, ?, ?, ?, ?)").bind(`status-${id}-${now}-${crypto.randomUUID()}`, id, from, to, reason.trim(), now, actor, JSON.stringify(meta)),
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
    const inquiryReplyMatch = /^\/api\/ops\/inquiries\/(\d+)\/reply$/.exec(path);
    if (method === 'POST' && inquiryReplyMatch) {
      // Svar direkte til kunden på e-post (kanal #4). Append-only-logg som notater.
      // Avhengig av BREVO_API_KEY — uten nøkkel returneres 503 «ikke konfigurert».
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      if (!env.BREVO_API_KEY) return json({ ok: false, error: 'E-post-sending er ikke konfigurert ennå.' }, 503);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const actor = typeof body.actor === 'string' ? body.actor.trim() : '', message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !message || message.length > 2000) return json({ ok: false, error: 'Ansvarlig og svar-tekst er påkrevd.' }, 400);
      const id = Number(inquiryReplyMatch[1]);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT id, navn, kontakt, regnr FROM beta_inquiries WHERE id = ?').bind(id).first<{ id: number; navn: string | null; kontakt: string; regnr: string | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      const epost = (row.kontakt || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) return json({ ok: false, error: 'Kunden har ikke oppgitt e-post — e-post-svar krever en e-postadresse.' }, 409);
      const sendt = await sendReplyEmail(env, epost, row.navn, row.regnr, message);
      if (!sendt.ok) return json({ ok: false, error: sendt.error || 'Kunne ikke sende e-posten.' }, 502);
      const now = Date.now();
      await env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by, meta_json) VALUES (?, ?, 'reply', ?, ?, ?, ?)").bind(`reply-${id}-${now}-${crypto.randomUUID()}`, id, message, now, actor, JSON.stringify({ to: epost, to_user: row.navn || null })).run();
      return json({ ok: true, to: epost });
    }
    const inquirySmsReplyMatch = /^\/api\/ops\/inquiries\/(\d+)\/sms-reply$/.exec(path);
    if (method === 'POST' && inquirySmsReplyMatch) {
      // SMS-svar til kunder som bare oppga telefonnummer (Brevo v3 transactionalSMS).
      // Samme token-gate + append-only-logg som e-post-replies. Uten credits i
      // Brevo-kontoen feiler sendingen med 402/400 → 502 videre til /ops.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      if (!env.BREVO_API_KEY || !env.BREVO_SMS_SENDER) return json({ ok: false, error: 'SMS-sending er ikke konfigurert ennå.' }, 503);
      let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'Ugyldig JSON' }, 400); }
      const actor = typeof body.actor === 'string' ? body.actor.trim() : '', message = typeof body.message === 'string' ? body.message.trim() : '';
      // SMS-grense: 640 tegn (= 4 SMS-segmenter à 160) — hold svaret kort.
      if (!/^[a-zA-Z0-9 _.-]{2,64}$/.test(actor) || !message || message.length > 640) return json({ ok: false, error: 'Ansvarlig og svar-tekst er påkrevd (max 640 tegn).' }, 400);
      const id = Number(inquirySmsReplyMatch[1]);
      const row = await env.FINNBILGLASS_DB.prepare('SELECT id, navn, kontakt, vehicle_json FROM beta_inquiries WHERE id = ?').bind(id).first<{ id: number; navn: string | null; kontakt: string | null; vehicle_json: string | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      let secondaryPhone = '';
      try {
        const details = row.vehicle_json ? JSON.parse(row.vehicle_json) as { customerContact?: { preference?: string; phone?: string } } : null;
        if (details?.customerContact?.preference === 'begge' && typeof details.customerContact.phone === 'string') secondaryPhone = details.customerContact.phone;
      } catch { /* eldre eller ugyldig kjøretøy-snapshot */ }
      // Norsk mobilnummer → E.164 (+47). Aksepterer 8 siffer, evt. +47/0047-prefix og mellomrom.
      const raa = (secondaryPhone || row.kontakt || '').replace(/[\s-]/g, '');
      const m = /^(?:\+47|0047)?(\d{8})$/.exec(raa);
      if (!m) return json({ ok: false, error: 'Kunden har ikke et gyldig norsk telefonnummer i kontakt-feltet.' }, 409);
      const til = `+47${m[1]}`;
      const smsRes = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: env.BREVO_SMS_SENDER, recipient: til, type: 'transactional', content: message }),
      });
      if (!smsRes.ok) {
        const errTxt = await smsRes.text().catch(() => '');
        console.error('Brevo SMS feilet:', smsRes.status, errTxt.slice(0, 300));
        return json({ ok: false, error: `Kunne ikke sende SMS (Brevo ${smsRes.status}). Sjekk SMS-credits og avsender-navn.` }, 502);
      }
      const now = Date.now();
      await env.FINNBILGLASS_DB.prepare("INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by, meta_json) VALUES (?, ?, 'reply', ?, ?, ?, ?)").bind(`sms-reply-${id}-${now}-${crypto.randomUUID()}`, id, message, now, actor, JSON.stringify({ kanal: 'sms', to: til, to_user: row.navn || null })).run();
      return json({ ok: true, to: til });
    }
    if (method === 'GET' && path === '/api/ops/saker') {
      // Fase A: konsolidert saksliste — én rad per kundereise (inquiry + evidens
      // smeltet på session_id). Lesing, token-gate, kun staging+prod.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const glassRequestProjection = await inquiryHasGlassRequestColumn(env.FINNBILGLASS_DB)
        ? 'glass_request_json' : 'NULL AS glass_request_json';
      const inquiries = await env.FINNBILGLASS_DB.prepare(
        `SELECT id, regnr, navn, kontakt, melding, status, assigned_to, ${glassRequestProjection}, vehicle_json, session_id, created_at, updated_at FROM beta_inquiries ORDER BY created_at DESC LIMIT 500`,
      ).all<InquiryRow>();
      const evidenceRows = await env.FINNBILGLASS_DB.prepare(
        `SELECT c.case_id, c.registration_hash, c.session_id,
                COALESCE((SELECT r.status FROM evidence_case_review_events r WHERE r.case_id = c.case_id ORDER BY r.created_at DESC LIMIT 1), c.status) AS status,
                c.created_at,
                (SELECT COUNT(*) FROM evidence_case_images i WHERE i.case_id = c.case_id) AS image_count
         FROM evidence_cases c ORDER BY c.created_at DESC LIMIT 500`,
      ).all<EvidenceCaseRow>();
      const saker = konsoliderSaker(inquiries.results ?? [], evidenceRows.results ?? []);
      return json({ ok: true, saker, total: saker.length });
    }
    const sakDetailMatch = /^\/api\/ops\/saker\/(inquiry|evidence)-(.+)$/.exec(path);
    if (method === 'GET' && sakDetailMatch) {
      // Fase A: konsolidert sakdetalj — inquiry + tilknyttede evidenssaker med
      // bilder + SKU-beslutning + tidslinje. Én visning for hele kundereisen.
      if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'production') return json({ ok: false, error: 'Ikke tilgjengelig i dette miljøet.' }, 404);
      if (!supportAuthorised(request, env)) return json({ ok: false, error: 'Unauthorised' }, 401);
      const kind = sakDetailMatch[1];
      const rawId = sakDetailMatch[2];

      type InquiryDetail = { id: number; regnr: string | null; navn: string; kontakt: string; melding: string | null; status: string; assigned_to: string | null; glass_request_json: string | null; vehicle_json: string | null; session_id: string | null; created_at: string; updated_at: number | null };
      type EvidenceDetail = { case_id: string; status: string; created_at: number; session_id: string | null };

      let inquiry: InquiryDetail | null = null;
      let sessionId: string | null = null;
      let inquiryId: number | null = null;
      const glassRequestProjection = await inquiryHasGlassRequestColumn(env.FINNBILGLASS_DB)
        ? 'glass_request_json' : 'NULL AS glass_request_json';

      if (kind === 'inquiry' && /^\d+$/.test(rawId)) {
        inquiryId = Number(rawId);
        inquiry = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, navn, kontakt, melding, status, assigned_to, ${glassRequestProjection}, vehicle_json, session_id, created_at, updated_at FROM beta_inquiries WHERE id = ?`).bind(inquiryId).first<InquiryDetail>();
        if (inquiry) sessionId = inquiry.session_id;
      }

      const evidenceCases: EvidenceDetail[] = [];
      if (kind === 'evidence') {
        const c = await env.FINNBILGLASS_DB.prepare('SELECT case_id, status, created_at, session_id FROM evidence_cases WHERE case_id = ?').bind(rawId).first<EvidenceDetail>();
        if (c) { evidenceCases.push(c); if (!sessionId && c.session_id) sessionId = c.session_id; }
      }
      if (sessionId) {
        const bySession = await env.FINNBILGLASS_DB.prepare('SELECT case_id, status, created_at, session_id FROM evidence_cases WHERE session_id = ? ORDER BY created_at DESC').bind(sessionId).all<EvidenceDetail>();
        for (const c of bySession.results ?? []) if (!evidenceCases.some((x) => x.case_id === c.case_id)) evidenceCases.push(c);
      }
      if (kind === 'evidence' && !inquiry && sessionId) {
        inquiry = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, navn, kontakt, melding, status, assigned_to, ${glassRequestProjection}, vehicle_json, session_id, created_at, updated_at FROM beta_inquiries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`).bind(sessionId).first<InquiryDetail>();
        if (inquiry) inquiryId = inquiry.id;
      }

      const evidenceMedBilder = [];
      for (const c of evidenceCases) {
        const images = await env.FINNBILGLASS_DB.prepare('SELECT image_id, image_type, r2_key, thumb_r2_key FROM evidence_case_images WHERE case_id = ? ORDER BY created_at').bind(c.case_id).all<{ image_id: string; image_type: string; r2_key: string; thumb_r2_key: string | null }>();
        evidenceMedBilder.push({
          caseId: c.case_id, status: c.status, createdAt: c.created_at,
          images: (images.results ?? []).map((i) => ({ imageId: i.image_id, imageType: i.image_type, thumbUrl: `/api/ops/thumb?key=${encodeURIComponent(i.thumb_r2_key ?? i.r2_key)}`, fullUrl: `/api/ops/thumb?key=${encodeURIComponent(i.r2_key)}` })),
        });
      }

      let skuDecision: unknown = null;
      if (inquiryId) {
        skuDecision = await env.FINNBILGLASS_DB.prepare('SELECT decision_type, sku, eurocode, reason, created_by, created_at FROM case_sku_decisions WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').bind(String(inquiryId)).first<{ decision_type: string; sku: string | null; eurocode: string | null; reason: string | null; created_by: string; created_at: string }>();
      }

      let timeline: unknown[] = [];
      if (inquiryId) {
        const events = await env.FINNBILGLASS_DB.prepare('SELECT event_type, previous_status, status, note, created_at, created_by, meta_json FROM beta_inquiry_events WHERE inquiry_id = ? ORDER BY created_at ASC').bind(inquiryId).all<{ event_type: string; previous_status: string | null; status: string | null; note: string | null; created_at: number; created_by: string; meta_json: string | null }>();
        timeline = (events.results ?? []).map((e) => { let meta: unknown = null; try { if (e.meta_json) meta = JSON.parse(e.meta_json); } catch { /* ugyldig meta */ } return { ...e, meta }; });
      }

      let glassRequest = null;
      try { if (inquiry?.glass_request_json) glassRequest = JSON.parse(inquiry.glass_request_json); } catch { /* ugyldig snapshot = ignorert */ }
      // Legacy-compatible windshield inquiries do not have a glass_request_json
      // column. With multi-glass disabled, the only accepted inquiry kind is
      // windshield, so restore that context for operators without changing D1.
      if (!glassRequest && inquiry && env.MULTI_GLASS_ENABLED !== 'true') {
        glassRequest = { schemaVersion: 1, selection: { kind: 'windshield' }, answers: {} };
      }
      return json({ ok: true, sak: { kind, inquiry, glassRequest, evidence: evidenceMedBilder, skuDecision, timeline } });
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

      // Kun bilder som finnes i D1-registeret kan leses fra R2.
      // Sjekk både original og miniatyr, for begge bildetyper.
      const registered = await env.FINNBILGLASS_DB.prepare(`
        SELECT 1 AS allowed FROM opplaering_bilde
        WHERE r2_key = ? OR thumb_r2_key = ?
        UNION ALL
        SELECT 1 AS allowed FROM evidence_case_images
        WHERE r2_key = ? OR thumb_r2_key = ?
        LIMIT 1
      `).bind(key, key, key, key).first<{ allowed: number }>();

      if (!registered) {
        return json({ ok: false, error: 'Bilde mangler' }, 404);
      }

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
      const glassRequestProjection = await inquiryHasGlassRequestColumn(env.FINNBILGLASS_DB)
        ? 'glass_request_json' : 'NULL AS glass_request_json';
      const row = await env.FINNBILGLASS_DB.prepare(`SELECT id, regnr, status, ${glassRequestProjection}, vehicle_json FROM beta_inquiries WHERE id = ?`).bind(id).first<{ id: number; regnr: string | null; status: string; glass_request_json: string | null; vehicle_json: string | null }>();
      if (!row) return json({ ok: false, error: 'Henvendelsen finnes ikke.' }, 404);
      let submittedGlass: { kind?: string } | null = null;
      let invalidGlassSnapshot = false;
      try { if (row.glass_request_json) submittedGlass = JSON.parse(row.glass_request_json); } catch { invalidGlassSnapshot = true; }
      if (['approve_sku', 'choose_alternative_sku'].includes(decision) && (invalidGlassSnapshot || (row.glass_request_json !== null && submittedGlass?.kind !== 'windshield'))) {
        return json({ ok: false, error: 'Denne godkjenningsflyten gjelder bare frontruter. Kontroller denne glasstypen manuelt før tilbud.' }, 409);
      }

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
      const valgt = finnValgtSnapshotKandidat(snapshotKandidater, sku, eurocode);
      if (!valgt) {
        return json({ ok: false, error: 'Valgt SKU finnes ikke i sakens glasskandidater.' }, 409);
      }
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
