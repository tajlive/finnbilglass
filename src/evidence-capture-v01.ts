/**
 * Evidence Capture v0.1 is deliberately separate from fitment.  These
 * customer supplied images are support material only; no caller of this
 * module can produce an EXACT decision from them.
 */
export const EVIDENCE_IMAGE_TYPES = ['plate', 'windshield', 'mirror_sensor', 'interior_optional'] as const;
export type EvidenceImageType = typeof EVIDENCE_IMAGE_TYPES[number];

export const MAX_EVIDENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_EVIDENCE_IMAGE_SHORT_SIDE = 640;

export type EvidenceImageQualityClass = 'PASS' | 'REVIEW' | 'REJECT';

export interface EvidenceImageQuality {
  qualityClass: EvidenceImageQualityClass;
  reasonCodes: string[];
  width: number | null;
  height: number | null;
  byteLength: number;
  mime: string;
  analysisVersion: 'evidence-quality-v1';
}

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

export function analyseEvidenceImage(bytes: Uint8Array, mime: string): EvidenceImageQuality {
  const normalisedMime = mime.toLowerCase();
  const dimensions = imageDimensions(bytes, normalisedMime);
  const reasonCodes: string[] = [];

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(normalisedMime)) {
    reasonCodes.push('UNSUPPORTED_IMAGE_MIME');
  }
  if (!dimensions) {
    reasonCodes.push('UNKNOWN_IMAGE_DIMENSIONS');
  } else {
    const shortest = Math.min(dimensions.width, dimensions.height);
    const longest = Math.max(dimensions.width, dimensions.height);
    const aspect = longest / Math.max(shortest, 1);
    if (shortest < MIN_EVIDENCE_IMAGE_SHORT_SIDE) reasonCodes.push('REJECT_LOW_RESOLUTION');
    if (aspect >= 2.1) reasonCodes.push('REVIEW_EXTREME_ASPECT_RATIO');
    if (normalisedMime === 'image/png' && isCommonScreenshotSize(dimensions.width, dimensions.height)) {
      reasonCodes.push('REVIEW_POSSIBLE_SCREENSHOT');
    }
  }
  if (bytes.byteLength < 12_000) reasonCodes.push('REVIEW_VERY_SMALL_FILE');

  const qualityClass: EvidenceImageQualityClass = reasonCodes.some((code) => code.startsWith('REJECT_') || code === 'UNSUPPORTED_IMAGE_MIME' || code === 'UNKNOWN_IMAGE_DIMENSIONS')
    ? 'REJECT'
    : reasonCodes.length
      ? 'REVIEW'
      : 'PASS';

  return {
    qualityClass,
    reasonCodes,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    byteLength: bytes.byteLength,
    mime: normalisedMime,
    analysisVersion: 'evidence-quality-v1',
  };
}

function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png') return pngDimensions(bytes);
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/webp') return webpDimensions(bytes);
  return null;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > bytes.byteLength) return null;
    const length = readUint16(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { width: readUint16(bytes, offset + 5), height: readUint16(bytes, offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.byteLength >= 30) {
    return {
      width: 1 + readUint24Le(bytes, 24),
      height: 1 + readUint24Le(bytes, 27),
    };
  }
  if (chunk === 'VP8L' && bytes.byteLength >= 25) {
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8 ' && bytes.byteLength >= 30) {
    return { width: readUint16Le(bytes, 26) & 0x3fff, height: readUint16Le(bytes, 28) & 0x3fff };
  }
  return null;
}

function isCommonScreenshotSize(width: number, height: number): boolean {
  const pairs = [
    [1170, 2532], [1290, 2796], [1125, 2436], [1080, 1920],
    [1080, 2340], [1440, 2960], [1920, 1080], [1366, 768],
    [1440, 900], [1536, 864], [2560, 1440],
  ];
  return pairs.some(([w, h]) => (width === w && height === h) || (width === h && height === w));
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
