/**
 * accessory-v1/order-config — ordrekonfigurasjon + checkout-guard.
 * Kun EXACT eller eksplisitt MANUAL_VERIFICATION kan produsere ordrekonfigurasjon.
 * Checkout FEILER hvis nødvendig fitment-komponent er uavklart eller fitment er AMBIGUOUS/UNKNOWN.
 */
import type { AccessoryApplicability } from './schema.js';

export interface OrderConfiguration {
  selectedGlass: string;
  requiredAccessories: AccessoryApplicability[];
  includedAccessories: AccessoryApplicability[];
  optionalCompatibleAccessories: AccessoryApplicability[];
  unresolvedInstallationItems: AccessoryApplicability[];
  checkoutAllowed: boolean;
  checkoutBlockedReason: string | null;
}

export function buildOrderConfiguration(input: {
  fitmentStatus: 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN' | null;
  verificationMode: string | null;
  selectedGlass: string | null;
  accessories: AccessoryApplicability[];
  humanOverride?: boolean;
}): { ok: boolean; config?: OrderConfiguration; error?: string } {
  const { fitmentStatus, verificationMode, selectedGlass, accessories, humanOverride } = input;

  if (!selectedGlass) return { ok: false, error: 'ingen valgt glass' };

  const exactOrManual = (fitmentStatus === 'EXACT' && ['AUTHORITATIVE_DATA', 'CUSTOMER_OBSERVATION', 'MANUAL_VERIFICATION'].includes(verificationMode ?? '')) || (fitmentStatus === 'EXACT' && verificationMode === 'MANUAL_VERIFICATION');
  const manualApproved = fitmentStatus === 'AMBIGUOUS' && verificationMode === 'MANUAL_VERIFICATION' && humanOverride === true;

  const required = accessories.filter((a) => a.state === 'REQUIRED_SEPARATE');
  const included = accessories.filter((a) => a.state === 'INCLUDED_WITH_GLASS');
  const optional = accessories.filter((a) => a.state === 'OPTIONAL_COMPATIBLE');
  const unresolved = accessories.filter((a) => a.state === 'UNKNOWN' || a.state === 'AMBIGUOUS');
  // EXCLUDED_FROM_FINNBILGLASS_FOR_NOW (viskere) kommer ALDRI inn i ordrekonfigurasjonen
  const excluded = accessories.filter((a) => a.state === 'EXCLUDED_FROM_FINNBILGLASS_FOR_NOW');
  void excluded; // bevisst ignorert — salesPolicy=DISABLED

  let checkoutAllowed = false;
  let blockedReason: string | null = null;
  if (!exactOrManual && !manualApproved) {
    blockedReason = fitmentStatus === 'EXACT' ? `verifiseringsmodus ${verificationMode} gir ikke ordre` : `fitment er ${fitmentStatus ?? 'ukjent'} — checkout krever EXACT eller manuell godkjenning`;
  } else if (required.length === 0 && unresolved.some((u) => u.accessory.kind === 'FITMENT_ACCESSORY' && u.state === 'UNKNOWN')) {
    blockedReason = 'nødvendig fitment-komponent er uavklart (UNKNOWN)';
  } else {
    checkoutAllowed = true;
  }

  return {
    ok: checkoutAllowed,
    config: { selectedGlass, requiredAccessories: required, includedAccessories: included, optionalCompatibleAccessories: optional, unresolvedInstallationItems: unresolved, checkoutAllowed, checkoutBlockedReason: blockedReason },
  };
}
