/** Negative compatibility gate, shared by resolver, fallback and submission.
 * Explicit product labels are restrictions, not proof that a vehicle has that body.
 * In particular, an unqualified GLE is NOT inferred to be an SUV.
 */
export function glassBodyRejection(
  bil: { merke: string; modell?: string }, produktnavn: string | null | undefined,
): string | null {
  const vehicle = (bil.modell ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const product = (produktnavn ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const coupe = /\b(?:COUPE|CPE)\b/;
  const suv = /\bSUV\b/;
  if ((coupe.test(vehicle) && suv.test(product) && !coupe.test(product)) ||
      (suv.test(vehicle) && !coupe.test(vehicle) && coupe.test(product))) {
    return 'Valgt glass har en dokumentert karosserivariant som ikke samsvarer med bilen.';
  }
  if (/MERCEDES/i.test(bil.merke) && /\bGLE\b/.test(vehicle) &&
      /\bGLS\b/.test(product) && !/\bGLE\b/.test(product)) {
    return 'Dette glasset er oppgitt for GLS, ikke GLE. Vi må kontrollere riktig glass.';
  }
  // GLE SUV and GLE Coupé have separate applications. Absence of COUPE in SVV
  // is insufficient to infer SUV; require clarification before exposing Coupé-only glass.
  if (/MERCEDES/i.test(bil.merke) && /\bGLE\b/.test(vehicle) && /\bGLE\b/.test(product) &&
      coupe.test(product) && !coupe.test(vehicle)) {
    return 'Dette glasset er oppgitt for GLE Coupé. Bilens karosserivariant må avklares før glass kan velges.';
  }
  return null;
}
