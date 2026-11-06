/**
 * E-postutsending — én vei.
 *
 * Brevo-kontoen er slettet (2026-11-04). All utgående post går via Resend, som
 * også er det som leverer kvitteringene uten `List-Unsubscribe`. Funksjonen er
 * bevisst tynn: kallstedene eier innholdet, denne eier transporten og feilene.
 */
import type { Env } from './types';
import {reserveCustomerMail,finishCustomerMail,type CaseMailContext} from './ops-workbench/mail-sync';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Kunden skal kunne svare til denne adressen. Utelates for interne varsler. */
  replyTo?: string;
  caseContext?: CaseMailContext;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

/** Avsenderadressen. Domenet er verifisert hos Resend. */
export function avsenderEpost(env: Env): string {
  return env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
}

/** Sender én e-post via Resend. Returnerer aldri «ok» uten at API-et svarte 2xx. */
export async function sendMail(env: Env, mail: Mail): Promise<{ ok: boolean; error?: string; providerId?: string; trackingWarning?:string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY mangler' };
  let acceptedProviderId:string|undefined;
  let tracked:Awaited<ReturnType<typeof reserveCustomerMail>>|undefined;
  try {
    if(mail.caseContext&&env.OPS_WORKBENCH_ENABLED==='true'){tracked=await reserveCustomerMail(env,mail,mail.caseContext);if(tracked.alreadySent)return {ok:true,providerId:tracked.providerId};}
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...((mail.idempotencyKey||tracked?.id) ? { 'Idempotency-Key': mail.idempotencyKey||tracked!.id } : {}),
      },
      body: JSON.stringify({
        from: `Finnbilglass <${avsenderEpost(env)}>`,
        to: [mail.to],
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        ...(mail.headers ? { headers: mail.headers } : {}),
        subject: tracked?.subject||mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Resend ${r.status}${txt ? ': ' + txt.slice(0, 160) : ''}`);
    }
    const result = await r.json().catch(() => ({})) as { id?: string };
    acceptedProviderId=typeof result.id==='string'?result.id:undefined;
    if(tracked&&!result.id)throw Error('Leverandøren ga ingen meldings-ID. Sendestatus må avklares.');
    if(tracked&&mail.caseContext)await finishCustomerMail(env,tracked.id,mail.caseContext,{ok:true,providerId:result.id});
    return { ok: true, ...(typeof result.id === 'string' ? { providerId: result.id } : {}) };
  } catch (e) {
    if(acceptedProviderId)return {ok:true,providerId:acceptedProviderId,trackingWarning:'E-posten er akseptert av e-postleverandøren, men arkivering må avklares. Ikke send på nytt.'};
    if(tracked&&!tracked.alreadySent&&mail.caseContext)await finishCustomerMail(env,tracked.id,mail.caseContext,{ok:false,error:e instanceof Error?e.message:'Uavklart sendestatus.'}).catch(()=>{});
    return { ok: false, error: e instanceof Error ? e.message : 'Ukjent feil ved e-postutsending.' };
  }
}
