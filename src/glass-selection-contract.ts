/** Validate the customer selection before any lookup. Unknown answers stay unknown. */
export type GlassSelection = Record<string, string> & { kind: string };
const fields: Record<string, Record<string, string[]>> = {
  windshield: {}, unknown: {},
  door: { side: ['left','right','unknown'], door: ['front','rear','sliding','unknown'] },
  side: { side: ['left','right','unknown'], section: ['front_quarter','rear_quarter','cargo','unknown'], mounting: ['body','door','unknown'] },
  rear: { layout: ['single','split','unknown'], splitSide: ['left','right','unknown'] },
  ventil: { side: ['left','right','unknown'], placement: ['front','rear','unknown'] },
  roof: { system: ['fixed','opening','unknown'], panel: ['whole','front','middle','rear','unknown'] },
};
export function normalizeGlassSelection(input: unknown): GlassSelection | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !Object.hasOwn(fields, raw.kind)) return null;
  const spec = fields[raw.kind];
  const result: GlassSelection = { kind: raw.kind };
  for (const [field, allowed] of Object.entries(spec)) {
    if (field === 'splitSide' && raw.layout !== 'split') {
      if (raw[field] !== undefined) return null;
      continue;
    }
    if (typeof raw[field] !== 'string' || !allowed.includes(raw[field] as string)) return null;
    result[field] = raw[field] as string;
  }
  if (Object.keys(raw).some(key => key !== 'kind' && !Object.hasOwn(spec, key))) return null;
  return result;
}
