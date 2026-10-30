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

/** Release A exposes no product candidates or internal catalogue identifiers. */
export function publicResolverDto(value: unknown): RecordValue | null {
  if (!isRecord(value)) return null;
  return { utfall: 'MANUAL_REVIEW' };
}

/** Product selection is reserved for a later server-bound search contract. */
export function publicFrontruteDto(value: unknown): RecordValue {
  if (!isRecord(value)) return { ok: false };
  return {
    ok: value.ok === true,
    pinpoint: false,
    anbefaling: null,
    kandidater: [],
    sporsmaal: [],
    message: 'Vi kontrollerer riktig glass, pris og levering før tilbud.',
    meta: { resolver: false },
  };
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
