/** Validation for manually entered offers. No database writes or provider calls. */
export type OfferValidation =
  | { ok: true; sku: string; evidence: string; total: number; delivery: string; equipment: string }
  | { ok: false; field: 'sku' | 'fitmentEvidenceRef' | 'totalMinor' | 'deliveryNote' | 'equipment'; message: string };

export function validateManualOfferPayload(payload: Record<string, unknown>): OfferValidation {
  const sku = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  const evidence = typeof payload.fitmentEvidenceRef === 'string' ? payload.fitmentEvidenceRef.trim() : '';
  const total = Number(payload.totalMinor);
  const delivery = typeof payload.deliveryNote === 'string' ? payload.deliveryNote.trim() : '';
  const equipment = payload.equipment && typeof payload.equipment === 'object' && !Array.isArray(payload.equipment)
    ? JSON.stringify(payload.equipment)
    : '{}';

  if (!sku || sku.length > 120)
    return { ok: false, field: 'sku', message: 'Fyll inn kontrollert SKU (1–120 tegn).' };
  if (evidence.length < 8 || evidence.length > 200)
    return { ok: false, field: 'fitmentEvidenceRef', message: 'Fyll inn fitment-bevisreferanse (8–200 tegn).' };
  if (!Number.isSafeInteger(total) || total <= 0)
    return { ok: false, field: 'totalMinor', message: 'Totalpris må være et positivt heltall i øre (for eksempel 100).' };
  if (!delivery || delivery.length > 500)
    return { ok: false, field: 'deliveryNote', message: 'Fyll inn frakt og levering (1–500 tegn).' };
  if (equipment.length > 5000)
    return { ok: false, field: 'equipment', message: 'Utstyrsdata er for lange.' };

  return { ok: true, sku, evidence, total, delivery, equipment };
}
