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
    const providerId = payload?.data?.email_id;
    if (typeof providerId !== 'string') return new Response('Mangler meldings-ID', { status: 400 });
    const incoming = await syncIncoming(env, providerId, payload.data.to);
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
    const rader = await db.prepare(
        `SELECT event_id, event_type, note, created_at, created_by, meta_json
        FROM beta_inquiry_events
        WHERE inquiry_id = ? AND event_type IN ('reply', 'status', 'note')
        ORDER BY created_at DESC LIMIT 100`
    ).bind(inquiryId).all<Row>();

    const historikk = (rader.results ?? []).map(r => ({
        tid: r.created_at,
        type: r.event_type,
        fra: r.created_by,
        innhold: r.note,
        meta: r.meta_json ? JSON.parse(String(r.meta_json)) : null
    }));

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
