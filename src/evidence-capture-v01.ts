/**
 * Evidence Capture v0.1 is deliberately separate from fitment.  These
 * customer supplied images are support material only; no caller of this
 * module can produce an EXACT decision from them.
 */
export const EVIDENCE_IMAGE_TYPES = ['plate', 'windshield', 'mirror_sensor', 'interior_optional'] as const;
export type EvidenceImageType = typeof EVIDENCE_IMAGE_TYPES[number];

export const MAX_EVIDENCE_IMAGE_BYTES = 5 * 1024 * 1024;

export function isEvidenceImageType(value: unknown): value is EvidenceImageType {
  return typeof value === 'string' && (EVIDENCE_IMAGE_TYPES as readonly string[]).includes(value);
}

export function normaliseRegistration(value: string): string {
  return value.toUpperCase().replace(/[\s\-–—.]+/g, '');
}

export async function registrationHash(registration: string): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseRegistration(registration));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCaseId(now = new Date(), random = crypto.getRandomValues(new Uint32Array(1))[0]): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `FBG-${day}-${random.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}
