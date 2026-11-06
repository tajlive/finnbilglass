import type { Env } from './types';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Velger riktig D1 for beta_inquiries/beta_inquiry-events.
 *  Staging: MÅ bruke FINNBILGLASS_STAGING_AUTH (fail-closed hvis mangler).
 *  Produksjon/Lokal: bruker FINNBILGLASS_DB. */
export function inquiryDb(env: Env): D1Database {
  if (env.ENVIRONMENT === 'staging') {
    if (!env.FINNBILGLASS_STAGING_AUTH) {
      throw new Error('STAGING_MISSING_D1_BINDING: FINNBILGLASS_STAGING_AUTH er ikke konfigurert');
    }
    return env.FINNBILGLASS_STAGING_AUTH;
  }
  return env.FINNBILGLASS_DB;
}
