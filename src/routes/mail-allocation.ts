/** Explicit staff assignment for messages that cannot be safely auto-linked.
 *  Auth is enforced in src/index.ts. Every mutation must be justified and logged.
 */
import type { Env } from '../types';
import { syncDb } from '../ops-workbench/mail-sync';
import { singleAddress } from '../ops-workbench/gmail-safe-sync';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface Unassigned {
  id: string; direction: string; recipient: string; subject: string;
  body: string; created_at: number;
}

/** Read-only queue, never silently assigns by customer identity alone. */
export async function unassignedMail(env: Env): Promise<Response> {
  const db = syncDb(env);
  const rows = await db.prepare(
    "SELECT id,direction,recipient,subject,body,created_at FROM ops_messages "
    + "WHERE inquiry_id IS NULL AND direction IN ('IN','OUT') "
    + "ORDER BY created_at DESC LIMIT 100",
  ).all<Unassigned>();
  return json({ ok: true, messages: (rows.results || []).map(row => ({
    ...row, body: String(row.body || '').slice(0, 280),
  })) });
}

/** Assignment cannot override a contradictory customer address. */
export async function assignUnmatchedMail(
  env: Env, request: Request, messageId: string, actor: string,
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{1,210}$/.test(messageId)) return json({ ok: false, error: 'UGYLDIG_MELDINGSID' }, 400);
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'UGYLDIG_JSON' }, 400); }
  const inquiryId = input.inquiryId;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (typeof inquiryId !== 'number' || !Number.isSafeInteger(inquiryId) || Number(inquiryId) <= 0 || reason.length < 12 || reason.length > 300) {
    return json({ ok: false, error: 'SAK_OG_BEGRUNNELSE_PAKREVD' }, 400);
  }
  const db = syncDb(env);
  const message = await db.prepare(
    'SELECT id,direction,recipient,inquiry_id FROM ops_messages WHERE id=?',
  ).bind(messageId).first<{ id: string; direction: string; recipient: string; inquiry_id: number | null }>();
  if (!message) return json({ ok: false, error: 'MELDING_IKKE_FUNNET' }, 404);
  if (message.inquiry_id !== null) return json({ ok: false, error: 'MELDING_ALLEREDE_FORDELT' }, 409);
  const inquiry = await db.prepare('SELECT id,kontakt FROM beta_inquiries WHERE id=?')
    .bind(inquiryId).first<{ id: number; kontakt: string }>();
  if (!inquiry) return json({ ok: false, error: 'SAK_IKKE_FUNNET' }, 404);
  const expected = singleAddress(inquiry.kontakt);
  if (!expected || expected !== singleAddress(message.recipient)) {
    return json({ ok: false, error: 'KUNDEADRESSE_SAMSVARER_IKKE' }, 409);
  }
  const now = Date.now();
  const auditId = 'mail-assign-' + messageId;
  const result = await db.batch([
    db.prepare('UPDATE ops_messages SET inquiry_id=?,updated_at=? WHERE id=? AND inquiry_id IS NULL')
      .bind(inquiryId, now, messageId),
    db.prepare(
      "INSERT OR IGNORE INTO beta_inquiry_events(event_id,inquiry_id,event_type,note,created_at,created_by,meta_json) "
      + "SELECT ?, ?, 'note', ?, ?, ?, ? FROM ops_messages "
      + "WHERE id=? AND inquiry_id=?",
    ).bind(auditId, inquiryId, 'E-post tilordnet manuelt: ' + reason,
      now, actor, JSON.stringify({ messageId, reason, source: 'manual_assignment' }), messageId, inquiryId),
  ]);
  if (result[0]?.meta.changes !== 1) return json({ ok: false, error: 'MELDING_ENDRET_UNDER_FORDELING' }, 409);
  return json({ ok: true, inquiryId, messageId });
}
