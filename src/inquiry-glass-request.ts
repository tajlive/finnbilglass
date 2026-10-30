import { normalizeGlassRequest, type GlassRequest } from './glass-selection';

export interface InquiryGlassInput {
  regnr: string;
  name: string;
  contact: string;
  message: string;
  sessionId: string | null;
  glassRequest: GlassRequest | null;
  clientRequestId: string | null;
  vehicleJson: string | null;
}

export interface StoredInquiryResult { id: number | null; created: boolean; conflict: boolean; }

async function fingerprint(input: InquiryGlassInput): Promise<string> {
  const glass = input.glassRequest ? normalizeGlassRequest(input.glassRequest) : null;
  const stable = JSON.stringify({
    regnr: input.regnr.toUpperCase().replace(/[\s\-–—.]+/g, ''),
    name: input.name.trim(), contact: input.contact.trim().toLowerCase(), message: input.message.trim(), glass,
  });
  const bytes = new TextEncoder().encode(stable);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export function isValidClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(value);
}

export async function persistInquiry(db: D1Database, input: InquiryGlassInput): Promise<StoredInquiryResult> {
  // The active windshield-only flow predates the additive multi-glass columns.
  // Keep it usable against existing D1 databases while those categories are paused.
  if (!input.glassRequest && !input.clientRequestId) {
    const inserted = await db.prepare(
      'INSERT INTO beta_inquiries (regnr, navn, kontakt, melding, session_id, vehicle_json) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(input.regnr || null, input.name, input.contact, input.message || null, input.sessionId, input.vehicleJson).run();
    const id = typeof inserted.meta?.last_row_id === 'number' && inserted.meta.last_row_id > 0 ? inserted.meta.last_row_id : null;
    if (id) {
      try {
        await db.prepare(
          "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by) VALUES (?, ?, 'created', NULL, 'NEW', ?, ?, 'kunde')"
        ).bind(`created-${id}-${crypto.randomUUID()}`, id, input.message || null, Date.now()).run();
      } catch {
        // Preserve the historical behavior: an event write failure does not lose the inquiry.
      }
    }
    return { id, created: true, conflict: false };
  }

  const requestFingerprint = await fingerprint(input);
  const glassJson = input.glassRequest ? JSON.stringify(input.glassRequest) : null;
  const createdAt = Date.now();
  const statement = 'INSERT INTO beta_inquiries (regnr, navn, kontakt, melding, session_id, vehicle_json, glass_request_json, client_request_id, request_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING';
  const values = [input.regnr || null, input.name, input.contact, input.message || null, input.sessionId, input.vehicleJson, glassJson];
  values.push(input.clientRequestId);
  values.push(requestFingerprint);
  const insertStatement = db.prepare(statement).bind(...values);
  const createdEventStatement = db.prepare(
    "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, previous_status, status, note, created_at, created_by) " +
    "SELECT 'created-' || id || '-' || lower(hex(randomblob(12))), id, 'created', NULL, 'NEW', ?, ?, 'kunde' " +
    'FROM beta_inquiries WHERE id = last_insert_rowid() AND changes() = 1',
  ).bind(input.message || null, createdAt);
  const [inserted] = await db.batch([insertStatement, createdEventStatement]);
  const id = typeof inserted.meta?.last_row_id === 'number' && inserted.meta.last_row_id > 0 ? inserted.meta.last_row_id : null;
  const wasCreated = (inserted.meta?.changes ?? 0) > 0;
  let row: { id: number; request_fingerprint: string | null } | null = null;
  if (input.clientRequestId) {
    row = await db.prepare('SELECT id, request_fingerprint FROM beta_inquiries WHERE client_request_id = ?')
      .bind(input.clientRequestId).first<{ id: number; request_fingerprint: string | null }>();
    if (!row) throw new Error('Idempotent inquiry insert did not produce a row');
    if (row.request_fingerprint !== requestFingerprint) return { id: row.id, created: false, conflict: true };
  }
  const inquiryId = row?.id ?? id;
  if (!inquiryId) throw new Error('Inquiry insert returned no id');
  return { id: inquiryId, created: wasCreated, conflict: false };
}
