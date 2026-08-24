/** Manual inquiry (tilbud/bekreftelse) workflow for beta-henvendelser.
 *  Modellert på support-evidence-workflow.ts, men er en SALGS-/KONTAKTFLYT
 *  (tilbudt → bekreftet/avsluttet), ikke en kvalitetssjekk. Hold dem adskilt.
 *  Influencer aldri fitment.
 */
export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'NEEDS_INFO', 'OFFERED', 'CONFIRMED', 'CLOSED', 'REJECTED'] as const;
export type InquiryStatus = typeof INQUIRY_STATUSES[number];

const ALLOWED: Record<InquiryStatus, readonly InquiryStatus[]> = {
  NEW: ['CONTACTED', 'REJECTED'],
  CONTACTED: ['NEEDS_INFO', 'OFFERED', 'REJECTED'],
  NEEDS_INFO: ['CONTACTED', 'REJECTED'],
  OFFERED: ['CONFIRMED', 'CLOSED'],
  CONFIRMED: [],
  CLOSED: [],
  REJECTED: [],
};

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === 'string' && (INQUIRY_STATUSES as readonly string[]).includes(value);
}

export function canTransitionInquiry(from: InquiryStatus, to: InquiryStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function validInquiryReason(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text.length > 600) return false;
  return text.split(/[.!?]+/).filter(Boolean).length <= 3;
}

/** Status-etikett for visning i /ops — norske, korte merkelapper. */
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  NEW: 'Ny',
  CONTACTED: 'Kontaktet',
  NEEDS_INFO: 'Trenger info',
  OFFERED: 'Tilbudt',
  CONFIRMED: 'Bekreftet',
  CLOSED: 'Lukket',
  REJECTED: 'Avvist',
};
