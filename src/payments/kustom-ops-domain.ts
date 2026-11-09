import { SHIPPING_INCL_VAT_MINOR, nokToMinor } from './kustom-core';

export type KustomQuote = {
  id: number; inquiry_id: number; versjon: number;
  pris_kr: number; total_kr: number | null; pris_type: string;
  sendt_at: number | null; gyldig_til: string | null;
  kontakt: string; navn: string; regnr: string | null;
  inquiry_status: string;
};

export type KustomAcceptance = {
  amountMinor: number; glassMinor: number;
  method: 'PHONE' | 'EMAIL' | 'IN_PERSON'; note: string;
};

/** Shipping is a fixed VAT-inclusive component of the already agreed total; never added on top. */
export function validateKustomAcceptedQuote(quote: KustomQuote, body: Record<string, unknown>, now = Date.now()): KustomAcceptance {
  if (quote.pris_type !== 'BEKREFTET' || !quote.sendt_at || quote.inquiry_status !== 'OFFERED') {
    throw new Error('KUSTOM_TILBUD_IKKE_BEKREFTET_OG_SENDT');
  }
  if (quote.gyldig_til) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.gyldig_til) || !Number.isFinite(Date.parse(`${quote.gyldig_til}T23:59:59.999Z`)) ||
        now > Date.parse(`${quote.gyldig_til}T23:59:59.999Z`)) throw new Error('KUSTOM_TILBUD_UTLOPT');
  }
  if (body.accepted !== true) throw new Error('KUSTOM_KUNDEAKSEPT_KREVES');
  const method = String(body.acceptanceMethod || '').toUpperCase();
  if (!['PHONE', 'EMAIL', 'IN_PERSON'].includes(method)) throw new Error('KUSTOM_AKSEPTMETODE_UGYLDIG');
  const note = typeof body.acceptanceNote === 'string' ? body.acceptanceNote.trim().slice(0, 300) : '';
  if (note.length < 3) throw new Error('KUSTOM_AKSEPTNOTAT_KREVES');
  if (quote.total_kr == null) throw new Error('KUSTOM_TOTAL_MANGLER');
  const amountMinor = nokToMinor(quote.total_kr);
  const glassMinor = nokToMinor(quote.pris_kr);
  if (amountMinor - glassMinor !== SHIPPING_INCL_VAT_MINOR) {
    throw new Error('KUSTOM_TILBUD_FRAKT_AVVIK');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(quote.kontakt.trim())) throw new Error('KUSTOM_EPOST_UGYLDIG');
  return { amountMinor, glassMinor, method: method as KustomAcceptance['method'], note };
}

export function safeKustomLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      (parsed.hostname === 'pay.kustom.co' || parsed.hostname.endsWith('.kustom.co') ||
       parsed.hostname === 'pay.klarna.com' || parsed.hostname.endsWith('.klarna.com'));
  } catch { return false; }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeHexMatch(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
