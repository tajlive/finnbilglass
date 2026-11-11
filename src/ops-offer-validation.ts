/** Validation for manually entered offers. No database writes or provider calls.
 * Product details are stored as an immutable snapshot in the existing
 * equipment_json field, so the staging D1 schema does not need a new migration.
 */
export type OfferValidation =
  | { ok: true; sku: string; evidence: string; total: number; delivery: string; equipment: string }
  | { ok: false; field: 'sku' | 'productName' | 'productDescription' | 'fitmentEvidenceRef' | 'totalMinor' | 'deliveryNote' | 'equipment'; message: string };

// Internal representation only. Never render this as an actual supplier part number.
export const NO_PART_NUMBER = 'UTEN-VARENUMMER';

export function validateManualOfferPayload(payload: Record<string, unknown>): OfferValidation {
  const partNumber = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  const productName = typeof payload.productName === 'string' ? payload.productName.trim() : '';
  const productDescription = typeof payload.productDescription === 'string' ? payload.productDescription.trim() : '';
  const evidence = typeof payload.fitmentEvidenceRef === 'string' ? payload.fitmentEvidenceRef.trim() : '';
  const total = Number(payload.totalMinor);
  const delivery = typeof payload.deliveryNote === 'string' ? payload.deliveryNote.trim() : '';
  const equipmentData: Record<string, unknown> = payload.equipment && typeof payload.equipment === 'object' &&
    !Array.isArray(payload.equipment) ? { ...payload.equipment as Record<string, unknown> } : {};

  if ((!partNumber && !productName) || partNumber.length > 120)
    return { ok: false, field: 'sku', message: 'Oppgi varenummer (SKU) eller varenavn (maks 120 tegn for varenummer).' };
  if (productName.length > 160)
    return { ok: false, field: 'productName', message: 'Varenavn kan være maks 160 tegn.' };
  if (productDescription.length > 500)
    return { ok: false, field: 'productDescription', message: 'Beskrivelse kan være maks 500 tegn.' };
  if (evidence.length < 8 || evidence.length > 200)
    return { ok: false, field: 'fitmentEvidenceRef', message: 'Fyll inn grunnlag for glassvalg (8–200 tegn).' };
  if (!Number.isSafeInteger(total) || total <= 0)
    return { ok: false, field: 'totalMinor', message: 'Totalpris må være et positivt heltall i øre.' };
  if (!delivery || delivery.length > 500)
    return { ok: false, field: 'deliveryNote', message: 'Fyll inn frakt og levering (1–500 tegn).' };

  // The existing SKU column is required. Use an explicit non-catalog marker
  // for name-only offers and preserve actual customer-facing fields separately.
  const sku = partNumber || NO_PART_NUMBER;
  if (productName || productDescription || !partNumber) {
    equipmentData.offerProduct = {
      partNumber: partNumber || null,
      name: productName || null,
      description: productDescription || null,
      source: 'MANUAL',
    };
  }
  const equipment = JSON.stringify(equipmentData);
  if (equipment.length > 5000)
    return { ok: false, field: 'equipment', message: 'Utstyrs- og varedata er for lange.' };

  return { ok: true, sku, evidence, total, delivery, equipment };
}
