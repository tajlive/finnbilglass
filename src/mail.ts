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
}

/** Avsenderadressen. Domenet er verifisert hos Resend. */
export function avsenderEpost(env: Env): string {
  return env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
}

/** Sender én e-post via Resend. Returnerer aldri «ok» uten at API-et svarte 2xx. */
export async function sendMail(env: Env, mail: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY mangler' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
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
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ukjent feil ved e-postutsending.' };
  }
}
