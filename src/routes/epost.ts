import type { Env } from '../types';
import { json } from '../helper';
import { syncIncoming, verifyResendWebhook } from '../ops-workbench/mail-sync';
import { sendMail } from '../mail';

type Row = Record<string, any>;

/**
 * Webhook for innhentende e-post (Resend)
 * Resend sender automatisk en POST til /api/ops/epost/mottak
 * med JSON payload som inneholder e-post detaljer
 */
export async function mottakEpost(env: Env, request: Request) {
    // Verify Svix webhook signature
    const rawBody = await request.text();
    const verified = await verifyResendWebhook(env, rawBody, request.headers);
    if (!verified) {
        return new Response('Ugyldig webhook-signatur', { status: 401 });
    }

    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return new Response('Ugyldig JSON', { status: 400 }); }
    if (payload?.type !== 'email.received') return new Response('Ignorert', { status: 200 });
    if (!env.OPS_INBOUND_ADDRESS) return new Response('Innkommende supportadresse ikke konfigurert', { status: 503 });
    const providerId = payload?.data?.email_id;
    if (typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(providerId)) {
        return new Response('Mangler gyldig meldings-ID', { status: 400 });
    }
    // Never acknowledge a genuine receive event with missing recipients.
    // Resend retries a non-2xx response; silently ignoring it loses mail.
    const recipients = Array.isArray(payload?.data?.to) ? payload.data.to : [payload?.data?.to];
    if (!recipients.some((address: unknown) =>
        typeof address === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()))) {
        return new Response('Mottaker mangler fra webhooksvar', { status: 422 });
    }
    const incoming = await syncIncoming(env, providerId, recipients);
    if ('ignored' in incoming && incoming.ignored) {
        return new Response('Mottak av annen tjeneste', { status: 200 });
    }
    if (!incoming.ok) {
        return new Response(`Feil ved mottak: ${(incoming as any).error}`, { status: 500 });
    }
    // OK: mail mottatt og lagret i DB

    return new Response('Mottatt', { status: 200 });
}

/**
 * API for å hente e-posthistorikk per sak
 */
export async function getEpostHistorikk(env: Env, inquiryId: number) {
    const db = getInquiryDb(env);
    const inquiry = await db.prepare('SELECT id FROM beta_inquiries WHERE id=?').bind(inquiryId).first();
    if (!inquiry) return json({ ok: false, error: 'SAK_IKKE_FUNNET' }, 404);

    // Both the legacy activity log and the canonical message ledger are visible on the case.
    // Never match by sender alone: this query only selects an already verified inquiry_id.
    const [activity, messages] = await Promise.all([
        db.prepare(
            "SELECT event_id,event_type,note,created_at,created_by,meta_json FROM beta_inquiry_events " +
            "WHERE inquiry_id=? AND event_type IN ('reply','status','note') ORDER BY created_at DESC LIMIT 100"
        ).bind(inquiryId).all<Row>(),
        db.prepare(
            "SELECT id,direction,recipient,subject,body,status,provider_id,actor,created_at " +
            "FROM ops_messages WHERE inquiry_id=? AND status<>'DRAFT' ORDER BY created_at DESC LIMIT 100"
        ).bind(inquiryId).all<Row>(),
    ]);

    const canonical = messages.results || [];
    const providerIds = new Set(canonical.map(m => String(m.provider_id || '')).filter(Boolean));
    const old = (activity.results || []).flatMap(row => {
        let metadata: Record<string, unknown> | null = null;
        try {
            if (row.meta_json) metadata = JSON.parse(String(row.meta_json)) as Record<string, unknown>;
        } catch { metadata = null; }
        // A Resend send recorded in both ledgers appears just once.
        if (metadata?.provider_message_id && providerIds.has(String(metadata.provider_message_id))) return [];
        return [{
            id: String(row.event_id),
            tid: Number(row.created_at),
            type: row.event_type,
            fra: row.created_by,
            innhold: row.note,
            meta: metadata,
        }];
    });
    const synced = canonical.map(row => ({
        id: String(row.id),
        tid: Number(row.created_at),
        type: row.direction === 'IN' ? 'incoming' : 'sent',
        fra: row.direction === 'IN' ? 'kunde' : row.actor || 'ansatt',
        innhold: row.body,
        meta: {
            source: 'ops_messages', direction: row.direction, status: row.status,
            subject: row.subject, recipient: row.recipient, providerId: row.provider_id,
        },
    }));
    const historikk = [...old, ...synced].sort((a, b) => b.tid - a.tid);
    return json({ ok: true, historikk });
}

/**
 * API for å sende manuelle e-post fra supportadressen
 */
export async function sendManuellEpost(env: Env, request: Request) {
    const { to, subject, text, caseContext } = await request.json() as any;

    if (!to || !subject || !text) {
        return new Response('Mangler nødvendig informasjon', { status: 400 });
    }

    const mail: any = {
        to,
        subject,
        text,
        caseContext: caseContext || { kind: 'reply', actor: 'support' }
    };

    const result = await sendMail(env, mail);
    if (!result.ok) {
        return new Response(`Feil ved sending: ${result.error}`, { status: 500 });
    }

    return new Response('E-post sendt', { status: 200 });
}

function getInquiryDb(env: Env): D1Database {
    if (env.ENVIRONMENT === 'staging') {
        if (!env.FINNBILGLASS_STAGING_AUTH) {
            throw new Error('STAGING_MISSING_D1_BINDING: FINNBILGLASS_STAGING_AUTH er ikke konfigurert');
        }
        return env.FINNBILGLASS_STAGING_AUTH;
    }
    return env.FINNBILGLASS_DB;
}
