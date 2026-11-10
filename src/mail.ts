/**
 * E-postutsending — én vei.
 *
 * Brevo-kontoen er slettet (2026-11-04). All utgående post går via Resend, som
 * også er det som leverer kvitteringene uten `List-Unsubscribe`. Funksjonen er
 * bevisst tynn: kallstedene eier innholdet, denne eier transporten og feilene.
 */
import type { Env } from './types';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Kunden skal kunne svare til denne adressen. Utelates for interne varsler. */
  replyTo?: string;
  idempotencyKey?: string;
}

/** Avsenderadressen. Domenet er verifisert hos Resend. */
export function avsenderEpost(env: Env): string {
  return env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
}

/** Sender én e-post via Resend. Returnerer aldri «ok» uten at API-et svarte 2xx. */
export async function sendMail(env: Env, mail: Mail): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY mangler' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(mail.idempotencyKey ? { 'Idempotency-Key': mail.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `Finnbilglass <${avsenderEpost(env)}>`,
        to: [mail.to],
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `Resend ${r.status}${txt ? ': ' + txt.slice(0, 160) : ''}` };
    }
    // Resend returns an ID for delivery reconciliation. 2xx is authoritative even if JSON is absent.
    const response: unknown = await r.json().catch(() => null);
    const id = response && typeof response === 'object' && 'id' in response && typeof response.id === 'string' ? response.id : undefined;
    return { ok: true, ...(id ? { id } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ukjent feil ved e-postutsending.' };
  }
}


/** Format a staff-approved case reply. Never makes an automatic glass/price decision. */
export async function sendCaseReply(
  env: Env, to: string, navn: string | null, regnr: string | null, message: string, idempotencyKey?: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const from = avsenderEpost(env);
  const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
  const subject = `Svar fra FinnBilglass — din forespørsel${regnr ? ' (' + regnr + ')' : ''}`;
  const html = '<p>Hei' + (navn ? ' ' + esc(navn) : '') + ',</p>'
    + '<p>' + esc(message).replace(/\n/g, '<br>') + '</p>'
    + '<p>— FinnBilglass</p>'
    + '<p style="color:#637286;font-size:12px">Svar på e-post til ' + esc(from)
    + '. Vi svarer gjerne på spørsmål om glasset eller leveransen.</p>';
  return sendMail(env, {
    to, subject, html, text: `Hei${navn ? ' ' + navn : ''}.
${message}
— FinnBilglass`,
    replyTo: from,
    idempotencyKey,
  });
}
