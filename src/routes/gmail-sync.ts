/** Read-only Gmail mirror for FinnBilGlass Operations Center.
 *  Requires explicit GMAIL_SYNC_ENABLED=true and OPS_INBOUND_ADDRESS.
 *  Never auto-sends mail, creates orders, or authorizes glass choices.
 */
import type { Env } from '../types';
import { getGmailTokens, extractEmailBody, startGmailPushWatch } from '../ops-workbench/gmail-sync';
import { syncDb } from '../ops-workbench/mail-sync';
import {
  loadGmailBatch, consumeGmailBatch, singleAddress, caseIdFromSubject,
  confirmedCaseId, gmailHeaders, type GmailSafeMessage,
} from '../ops-workbench/gmail-safe-sync';

type Row = Record<string, unknown>;
const CHANNEL = 'gmail_sync';
const MSG_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** A referenced case must match the actual correspondent, never merely the subject. */
async function findCase(db: D1Database, headers: Record<string, string>, counterparty: string): Promise<number | null> {
  const bySubject = caseIdFromSubject(headers.subject || '');
  let byReply: number | null = null;
  const reply = String(headers['in-reply-to'] || '').trim().slice(0, 300);
  if (reply) {
    const rows = await db.prepare(
      'SELECT DISTINCT m.inquiry_id AS id FROM ops_messages m '
      + 'JOIN ops_mail_details d ON d.provider_id = m.provider_id '
      + 'WHERE d.rfc_message_id = ? AND m.inquiry_id IS NOT NULL LIMIT 2'
    ).bind(reply).all<{ id: number }>();
    if (rows.results.length === 1) byReply = rows.results[0].id;
  }
  // Contradictory references are unsafe: keep the message unassigned.
  if (bySubject !== null && byReply !== null && bySubject !== byReply) return null;
  const proposed = bySubject ?? byReply;
  if (proposed === null) return null;
  const row = await db.prepare('SELECT id,kontakt FROM beta_inquiries WHERE id=?')
    .bind(proposed).first<{ id: number; kontakt: string }>();
  return confirmedCaseId(proposed, counterparty, row);
}

async function recordMessage(env: Env, message: GmailSafeMessage, mailbox: string): Promise<boolean> {
  if (!MSG_ID.test(message.id)) throw new Error('GMAIL_INVALID_MESSAGE_ID');
  const db = syncDb(env);
  const headers = gmailHeaders(message);
  const allowed = [env.OPS_INBOUND_ADDRESS, env.SUPPORT_EPOST, env.SUPPORT_FROM_EMAIL]
    .filter((v): v is string => !!v).map(singleAddress).filter((v): v is string => !!v);
  if (!allowed.length) throw new Error('GMAIL_NO_COMPANY_ALIAS');
  const from = singleAddress(headers.from);
  const to = singleAddress(headers.to);
  const emailTokens = (value: string) => [...new Set((value.match(/[A-Z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(e => e.toLowerCase()))];
  const fromTokens = emailTokens(headers.from || '');
  const toTokens = emailTokens(headers.to || '');
  const hasCompanySender = fromTokens.some(e => allowed.includes(e));
  const hasCompanyRecipient = toTokens.some(e => allowed.includes(e));
  const sent = message.labelIds?.includes('SENT') === true;
  const inbox = message.labelIds?.includes('INBOX') === true;
  // Ignore personal and unrelated Gmail messages, and ambiguous multi-address headers.
  if (!sent && !inbox) return false;
  if (sent && !hasCompanySender) return false;
  if (!sent && (!hasCompanyRecipient || (from === mailbox && hasCompanySender))) return false;
  // Multi-recipient or malformed headers must remain visible but unassigned.
  const counterpart = sent ? (to || String(headers.to || '').slice(0, 240))
    : (from || String(headers.from || '').slice(0, 240));
  if (!counterpart || allowed.includes(counterpart)) return false;
  const safeToAutoLink = !!from && !!to && fromTokens.length === 1 && toTokens.length === 1;

  const providerId = 'gmail-' + message.id;
  const existing = await db.prepare('SELECT id FROM ops_messages WHERE provider_id=?')
    .bind(providerId).first();
  if (existing) return false;
  const rfcMessageId = String(headers['message-id'] || '').trim().slice(0, 300);
  if (rfcMessageId) {
    const crossProvider = await db.prepare(
      'SELECT m.id FROM ops_messages m JOIN ops_mail_details d ON m.provider_id = d.provider_id '
      + 'WHERE d.rfc_message_id = ? LIMIT 1',
    ).bind(rfcMessageId).first();
    if (crossProvider) return false;
  }
  const inquiryId = safeToAutoLink ? await findCase(db, headers, counterpart) : null;
  const parts = extractEmailBody(message as Parameters<typeof extractEmailBody>[0]);
  const plain = (parts.text || parts.html.replace(/<[^>]*>/g, ' ')).slice(0, 30000);
  const subject = String(headers.subject || '(uten emne)').slice(0, 250);
  const now = Date.now();
  // One transaction: no partial state if details insertion fails.
  const results = await db.batch([
    db.prepare(
      'INSERT OR IGNORE INTO ops_messages('
      + 'id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at'
      + ') VALUES(?,?,?, ?,?,?,?, ?,?,?,?,?)',
    ).bind(providerId, inquiryId, providerId, sent ? 'OUT' : 'IN', counterpart, subject, plain || '(ingen tekst)',
      sent ? 'SENT' : 'RECEIVED', providerId, sent ? 'gmail-manual' : 'customer', now, now),
    db.prepare(
      'INSERT OR IGNORE INTO ops_mail_details(provider_id,source,rfc_message_id,headers_json,attachments_json)'
      + ' VALUES(?, ?,?,?,?)',
    ).bind(providerId, 'gmail-sync', rfcMessageId || null,
      JSON.stringify({ 'message-id': rfcMessageId || null, 'in-reply-to': headers['in-reply-to'] || null,
        gmailThreadId: message.threadId || null }), '[]'),
  ]);
  return results[0]?.meta.changes === 1;
}

export interface GmailSyncResult { synced: number; errors: string[]; mode?: 'incremental' | 'full' }
export async function syncGmailEmails(env: Env): Promise<GmailSyncResult> {
  if (env.GMAIL_SYNC_ENABLED !== 'true') return { synced: 0, errors: ['Gmail sync is disabled'] };
  if (!singleAddress(env.OPS_INBOUND_ADDRESS)) return { synced: 0, errors: ['OPS_INBOUND_ADDRESS is required'] };
  const tokens = await getGmailTokens(env);
  if (!tokens) return { synced: 0, errors: ['Gmail OAuth not configured'] };
  const db = syncDb(env);
  const row = await db.prepare('SELECT history_id FROM ops_mail_sync_state WHERE channel=?')
    .bind(CHANNEL).first<{ history_id: string | null }>();
  const originalCursor = row?.history_id ?? null;
  try {
    const batch = await loadGmailBatch(tokens.access_token, originalCursor);
    let imported = 0;
    await consumeGmailBatch(batch,
      async (message, mailbox) => { if (await recordMessage(env, message, mailbox)) imported++; },
      async (newCursor) => {
        // Store progress only after all pages and messages were persisted.
        // Do not overwrite a cursor advanced by a competing sync run.
        if (row) {
          const updated = await db.prepare(
            'UPDATE ops_mail_sync_state SET history_id=?,last_success=?,last_error=NULL,updated_at=? '
            + 'WHERE channel=? AND history_id IS ?',
          ).bind(newCursor, Date.now(), Date.now(), CHANNEL, originalCursor).run();
          if (updated.meta.changes !== 1) throw new Error('GMAIL_CURSOR_CONFLICT');
        } else {
          const inserted = await db.prepare(
            'INSERT OR IGNORE INTO ops_mail_sync_state(channel,last_success,last_error,history_id,updated_at)'
            + ' VALUES(?,?,?,?,?)',
          ).bind(CHANNEL, Date.now(), null, newCursor, Date.now()).run();
          if (inserted.meta.changes !== 1) throw new Error('GMAIL_CURSOR_CONFLICT');
        }
      },
    );
    return { synced: imported, errors: [], mode: batch.mode };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'GMAIL_SYNC_FAILED';
    // Important: do not update history_id on failure.
    try {
      await db.prepare(
        'INSERT INTO ops_mail_sync_state(channel,last_error,updated_at) VALUES(?,?,?) '
        + 'ON CONFLICT(channel) DO UPDATE SET last_error=excluded.last_error,updated_at=excluded.updated_at'
      ).bind(CHANNEL, error.slice(0, 200), Date.now()).run();
    } catch { /* preserve original error and cursor */ }
    return { synced: 0, errors: [error] };
  }
}
export async function gmailSyncStatus(env: Env) {
  const db = syncDb(env);
  const row = await db.prepare('SELECT * FROM ops_mail_sync_state WHERE channel=?').bind(CHANNEL).first<Row>();
  return {
    configured: !!(env.GMAIL_REFRESH_TOKEN && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    enabled: env.GMAIL_SYNC_ENABLED === 'true',
    lastSync: row?.last_success ?? null,
    lastError: row?.last_error ?? null,
    gmailHistoryId: row?.history_id ?? null,
  };
}
export async function renewGmailWatch(env: Env): Promise<{ success: boolean; expiration?: string; error?: string }> {
  if (env.GMAIL_SYNC_ENABLED !== 'true') return { success: false, error: 'Gmail sync is disabled' };
  const tokens = await getGmailTokens(env);
  if (!tokens || !env.GMAIL_PUBSUB_TOPIC) return { success: false, error: 'Gmail OAuth/topic missing' };
  const result = await startGmailPushWatch(env, tokens.access_token, env.GMAIL_PUBSUB_TOPIC);
  return result ? { success: true, expiration: result.expiration } : { success: false, error: 'Gmail watch failed' };
}
/** Pub/Sub transport authentication MUST be enforced before calling this helper. */
export async function handleGmailPush(env: Env, body: unknown): Promise<{ processed: boolean }> {
  if (!body || typeof body !== 'object') return { processed: false };
  const payload = body as { message?: { data?: string } };
  if (typeof payload.message?.data !== 'string') return { processed: false };
  // No publicly exposed route accepts unsigned Pub/Sub payloads.
  const sync = await syncGmailEmails(env);
  return { processed: sync.errors.length === 0 };
}
