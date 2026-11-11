/**
 * Manual Ops order logic. Deliberately NO HTTP routes, cron, Kustom API,
 * checkout, capture, refund or automatic payment status.
 *
 * Callers must authenticate staff identity + MFA/Access and audit actions
 * before these helpers are connected to an Operations Centre endpoint.
 */
type ValidChannel = 'EMAIL' | 'PHONE' | 'WRITTEN';
type AcceptedOfferRow = {
  offer_id: string;
  inquiry_id: number;
  sku: string;
  total_minor: number;
  currency: 'NOK';
  status: string;
  accepted_at: number | null;
  accepted_channel: string | null;
  acceptance_ref: string | null;
};

export type ManualOrderRow = {
  order_id: string;
  inquiry_id: number;
  offer_id: string;
  sku: string;
  total_minor: number;
  currency: 'NOK';
  status: string;
};

const VALID_ID = /^[A-Za-z0-9_-]{8,100}$/;
const VALID_ACTOR = /^[A-Za-z0-9@ _.-]{2,254}$/;

function assertId(id: string): void {
  if (!VALID_ID.test(id)) throw new Error('OPS_MANUAL_INVALID_ID');
}
function assertActor(actor: string): void {
  if (!VALID_ACTOR.test(actor)) throw new Error('OPS_MANUAL_INVALID_ACTOR');
}
function assertTime(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('OPS_MANUAL_INVALID_TIMESTAMP');
}

type AuditAction = 'OFFER_ACCEPTED' | 'ORDER_CREATED' | 'PAYMENT_LINK_RECORDED';
type AuditInfo = {
  eventId: string;
  actor: string;
  action: AuditAction;
  subjectType: 'OFFER' | 'ORDER';
  subjectId: string;
  at: number;
};

/** Batch is a single D1 transaction. The audit INSERT only executes if the
 * previous write changed one row. A failed audit rolls back the business write.
 * Standalone service callers may omit audit; HTTP handlers MUST enable it.
 */
async function persistWithAudit(db: D1Database, mutation: D1PreparedStatement,
    audit: AuditInfo | null) {
  if (!audit) return mutation.run();
  const event = db.prepare(
    "INSERT INTO ops_staff_activity(event_id,actor_email,action,subject_type,subject_id,created_at,details_json) " +
    "SELECT ?,?,?,?,?,?,'{}' WHERE changes() = 1"
  ).bind(audit.eventId,audit.actor,audit.action,audit.subjectType,audit.subjectId,audit.at);
  const results = await db.batch([mutation,event]);
  return results[0];
}

/** A staff member records customer acceptance verified in an existing channel. */
export async function recordCustomerAcceptance(
  db: D1Database,
  input: {
    offerId: string;
    actor: string;
    acceptedAt: number;
    channel: ValidChannel;
    evidenceReference: string;
    audit?: boolean;
  }
): Promise<{ offerId: string; recorded: boolean }> {
  assertId(input.offerId);
  assertActor(input.actor);
  assertTime(input.acceptedAt);
  if (!['EMAIL','PHONE','WRITTEN'].includes(input.channel) ||
      typeof input.evidenceReference !== 'string' ||
      input.evidenceReference.trim().length < 8 ||
      input.evidenceReference.length > 200 ||
      /[\r\n]/.test(input.evidenceReference)) {
    throw new Error('OPS_MANUAL_ACCEPTANCE_EVIDENCE_REQUIRED');
  }
  const evidence = input.evidenceReference.trim();
  const write = db.prepare(
    "UPDATE ops_manual_offers SET status='ACCEPTED',accepted_at=?," +
    'accepted_channel=?,acceptance_ref=? ' +
    "WHERE offer_id=? AND status='SENT' AND sent_at IS NOT NULL AND sent_at<=?"
  ).bind(input.acceptedAt,input.channel,evidence,input.offerId,input.acceptedAt);
  const result = await persistWithAudit(db,write,input.audit?{
    eventId:'audit-offer-accepted-'+input.offerId,actor:input.actor,
    action:'OFFER_ACCEPTED',subjectType:'OFFER',subjectId:input.offerId,at:input.acceptedAt
  }:null);
  if (result.meta.changes === 1) return { offerId: input.offerId, recorded: true };
  const prior = await db.prepare(
    'SELECT offer_id,inquiry_id,sku,total_minor,currency,status,accepted_at,' +
    'accepted_channel,acceptance_ref FROM ops_manual_offers WHERE offer_id=?'
  ).bind(input.offerId).first<AcceptedOfferRow>();
  if (prior?.status === 'ACCEPTED' && prior.accepted_at === input.acceptedAt &&
      prior.accepted_channel === input.channel && prior.acceptance_ref === evidence) {
    return { offerId: input.offerId, recorded: false };
  }
  throw new Error('OPS_MANUAL_OFFER_NOT_SENT_OR_ALREADY_CHANGED');
}

/** Atomic INSERT ... SELECT: a customer acceptance must already be persisted.
 * offer_id and inquiry_id remain unique in SQLite/D1 for concurrent retries.
 */
export async function createOrderFromAcceptedOffer(
  db: D1Database,
  input: { offerId: string; orderId: string; actor: string; createdAt: number; audit?: boolean }
): Promise<{ order: ManualOrderRow; created: boolean }> {
  assertId(input.offerId);
  assertId(input.orderId);
  assertActor(input.actor);
  assertTime(input.createdAt);
  const statement = db.prepare(
    'INSERT INTO ops_manual_orders (order_id,inquiry_id,offer_id,sku,total_minor,' +
    'currency,created_at,created_by) ' +
    'SELECT ?,inquiry_id,offer_id,sku,total_minor,currency,?,? FROM ops_manual_offers ' +
    "WHERE offer_id=? AND status='ACCEPTED' AND accepted_at IS NOT NULL " +
    'ON CONFLICT(offer_id) DO NOTHING'
  ).bind(input.orderId,input.createdAt,input.actor,input.offerId);
  const write = await persistWithAudit(db,statement,input.audit?{
    eventId:'audit-order-created-'+input.orderId,actor:input.actor,
    action:'ORDER_CREATED',subjectType:'ORDER',subjectId:input.orderId,at:input.createdAt
  }:null);
  const order = await db.prepare(
    'SELECT order_id,inquiry_id,offer_id,sku,total_minor,currency,status ' +
    'FROM ops_manual_orders WHERE offer_id=?'
  ).bind(input.offerId).first<ManualOrderRow>();
  if (!order || order.offer_id !== input.offerId) throw new Error('OPS_MANUAL_OFFER_NOT_ACCEPTED');
  return { order, created: Number(write.meta.changes ?? 0) === 1 };
}

/** Records an external Kustom Portal payment link reference entered by staff.
 * Does NOT create or send the link.
 */
export async function recordPortalPaymentLink(
  db: D1Database,
  input: { orderId: string; reference: string; sentAt: number; actor?: string; audit?: boolean }
): Promise<boolean> {
  assertId(input.orderId);
  assertTime(input.sentAt);
  if (typeof input.reference !== 'string' ||
      input.reference.trim().length < 8 || input.reference.length > 200 ||
      /[\r\n]/.test(input.reference)) throw new Error('OPS_MANUAL_LINK_REF_REQUIRED');
  if (input.audit && (!input.actor || !VALID_ACTOR.test(input.actor))) {
    throw new Error('OPS_MANUAL_INVALID_ACTOR');
  }
  const statement = db.prepare(
    "UPDATE ops_manual_orders SET status='PAYMENT_LINK_SENT'," +
    'payment_link_reference=?,payment_link_sent_at=? ' +
    "WHERE order_id=? AND status='ORDER_CREATED'"
  ).bind(input.reference.trim(),input.sentAt,input.orderId);
  const update = await persistWithAudit(db,statement,input.audit?{
    eventId:'audit-payment-link-'+input.orderId,actor:input.actor!,
    action:'PAYMENT_LINK_RECORDED',subjectType:'ORDER',subjectId:input.orderId,at:input.sentAt
  }:null);
  return Number(update.meta.changes ?? 0) === 1;
}
