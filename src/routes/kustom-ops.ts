/**
 * Staging-only candidate until real provider E2E, migration tracking,
 * refund handling and launch approval have passed. All writes are feature-gated.
 */
import type { Env } from '../types';
import { verifiserAccess } from '../access-jwt';
import { sendMail, avsenderEpost } from '../mail';
import {
  buildLockedKustomOrder, createKustomCheckout, createKustomHpp, readKustomCheckout,
  readHpp, SHIPPING_INCL_VAT_MINOR,
} from '../payments/kustom-core';
import { readKustomManagedOrder, reconcileKustomManagedOrder, acknowledgeKustomManagedOrder } from '../payments/kustom-management';
import { validateKustomAcceptedQuote, safeKustomLink, sha256Hex, constantTimeHexMatch, type KustomQuote } from '../payments/kustom-ops-domain';

const providerUuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const internalId = /^[A-Za-z0-9_-]{8,100}$/;

type StoredOrder = {
  id: string; inquiry_id: number; quote_id: number; quote_version: number;
  amount_minor: number; status: string; payment_provider: string;
  acceptance_method: string; acceptance_note: string; accepted_by: string;
  kustom_checkout_create_started_at: number | null;
  kustom_notification_token_hash: string | null;
  kustom_order_id: string | null; kustom_hpp_session_id: string | null;
  kustom_hpp_url: string | null; checkout_url: string | null;
  payment_link_sent_at: number | null;
};
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function inquiryDb(env: Env): D1Database {
  // Never fall back to a different database when staging's auth binding is missing.
  if (env.ENVIRONMENT === 'staging') {
    if (!env.FINNBILGLASS_STAGING_AUTH) throw new Error('KUSTOM_STAGING_AUTH_DB_MISSING');
    return env.FINNBILGLASS_STAGING_AUTH;
  }
  return env.FINNBILGLASS_DB;
}
function allowed(env: Env): boolean {
  return env.KUSTOM_OPS_ROUTE_ENABLED === 'true' && env.KUSTOM_ENABLED === 'true' &&
    (env.ENVIRONMENT === 'staging' ||
      (env.ENVIRONMENT === 'production' && env.KUSTOM_PRODUCTION_APPROVED === 'true')) &&
    Boolean(env.KUSTOM_API_USERNAME && env.KUSTOM_API_PASSWORD && env.KUSTOM_RETURN_ORIGIN);
}
function htmlEscape(input: string): string {
  return input.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Same Ops endpoint as Stripe, only selected when the separate Kustom Ops gate is explicitly enabled. */
export async function handleCreateKustomPaymentLink(request: Request, env: Env, inquiryId: number): Promise<Response> {
  if (!allowed(env)) return json({ ok: false, error: 'KUSTOM_IKKE_AKTIVERT' }, 503);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ ok: false, error: 'UGYLDIG_OPPRINNELSE' }, 403);
  const identity = await verifiserAccess(request, env);
  const actor = identity?.epost?.trim().toLowerCase() || '';
  const admins = String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase());
  if (!actor || !admins.includes(actor)) return json({ ok: false, error: 'ACCESS_ADMIN_KREVES' }, 403);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new Error();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return json({ ok: false, error: 'UGYLDIG_JSON' }, 400); }
  const quoteId = Number(body.quoteId);
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!Number.isSafeInteger(quoteId) || quoteId < 1 || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
    return json({ ok: false, error: 'UGYLDIG_BETALINGSFORESPORSEL' }, 400);
  }
  const db = inquiryDb(env);
  let quote: KustomQuote | null;
  try {
    quote = await db.prepare(`SELECT q.id,q.inquiry_id,q.versjon,q.pris_kr,q.total_kr,q.pris_type,q.sendt_at,q.gyldig_til,
                 i.navn,i.kontakt,i.regnr,i.status AS inquiry_status
        FROM glass_quotes q JOIN beta_inquiries i ON i.id=q.inquiry_id
        WHERE q.id=? AND q.inquiry_id=?
          AND q.versjon=(SELECT MAX(q2.versjon) FROM glass_quotes q2 WHERE q2.inquiry_id=q.inquiry_id)`)
      .bind(quoteId, inquiryId).first<KustomQuote>();
  } catch { return json({ ok: false, error: 'KUSTOM_DB_IKKE_KLAR' }, 503); }
  if (!quote) return json({ ok: false, error: 'TILBUD_IKKE_FUNNET' }, 404);
  let acceptance;
  try { acceptance = validateKustomAcceptedQuote(quote, body); }
  catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : 'UGYLDIG_TILBUD' }, 409); }
  const { amountMinor, glassMinor } = acceptance;
  const now = Date.now();
  const freshId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
  // Explicit provider; migration 0059 defaults legacy rows to Stripe.
  try {
    await db.prepare(`INSERT OR IGNORE INTO quote_payment_orders
      (id,request_id,inquiry_id,quote_id,quote_version,amount_minor,amount_breakdown_json,
       acceptance_method,acceptance_note,accepted_at,accepted_by,status,created_at,created_by,updated_at,payment_provider)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACCEPTED',?,?,?,'kustom')`)
      .bind(freshId,requestId,inquiryId,quote.id,quote.versjon,amountMinor,
        JSON.stringify({ totalMinor: amountMinor, glassMinor, shippingMinor: SHIPPING_INCL_VAT_MINOR }),
        acceptance.method,acceptance.note,now,actor,now,actor,now).run();
  } catch { return json({ ok: false, error: 'KUSTOM_SKJEMA_IKKE_MIGRERT' }, 503); }
  let order = await db.prepare('SELECT * FROM quote_payment_orders WHERE quote_id=?')
    .bind(quote.id).first<StoredOrder>();
  if (!order || order.payment_provider !== 'kustom' || !internalId.test(order.id)) {
    return json({ ok: false, error: 'ORDRE_TILHORER_ANNEN_BETALINGSLEVERANDOR' }, 409);
  }
  if (order.amount_minor !== amountMinor || order.inquiry_id !== inquiryId || order.quote_version !== quote.versjon ||
      order.acceptance_method !== acceptance.method || order.acceptance_note !== acceptance.note || order.accepted_by !== actor) {
    return json({ ok: false, error: 'TILBUD_ER_ALLEREDE_GODTATT_MED_ANNEN_REGISTRERING' }, 409);
  }
  if (['PAID','REFUNDED','PARTIALLY_REFUNDED','REFUND_PENDING'].includes(order.status)) {
    return json({ ok: false, error: 'ORDREN_ER_ALLEREDE_BEHANDLET' }, 409);
  }
  if (order.status === 'PAYMENT_LINK_SENT' && order.payment_link_sent_at) {
    return json({ ok: true, alreadySent: true, status: order.status, orderId: order.id });
  }
  if (order.status !== 'ACCEPTED') return json({ ok: false, error: 'ORDRESTATUS_UGYLDIG' }, 409);

  if (!order.kustom_hpp_url || !order.kustom_hpp_session_id) {
    // A checkout POST has no guaranteed idempotency across timeouts. Never blindly re-create.
    if (order.kustom_checkout_create_started_at) {
      return json({ ok: false, error: 'KUSTOM_MANUELL_GJENOPPRETTING_KREVES' }, 409);
    }
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const reserved = await db.prepare(`UPDATE quote_payment_orders
         SET kustom_checkout_create_started_at=?,kustom_notification_token_hash=?,updated_at=?
         WHERE id=? AND payment_provider='kustom' AND status='ACCEPTED'
           AND kustom_checkout_create_started_at IS NULL AND kustom_order_id IS NULL`)
      .bind(now,tokenHash,now,order.id).run();
    if (reserved.meta.changes !== 1) return json({ ok: false, error: 'CHECKOUT_ALLEREDE_RESERVERT' }, 409);
    try {
      const payload = buildLockedKustomOrder({ internalOrderId: order.id, amountMinor,
        shippingMinor: SHIPPING_INCL_VAT_MINOR, customerOrigin: env.KUSTOM_RETURN_ORIGIN!, callbackToken: token });
      const kustomOrderId = await createKustomCheckout(env,payload);
      const stored = await db.prepare(`UPDATE quote_payment_orders SET kustom_order_id=?,updated_at=?
        WHERE id=? AND payment_provider='kustom' AND kustom_order_id IS NULL AND status='ACCEPTED'`)
        .bind(kustomOrderId,Date.now(),order.id).run();
      if (stored.meta.changes !== 1) throw new Error('KUSTOM_ORDRE_LAGRING_FEILET');
      const hpp = await createKustomHpp(env,kustomOrderId,env.KUSTOM_RETURN_ORIGIN!,token);
      if (!safeKustomLink(hpp.redirectUrl)) throw new Error('KUSTOM_HPP_LENKE_IKKE_GODKJENT');
      const saved = await db.prepare(`UPDATE quote_payment_orders
        SET kustom_hpp_session_id=?,kustom_hpp_url=?,checkout_url=?,updated_at=?
        WHERE id=? AND payment_provider='kustom' AND kustom_order_id=? AND kustom_hpp_session_id IS NULL AND status='ACCEPTED'`)
        .bind(hpp.sessionId,hpp.redirectUrl,hpp.redirectUrl,Date.now(),order.id,kustomOrderId).run();
      if (saved.meta.changes !== 1) throw new Error('KUSTOM_HPP_LAGRING_FEILET');
      order = { ...order,kustom_order_id:kustomOrderId,kustom_hpp_session_id:hpp.sessionId,kustom_hpp_url:hpp.redirectUrl,checkout_url:hpp.redirectUrl };
    } catch (error) {
      // Reservation is deliberately retained. Operator must reconcile the possibly-created order.
      console.error('Kustom checkout requires review',error instanceof Error ? error.message.replace(/token=[^&\s]+/g,'token=[hidden]') : 'unknown');
      return json({ ok: false, error: 'KUSTOM_MANUELL_GJENOPPRETTING_KREVES' }, 502);
    }
  }
  if (!order.kustom_hpp_url || !safeKustomLink(order.kustom_hpp_url)) return json({ ok: false, error: 'KUSTOM_UGYLDIG_LENKE' }, 502);
  const amount = (amountMinor/100).toLocaleString('nb-NO',{ minimumFractionDigits:2,maximumFractionDigits:2 });
  const url = htmlEscape(order.kustom_hpp_url);
  const mail = {
    subject:`Betalingslenke for Finnbilglass-tilbud${quote.regnr ? ` — ${quote.regnr}` : ''}`,
    html:`<p>Hei ${htmlEscape(quote.navn)},</p><p>Her er betalingslenken til tilbudet du har godtatt.</p><p><strong>Totalpris: ${amount} kr inkl. mva.</strong></p><p><a href="${url}">Åpne sikker betaling</a></p><p>Velg blant betalingsmåtene som vises i kassen.</p><p>Hvis lenken ikke virker, svar på denne e-posten.</p><p>— Finnbilglass</p>`,
    text:`Hei ${quote.navn},\n\nBetalingslenke til godtatt tilbud:\n${order.kustom_hpp_url}\n\nTotalpris: ${amount} kr inkl. mva.\n\n— Finnbilglass`,
  };
  const sent = await sendMail(env,{to:quote.kontakt.trim(),...mail,replyTo:env.SUPPORT_EPOST||avsenderEpost(env),idempotencyKey:`kustom-payment-order-${order.id}`});
  if (!sent.ok) return json({ ok:false,error:'KUSTOM_LENKE_OPPRETTET_EPOST_AVVENTER_RETRY' },502);
  const sentAt = Date.now();
  await db.batch([
    db.prepare(`UPDATE quote_payment_orders SET status='PAYMENT_LINK_SENT',payment_link_sent_at=?,updated_at=?
      WHERE id=? AND status='ACCEPTED' AND payment_provider='kustom'`)
      .bind(sentAt,sentAt,order.id),
    db.prepare(`INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by)
      VALUES(?,?,'note',?,?,?)`)
      .bind(`kustom-link-${order.id}`,inquiryId,`Kustom betalingslenke sendt for godtatt tilbud v${quote.versjon}.`,sentAt,actor),
  ]);
  return json({ok:true,alreadySent:false,status:'PAYMENT_LINK_SENT',orderId:order.id});
}

/** Callbacks are always verified against Kustom's API and the secret token hash. */
export async function handleKustomCallback(request: Request,env: Env,kind:'push'|'status-update'):Promise<Response>{
  if (!allowed(env)) return json({ok:false,error:'KUSTOM_IKKE_AKTIVERT'},503);
  if (request.method !== 'POST') return json({ok:false,error:'METODE_IKKE_STOTTET'},405);
  const url = new URL(request.url);
  const token = url.searchParams.get('token')||'';
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ok:false,error:'KUSTOM_UGYLDIG_TOKEN'},403);
  const tokenHash = await sha256Hex(token);
  const db=inquiryDb(env);
  let order:StoredOrder|null=null;
  if(kind==='push'){
    const id=url.searchParams.get('order_id')||'';
    if(!providerUuid.test(id)) return json({ok:false,error:'KUSTOM_UGYLDIG_ORDREID'},400);
    order=await db.prepare(`SELECT * FROM quote_payment_orders WHERE kustom_order_id=? AND payment_provider='kustom'`)
      .bind(id).first<StoredOrder>();
  }else{
    order=await db.prepare(`SELECT * FROM quote_payment_orders WHERE kustom_notification_token_hash=? AND payment_provider='kustom'`)
      .bind(tokenHash).first<StoredOrder>();
  }
  if(!order||!order.kustom_notification_token_hash||!constantTimeHexMatch(order.kustom_notification_token_hash,tokenHash)||
     !order.kustom_order_id||!providerUuid.test(order.kustom_order_id)||!order.kustom_hpp_session_id){
    return json({ok:false,error:'KUSTOM_ORDRE_IKKE_FUNNET'},403);
  }
  try{
    const checkout=await readKustomCheckout(env,order.kustom_order_id);
    const hpp=await readHpp(env,order.kustom_hpp_session_id);
    if(checkout.order_id!==order.kustom_order_id||checkout.merchant_reference1!==order.id||
       checkout.order_amount!==order.amount_minor||checkout.purchase_currency.toUpperCase()!=='NOK'||
       hpp.session_id!==order.kustom_hpp_session_id||hpp.order_id!==order.kustom_order_id){
      return json({ok:false,error:'KUSTOM_ORDRE_AVVIK'},409);
    }
    if(checkout.status.toLowerCase()!=='checkout_complete'||hpp.status.toUpperCase()!=='COMPLETED'){
      return json({ok:true,pending:true});
    }
    const managed=await readKustomManagedOrder(env,order.kustom_order_id);
    const state=reconcileKustomManagedOrder(managed,{kustomOrderId:order.kustom_order_id,amountMinor:order.amount_minor});
    const now=Date.now();
    if(state==='NEEDS_RECONCILIATION'||state==='REJECTED') return json({ok:false,error:'KUSTOM_AVSTEMMING_KREVES'},409);
    const eventId=`kustom_${kind}_${order.kustom_order_id}_${state}_${managed.captured_amount}_${managed.refunded_amount}`;
    const stateUpdate= state==='PAID'
      ? db.prepare(`UPDATE quote_payment_orders SET status='PAID',paid_at=COALESCE(paid_at,?),kustom_capture_state='PAID',updated_at=?
         WHERE id=? AND payment_provider='kustom' AND status IN ('ACCEPTED','PAYMENT_LINK_SENT','PAID')`).bind(now,now,order.id)
      : state==='REFUNDED'
      ? db.prepare(`UPDATE quote_payment_orders SET status='REFUNDED',refunded_minor=amount_minor,kustom_capture_state='REFUNDED',updated_at=?
         WHERE id=? AND payment_provider='kustom' AND status IN ('PAID','REFUND_PENDING','REFUNDED')`).bind(now,order.id)
      : db.prepare(`UPDATE quote_payment_orders SET kustom_capture_state=?,kustom_authorized_at=COALESCE(kustom_authorized_at,?),updated_at=?
         WHERE id=? AND payment_provider='kustom' AND status IN ('ACCEPTED','PAYMENT_LINK_SENT')`)
        .bind(state,state==='AUTHORIZED'?now:null,now,order.id);
    await db.batch([
      stateUpdate,
      db.prepare(`INSERT OR IGNORE INTO kustom_payment_events(event_id,order_id,kustom_order_id,kustom_session_id,received_at,processed_at,state,error_code)
        VALUES(?,?,?,?,?,?,?,NULL)`).bind(eventId,order.id,order.kustom_order_id,order.kustom_hpp_session_id,now,now,state),
    ]);
    // Verify a conditional update actually yielded the expected persisted state before acknowledging.
    const persisted=await db.prepare(`SELECT status,kustom_capture_state,paid_at,refunded_minor FROM quote_payment_orders
      WHERE id=? AND payment_provider='kustom'`).bind(order.id)
      .first<{status:string;kustom_capture_state:string|null;paid_at:number|null;refunded_minor:number}>();
    const persistedOK=Boolean(persisted && (
      (state==='REFUNDED' && persisted.status==='REFUNDED' && persisted.refunded_minor===order.amount_minor) ||
      (state==='PAID' && ['PAID','REFUNDED'].includes(persisted.status) && persisted.paid_at) ||
      (state==='AUTHORIZED' && (persisted.kustom_capture_state==='AUTHORIZED' || ['PAID','REFUNDED'].includes(persisted.status))) ||
      (state==='PENDING_REVIEW' && persisted.kustom_capture_state==='PENDING_REVIEW')
    ));
    if(!persistedOK) throw new Error('KUSTOM_DB_AVSTEMMING_MANGLER');
    // Only acknowledge after the local state and immutable event are durably stored.
    if(state==='AUTHORIZED'||state==='PAID'||state==='REFUNDED') await acknowledgeKustomManagedOrder(env,order.kustom_order_id);
    return json({ok:true});
  }catch(e){
    console.error('Kustom callback reconciliation failed',e instanceof Error?e.message:'unknown');
    // Provider retries; a scheduled polling reconciler is also required before production.
    return json({ok:false,error:'KUSTOM_MIDLERTIDIG_AVSTEMMINGSFEIL'},503);
  }
}
