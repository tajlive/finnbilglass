/** Permanent single-attempt customer reply delivery.
 * Resend idempotency is only short-lived; D1 is the durable safety boundary.
 * Never auto-retry a SENDING / REVIEW / legacy FAILED request.
 */
import type { Env } from './types';
import { buildCaseReplyPayload, sendMail, type Mail } from './mail';

export type ReplySendResult = {
  ok: boolean;
  status: 'SENT' | 'REVIEW' | 'REJECTED';
  alreadySent?: boolean;
  requiresReview?: boolean;
  error?: string;
};
export type ReplySendInput = {
  requestId: string;
  inquiryId: number;
  actor: string;
  staffEmail?: string;
  recipient: string;
  customerName: string | null;
  regnr: string | null;
  body: string;
  createdAt: number;
};
type ReplyOutboxRow = {
  inquiry_id: number; actor_email: string; recipient: string;
  body: string; status: string; provider_message_id: string | null;
};
type ReplyProvider = (env: Env, mail: Mail) =>
  Promise<{ ok: boolean; id?: string; error?: string }>;

const needsReview = (): ReplySendResult => ({
  ok: false, status: 'REVIEW', requiresReview: true,
  error: 'UTSENDING_MA_AVSTEMMES_MANUELT'
});

export async function sendDurableOpsReply(
  env: Env, input: ReplySendInput, provider: ReplyProvider = sendMail
): Promise<ReplySendResult> {
  const db = env.FINNBILGLASS_DB;
  // No synthetic test inbox may ever receive real Resend mail.
  const domain = input.recipient.trim().split('@')[1]?.toLowerCase() ?? '';
  if (/(^|\.)(invalid|test|example|localhost)$/.test(domain)) {
    return {ok:false,status:'REJECTED',error:'SYNTETISK_MOTTAKER_FORBUDT'};
  }
  const frozen = buildCaseReplyPayload(
    env,input.recipient,input.customerName,input.regnr,input.body
  );
  const now = input.createdAt;

  // Existing legacy rows are never rewritten. The additive migration places
  // ambiguous old QUEUED/FAILED rows into attempts.REVIEW before activation.
  await db.prepare(
    "INSERT OR IGNORE INTO ops_reply_outbox(" +
    "request_id,inquiry_id,actor_email,recipient,body,status,created_at,updated_at) " +
    "VALUES(?,?,?,?,?,'QUEUED',?,?)"
  ).bind(input.requestId,input.inquiryId,input.actor,input.recipient,input.body,now,now).run();

  const original = await db.prepare(
    'SELECT inquiry_id,actor_email,recipient,body,status,provider_message_id ' +
    'FROM ops_reply_outbox WHERE request_id=?'
  ).bind(input.requestId).first<ReplyOutboxRow>();
  if (!original || original.inquiry_id!==input.inquiryId ||
      original.actor_email!==input.actor || original.recipient!==input.recipient ||
      original.body!==input.body) {
    return {ok:false,status:'REJECTED',error:'MELDINGSNOKKEL_BRUKT_MED_ANNET_INNHOLD'};
  }
  if (original.status==='SENT' && original.provider_message_id) {
    return {ok:true,status:'SENT',alreadySent:true};
  }
  if (original.status!=='QUEUED') return needsReview();

  // UNIQUE request_id atomically reserves *the only* provider attempt.
  // Even if a worker crashes between this INSERT and the provider call,
  // all later callers are blocked until an operator reconciles the attempt.
  const claim = await db.prepare(
    "INSERT OR IGNORE INTO ops_reply_attempts(" +
    "request_id,inquiry_id,actor_email,recipient,body,sender,subject," +
    "text_body,html_body,status,created_at,updated_at) " +
    "VALUES(?,?,?,?,?,?,?,?,?,'SENDING',?,?)"
  ).bind(
    input.requestId,input.inquiryId,input.actor,input.recipient,input.body,
    frozen.from!,frozen.subject,frozen.text,frozen.html,now,now
  ).run();
  if (Number(claim.meta?.changes ?? 0)!==1) return needsReview();

  let delivery: { ok: boolean; id?: string; error?: string };
  try {
    // Send exactly the immutable payload written above, with a stable key.
    delivery = await provider(env,{...frozen,idempotencyKey:'ops-reply-'+input.requestId});
  } catch {
    // Provider may have accepted before the request errored.
    delivery = {ok:false,error:'PROVIDER_OUTCOME_UNKNOWN'};
  }

  if (!delivery.ok || !delivery.id) {
    try {
      await db.prepare(
        "UPDATE ops_reply_attempts SET status='REVIEW',updated_at=? " +
        "WHERE request_id=? AND status='SENDING'"
      ).bind(Date.now(),input.requestId).run();
    } catch { /* SENDING is also a permanent no-retry state. */ }
    return needsReview();
  }

  const completedAt = Date.now();
  try {
    // D1 batch is one transaction. A journal/audit failure leaves the
    // claim as SENDING, not a retryable QUEUED request.
    const statements = [
      db.prepare("UPDATE ops_reply_outbox SET status='SENT',provider_message_id=?,error=NULL,updated_at=? WHERE request_id=? AND status='QUEUED'")
        .bind(delivery.id,completedAt,input.requestId),
      db.prepare("UPDATE ops_reply_attempts SET status='SENT',provider_message_id=?,updated_at=? WHERE request_id=? AND status='SENDING'")
        .bind(delivery.id,completedAt,input.requestId),
      db.prepare(
        "INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by,meta_json) " +
        "VALUES(?,?,'reply',?,?,?,?)"
      ).bind('reply-'+input.requestId,input.inquiryId,input.body,completedAt,input.actor,
        JSON.stringify({to:input.recipient,provider:'resend',
          provider_message_id:delivery.id,request_id:input.requestId})),
      ...(input.staffEmail ? [db.prepare(
        "INSERT OR IGNORE INTO ops_staff_activity(event_id,actor_email,action,subject_type,subject_id,created_at,details_json) " +
        "VALUES(?,?,'INQUIRY_REPLY_SENT','INQUIRY',?,?,'{}')"
      ).bind('audit-reply-'+input.requestId,input.staffEmail,String(input.inquiryId),completedAt)] : []),
    ];
    const persisted = await db.batch(statements);
    if (Number(persisted[0]?.meta?.changes ?? 0)!==1 ||
        Number(persisted[1]?.meta?.changes ?? 0)!==1) return needsReview();
    return {ok:true,status:'SENT'};
  } catch {
    return needsReview();
  }
}
