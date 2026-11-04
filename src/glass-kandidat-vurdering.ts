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
export function feltVerdier(c: CatalogueCandidate, felt: string): FeltVurdering {
  const p = c.posisjon;
  const konflikt = !!p.konflikt;

  if (felt === 'door') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (p.dorLedd === 'fremre') return { verdier: ['front'], konflikt: false };
    if (p.dorLedd === 'bakre') return { verdier: ['rear'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'placement') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (p.ventilLedd === 'foran') return { verdier: ['front'], konflikt: false };
    if (p.ventilLedd === 'bakre') return { verdier: ['rear'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'side') {
    if (konflikt) return { verdier: null, konflikt: true };
    if (p.side === 'venstre') return { verdier: ['left'], konflikt: false };
    if (p.side === 'hoyre') return { verdier: ['right'], konflikt: false };
    // «Begge sider» er en dokumentert mengde — ikke ukjent.
    if (p.side === 'begge') return { verdier: ['left', 'right'], konflikt: false };
    return { verdier: null, konflikt: false };
  }

  if (felt === 'body') {
    if (konflikt) return { verdier: null, konflikt: true };
    const kropper = [...kropperIRad(c.varenavn)];
    return { verdier: kropper.length ? kropper : null, konflikt: false };
  }

  // layout/section/mounting/system/panel finnes ikke i katalogdataene i dag.
  return { verdier: null, konflikt };
}
