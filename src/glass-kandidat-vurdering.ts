/**
 * glass-kandidat-vurdering — felles vurdering av «støtter/motstrider/ukjent/konflikt».
 *
 * En kandidats plassering har tre kvalitativt forskjellige tilstander som tidligere
 * ble klemt sammen i én `null`:
 *
 *   1. UKJENT      — katalogen sier ingenting (f.eks. ingen side). Kan aldri bekrefte
 *                    en gren og filtrerer aldri.
 *   2. DOKUMENTERT — én eller flere konkrete verdier (venstre, eller «begge sider»,
 *                    eller «SED+STV» = sedan og stasjonsvogn). En mengde, ikke null.
 *   3. KONFLIKT    — navn og eurokode er uenige. Feltet kan ikke brukes som bevis.
 *
 * Kontrakten `vurderFelt` er den ene avgjørelsen valgtre, resultat og
 * servervalidering skal dele, slik at de aldri kan vurdere «ukjent» ulikt.
 */
import type { CatalogueCandidate } from './fitment-v1/catalogue-candidates.js';
import { kropperIRad } from './fitment-v1/catalogue-candidates.js';

export type Vurdering = 'stotte' | 'ukjent' | 'motstrid' | 'konflikt';

export interface FeltVurdering {
  /** Konkrete dokumenterte verdier. `null` = katalogen sier ingenting (ukjent).
   *  En tom mengde betyr også ukjent — begge betyr «bekrefter aldri, filtrerer aldri». */
  verdier: readonly string[] | null;
  /** Eksplisitt kildekonflikt (navn vs eurokode). Feltet kan ikke brukes som bevis. */
  konflikt: boolean;
}

/**
 * Den ene avgjørelsen for om en kandidat støtter en gitt verdi.
 *
 * - konflikt  → `konflikt`  (uansett verdi — kan aldri bli PINPOINT)
 * - ukjent    → `ukjent`    (bekrefter aldri, filtrerer aldri)
 * - ellers    → medlemskap avgjør `stotte`/`motstrid`
 */
export function vurderFelt(
  kjenteVerdier: readonly string[] | null,
  valgtVerdi: string | null | undefined,
  konflikt: boolean,
): Vurdering {
  if (konflikt) return 'konflikt';
  if (!kjenteVerdier || kjenteVerdier.length === 0) return 'ukjent';
  if (valgtVerdi == null || valgtVerdi === 'unknown') return 'ukjent';
  return kjenteVerdier.includes(valgtVerdi) ? 'stotte' : 'motstrid';
}

/**
 * Feltets konkrete verdimengde for én kandidat.
 *
 * Forskjellen fra den gamle `feltVerdi`:
 *   - `side === 'begge'` → `['left', 'right']` (dokumentert begge sider, IKKE ukjent)
 *   - flere karosserier («SED+STV») → `['sedan', 'estate']` (dokumentert mengde)
 *   - manglende/ukjent → `null`
 *   - kildekonflikt → `verdier: null, konflikt: true` (feltet er ubeviselig)
 */
/**
 * Feltets konkrete verdimengde for én posisjon.
 *
 * Skilt ut slik at servervalideringen kan bruke NØYAKTIG samme vurdering som
 * valgtreet, uten å bygge en full kandidat.
 */
export function posisjonFeltVerdier(
  posisjon: { type?: string; side?: string | null; dorLedd?: string | null; ventilLedd?: string | null; konflikt?: boolean },
  felt: string,
  varenavn = '',
): FeltVurdering {
  const konflikt = !!posisjon.konflikt;

  if (felt === 'door') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (posisjon.dorLedd === 'fremre') return { verdier: ['front'], konflikt: false };
    if (posisjon.dorLedd === 'bakre') return { verdier: ['rear'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'placement') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (posisjon.ventilLedd === 'foran') return { verdier: ['front'], konflikt: false };
    if (posisjon.ventilLedd === 'bakre') return { verdier: ['rear'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'side') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (posisjon.side === 'venstre') return { verdier: ['left'], konflikt: false };
    if (posisjon.side === 'hoyre') return { verdier: ['right'], konflikt: false };
    // «Begge sider» er en dokumentert mengde — ikke ukjent.
    if (posisjon.side === 'begge') return { verdier: ['left', 'right'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'body') {
    if (konflikt) return { verdier: null, konflikt: true };
    const kropper = [...kropperIRad(varenavn)];
    return { verdier: kropper.length ? kropper : null, konflikt: false };
  }

  // layout/section/mounting/system/panel finnes ikke i katalogdataene i dag.
  return { verdier: null, konflikt };
}

/** Feltets konkrete verdimengde for én kandidat. */
export function feltVerdier(c: CatalogueCandidate, felt: string): FeltVurdering {
  return posisjonFeltVerdier(c.posisjon, felt, c.varenavn);
}
