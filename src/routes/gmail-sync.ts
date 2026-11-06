import type { Env } from '../types';
import { json } from '../helper';
import { getGmailTokens, syncGmailSentFolder, syncGmailInbox, extractEmailHeaders, extractEmailBody, parseGmailAddress, extractCaseIdFromSubject } from '../ops-workbench/gmail-sync';
import { syncIncoming, syncDb } from '../ops-workbench/mail-sync';

type Row = Record<string, any>;

const SYNC_STATE_KEY = 'gmail_sync';

export async function syncGmailEmails(env: Env): Promise<{ synced: number; errors: string[] }> {
  if (env.GMAIL_SYNC_ENABLED !== 'true') return { synced: 0, errors: ['Gmail sync is not enabled for this environment'] };
  const tokens = await getGmailTokens(env);
  if (!tokens) {
    return { synced: 0, errors: ['Gmail tokens not configured'] };
  }

  const db = syncDb(env);

  // Get last sync history ID
  const stateRow = await db.prepare('SELECT * FROM ops_mail_sync_state WHERE channel = ?').bind(SYNC_STATE_KEY).first<Row>();
  const lastHistoryId = stateRow?.history_id || undefined;

  const errors: string[] = [];
  let totalSynced = 0;
  let newHistoryId: string | undefined;

  try {
    // Sync INBOX (incoming emails not captured by Resend forwarding)
    const inboxResult = await syncGmailInbox(env, tokens.access_token, lastHistoryId);
    if (inboxResult) {
      for (const message of inboxResult.messages) {
        const headers = extractEmailHeaders(message);
        const { text, html } = extractEmailBody(message);
        const fromHeader = headers['from'] || '';
        const sender = parseGmailAddress(fromHeader);

        if (!sender) continue;

        // Cross-provider deduplication by RFC Message-ID
        const msgId = headers['message-id'] || message.id;
        const existing = await db.prepare('SELECT id FROM ops_messages WHERE provider_id = ?').bind(`gmail-${msgId}`).first();
        if (existing) continue;

        // Also check if message already exists via Resend by RFC Message-ID
        const rfcMsgId = headers['message-id'];
        if (rfcMsgId) {
          const existingByRfc = await db.prepare('SELECT id FROM ops_messages m JOIN ops_mail_details d ON m.provider_id = d.provider_id WHERE d.rfc_message_id = ?').bind(rfcMsgId).first();
          if (existingByRfc) continue;
        }

        // Try to link to case
        const subject = headers['subject'] || '';
        const caseId = extractCaseIdFromSubject(subject);

        // Store the message
        const now = Date.now();
        await db.batch([
          db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at) VALUES(?,?,?,'IN',?,?,?,'RECEIVED',?,'gmail',?,?)`)
            .bind(`gmail-${msgId}`, caseId || null, `gmail-${msgId}`, sender.email, subject, text || html || 'Gmail message', `gmail-${msgId}`, now, now),
          db.prepare(`INSERT OR IGNORE INTO ops_mail_details(provider_id,source,rfc_message_id,headers_json,attachments_json) VALUES(?,'gmail-sync',?,?,?)`)
            .bind(`gmail-${msgId}`, rfcMsgId, JSON.stringify(headers), JSON.stringify([])),
        ]);
        totalSynced++;
      }
      newHistoryId = inboxResult.newHistoryId;
    }
  } catch (e) {
    errors.push(`Inbox sync failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  try {
    // Sync SENT folder (manually sent emails from Gmail)
    const sentResult = await syncGmailSentFolder(env, tokens.access_token, lastHistoryId);
    if (sentResult) {
      for (const message of sentResult.messages) {
        const headers = extractEmailHeaders(message);
        const { text, html } = extractEmailBody(message);
        const toHeader = headers['to'] || '';
        const sender = parseGmailAddress(headers['from'] || '');
        const recipient = parseGmailAddress(toHeader);

        if (!sender || !recipient) continue;

        // Cross-provider deduplication by RFC Message-ID
        const msgId = headers['message-id'] || message.id;
        const existing = await db.prepare('SELECT id FROM ops_messages WHERE provider_id = ?').bind(`gmail-${msgId}`).first();
        if (existing) continue;

        const rfcMsgId = headers['message-id'];
        if (rfcMsgId) {
          const existingByRfc = await db.prepare('SELECT id FROM ops_messages m JOIN ops_mail_details d ON m.provider_id = d.provider_id WHERE d.rfc_message_id = ?').bind(rfcMsgId).first();
          if (existingByRfc) continue;
        }

        // Try to link to case
        const subject = headers['subject'] || '';
        const caseId = extractCaseIdFromSubject(subject);

        // Store the message
        const now = Date.now();
        await db.batch([
          db.prepare(`INSERT OR IGNORE INTO ops_messages(id,inquiry_id,request_id,direction,recipient,subject,body,status,provider_id,actor,created_at,updated_at) VALUES(?,?,?,'OUT',?,?,?,'SENT',?,'support · manual',?,?)`)
            .bind(`gmail-${msgId}`, caseId || null, `gmail-${msgId}`, recipient.email, subject, text || html || 'Gmail message', `gmail-${msgId}`, now, now),
          db.prepare(`INSERT OR IGNORE INTO ops_mail_details(provider_id,source,rfc_message_id,headers_json,attachments_json) VALUES(?,'gmail-sync',?,?,?)`)
            .bind(`gmail-${msgId}`, rfcMsgId, JSON.stringify(headers), JSON.stringify([])),
        ]);
        totalSynced++;
      }
      // Use the newer history ID
      if (sentResult.newHistoryId && (!newHistoryId || sentResult.newHistoryId > newHistoryId)) {
        newHistoryId = sentResult.newHistoryId;
      }
    }
  } catch (e) {
    errors.push(`Sent folder sync failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  // Update sync state
  await db.prepare(`INSERT INTO ops_mail_sync_state(channel,last_success,last_error,history_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET last_success=excluded.last_success,last_error=excluded.last_error,history_id=excluded.history_id,updated_at=excluded.updated_at`)
    .bind(SYNC_STATE_KEY, errors.length === 0 ? Date.now() : null, errors.join('; ') || null, newHistoryId || null, Date.now()).run();

  return { synced: totalSynced, errors };
}

export async function gmailSyncStatus(env: Env) {
  const db = syncDb(env);
  const row = await db.prepare('SELECT * FROM ops_mail_sync_state WHERE channel = ?').bind(SYNC_STATE_KEY).first<Row>();
  return {
    configured: !!env.GMAIL_REFRESH_TOKEN,
    lastSync: row?.last_success ?? null,
    lastError: row?.last_error ?? null,
    gmailHistoryId: row?.history_id ?? null,
  };
}

export async function renewGmailWatch(env: Env): Promise<{ success: boolean; expiration?: string; error?: string }> {
  const tokens = await getGmailTokens(env);
  if (!tokens) {
    return { success: false, error: 'Gmail tokens not configured' };
  }

  const topicName = env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    return { success: false, error: 'GMAIL_PUBSUB_TOPIC not configured' };
  }

  const { startGmailPushWatch } = await import('../ops-workbench/gmail-sync');
  const result = await startGmailPushWatch(env, tokens.access_token, topicName);

  if (!result) {
    return { success: false, error: 'Watch renewal failed' };
  }

  return { success: true, expiration: result.expiration };
}

export async function handleGmailPush(env: Env, message: any): Promise<{ processed: boolean }> {
  // Handle Pub/Sub push notification
  // Message format: { message: { data: base64EncodedData, messageId, publishTime } }
  // Data format: { emailAddress, historyId }

  if (!message?.message?.data) {
    return { processed: false };
  }

  try {
    const decoded = atob(message.message.data);
    const data = JSON.parse(decoded);

    if (!data.historyId) {
      return { processed: false };
    }

    // Trigger incremental sync with the new history ID
    await syncGmailEmails(env);

    return { processed: true };
  } catch {
    return { processed: false };
  }
}
