/** Public vehicle lookup responses never disclose catalogue prices. */
export function withoutCustomerPrices(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCustomerPrices);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'pris' || key === 'listepris') continue;
    result[key] = withoutCustomerPrices(child);
  }
  return result;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pick(source: RecordValue, keys: readonly string[]): RecordValue {
  const out: RecordValue = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

const CANDIDATE_FIELDS = [
  // candidateId is an opaque customer-session reference. The actual supplier
  // number/eurocode stays server-side and is shown only in operator tooling.
  'candidateId', 'varenavn', 'attributter', 'egenskaper', 'posisjon',
  'fargetone', 'aarIntervall', 'score', 'kundeprisInklMva',
] as const;

function publicCandidate(value: unknown): RecordValue | null {
  if (!isRecord(value)) return null;
  const out = pick(value, CANDIDATE_FIELDS);
  if (typeof value.varenr === 'string' && typeof out.candidateId !== 'string') out.candidateId = value.varenr;
  if (typeof value.pris === 'number' && Number.isFinite(value.pris) && out.kundeprisInklMva === undefined) {
    out.kundeprisInklMva = value.pris;
  }
  return out;
}

/** Explicit public shape for the vehicle resolver. Never spread internal resolver state. */
export function publicResolverDto(value: unknown): RecordValue | null {
  if (!isRecord(value)) return null;
  const out = pick(value, ['utfall', 'varenavn', 'pinpoint']);
  if (typeof value.varenr === 'string') out.candidateId = value.varenr;
  if (typeof value.pris === 'number' && Number.isFinite(value.pris)) out.kundeprisInklMva = value.pris;
  if (Array.isArray(value.kandidater)) out.kandidater = value.kandidater.map(publicCandidate).filter(Boolean);
  if (Array.isArray(value.sporsmaal)) out.sporsmaal = value.sporsmaal.filter((x): x is string => typeof x === 'string');
  if (isRecord(value.meta)) out.meta = pick(value.meta, ['resolver']);
  return out;
}

/** Explicit public shape for the frontrute endpoint; catalog internals stay server-side. */
export function publicFrontruteDto(value: unknown): RecordValue {
  if (!isRecord(value)) return { ok: false };
  const out = pick(value, ['ok', 'pinpoint']);
  const recommendation = publicCandidate(value.anbefaling);
  out.anbefaling = recommendation;
  out.kandidater = Array.isArray(value.kandidater)
    ? value.kandidater.map(publicCandidate).filter(Boolean)
    : [];
  if (Array.isArray(value.sporsmaal)) out.sporsmaal = value.sporsmaal.filter((x): x is string => typeof x === 'string');
  if (typeof value.message === 'string') out.message = value.message;
  const resolver = isRecord(value.meta) && value.meta.resolver === true;
  out.meta = { resolver };
  return out;
}

/** Public vehicle object used by registration, VIN, and plate-image lookup routes. */
export function publicVehicleLookupDto(value: unknown): RecordValue {
  if (!isRecord(value)) return { ok: false, bil: null, resolver: null };
  const vehicle = isRecord(value.bil)
    ? pick(value.bil, ['merke', 'modell', 'aar', 'vin', 'forstegangsregistrert', 'import', 'importLand'])
    : null;
  return {
    ...pick(value, ['ok', 'lagret', 'regnr', 'lest', 'funnet']),
    bil: vehicle,
    resolver: publicResolverDto(value.resolver),
  };
}
