/** Manual support workflow for Evidence Capture. Never influences fitment. */
export const SUPPORT_CASE_STATUSES = ['NEW', 'UNDER_REVIEW', 'NEEDS_CUSTOMER_INFO', 'CONFIRMED', 'REJECTED'] as const;
export type SupportCaseStatus = typeof SUPPORT_CASE_STATUSES[number];

const ALLOWED: Record<SupportCaseStatus, readonly SupportCaseStatus[]> = {
  NEW: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['NEEDS_CUSTOMER_INFO', 'CONFIRMED', 'REJECTED'],
  NEEDS_CUSTOMER_INFO: ['UNDER_REVIEW', 'REJECTED'],
  CONFIRMED: [],
  REJECTED: [],
};

export function isSupportCaseStatus(value: unknown): value is SupportCaseStatus {
  return typeof value === 'string' && (SUPPORT_CASE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: SupportCaseStatus, to: SupportCaseStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function validReviewReason(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text.length > 600) return false;
  return text.split(/[.!?]+/).filter(Boolean).length <= 3;
}

export function legacyStatus(value: string): SupportCaseStatus {
  if (value === 'REVIEWING') return 'UNDER_REVIEW';
  if (value === 'NEEDS_MORE_DATA') return 'NEEDS_CUSTOMER_INFO';
  if (value === 'COMPLETE') return 'CONFIRMED';
  return 'NEW';
}
