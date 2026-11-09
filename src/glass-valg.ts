/**
 * glass-valg — datastyrte valg for kundereisen.
 *
 * Kunden skal bare få rutetype- og plasseringsvalg som faktisk har katalogstøtte
 * for den identifiserte bilen. Denne modulen bygger derfor et valgtre fra
 * kandidatene — ikke fra en fast liste i frontend.
 *
 * Tre prinsipper:
 *
 *   1. Valget bygges fra HELE kandidatsettet, før noen resultatbegrensning.
 *      En liste som bare viser tre produkter er ikke grunnlag for å si hvilke
 *      plasseringer bilen har.
 *   2. Et spørsmål stilles bare når minst to kandidater har ulik KJENT verdi for
 *      feltet. Ellers hoppes steget over, og verdien følger med som «automatisk»
 *      slik at oppsummeringen fortsatt er korrekt.
 *   3. Kombinasjoner som ingen kandidat støtter, finnes ikke i treet. Kunden kan
 *      derfor ikke velge «bakre dørrute, venstre side» på en bil der bare fremre
 *      dørruter er dokumentert.
 *
 * Katalogen bekrefter aldri fysisk kompatibilitet. Treet sier hva som er
 * dokumentert tilgjengelig — ikke hva som er riktig glass på bilen.
 */
import type { CatalogueCandidate } from './fitment-v1/catalogue-candidates.js';
import { feltVerdier } from './glass-kandidat-vurdering.js';

export type ValgFelt =
  | 'door' | 'side' | 'placement' | 'layout' | 'section' | 'mounting' | 'system' | 'panel' | 'body';

export type ValgKind = 'windshield' | 'door' | 'side' | 'rear' | 'ventil' | 'roof';

export type Dekning = 'GOD' | 'TYNN' | 'INGEN';

export type Kjorestyring = 'LHD' | 'RHD' | 'UKJENT';

export interface ValgNode {
  felt: ValgFelt;
  /** Verdien slik den sendes i `selection` (left/right/front/rear/sedan …). */
  verdi: string;
  tittel: string;
  /** Antall kandidater i dette deltreet. */
  antall: number;
  /** Felt der alle kandidatene i deltreet er enige — tas med uten spørsmål. */
  automatisk: Record<string, string>;
  barn: ValgNode[];
}

export interface TypeValg {
  kind: ValgKind;
  tittel: string;
  antall: number;
  automatisk: Record<string, string>;
  barn: ValgNode[];
}

export interface ValgTre {
  dekning: Dekning;
  rattplassering: Kjorestyring;
  /** Kundetekst som forklarer hvordan sidene skal leses. */
  sidehjelp: string;
  typer: TypeValg[];
  antallKandidater: number;
  /** Kandidater hvis plassering ikke kan fastslås — telles, tilbys ikke. */
  ukjentPlassering: number;
  melding: string;
}

const TITTEL: Record<ValgKind, string> = {
  windshield: 'Frontrute',
  door: 'Dørrute',
  side: 'Siderute',
  rear: 'Bakrute',
  ventil: 'Ventilrute',
  roof: 'Takglass',
};

/** Rekkefølgen feltene spørres i. Bare felt som skiller kandidatene blir steg. */
const FELTREKKE: Record<ValgKind, ValgFelt[]> = {
  windshield: [],
  door: ['door', 'side', 'body'],
  side: ['side', 'body'],
  rear: ['body'],
  ventil: ['placement', 'side', 'body'],
  roof: [],
};

/** Kundespørsmålet for hvert felt. */
export const FELT_SPORSMAL: Record<ValgFelt, string> = {
  door: 'Hvilken dørrute gjelder det?',
  side: 'Hvilken side av bilen?',
  placement: 'Hvor sitter ventilruten?',
  layout: 'Er bakruten hel eller delt?',
  section: 'Hvor sitter sideruten?',
  mounting: 'Hvor er ruten festet?',
  system: 'Er takglasset fast eller åpningsbart?',
  panel: 'Hvilket panel gjelder det?',
  body: 'Hvilken karosseritype er bilen?',
};

/** De rutetypene som alltid kan etterspørres, uavhengig av katalogdata. */
export const GRUNNTYPER: { kind: ValgKind; tittel: string }[] = [
  { kind: 'windshield', tittel: TITTEL.windshield },
  { kind: 'door', tittel: TITTEL.door },
  { kind: 'side', tittel: TITTEL.side },
  { kind: 'rear', tittel: TITTEL.rear },
  { kind: 'ventil', tittel: TITTEL.ventil },
  { kind: 'roof', tittel: TITTEL.roof },
];

const KROPP_TITTEL: Record<string, string> = {
  sedan: 'Sedan',
  estate: 'Stasjonsvogn',
  hatchback: '5-dørs / hatchback',
  coupe: 'Coupé',
  cabriolet: 'Cabriolet',
  van: 'Varebil / minibuss',
  suv: 'SUV / crossover',
};

const KIND_AV_TYPE: Record<string, ValgKind | null> = {
  frontrute: 'windshield',
  dor: 'door',
  side: 'side',
  sidefamilie: 'side',
  bakrute: 'rear',
  ventil: 'ventil',
  tak: 'roof',
  ukjent: null,
};

function sideTittel(verdi: string, styring: Kjorestyring): string {
  if (verdi !== 'left' && verdi !== 'right') return verdi;
  if (styring === 'LHD' || styring === 'RHD') {
    const forerSide = styring === 'LHD' ? 'left' : 'right';
    return verdi === forerSide ? 'Førerside' : 'Passasjerside';
  }
  // Rattplassering er ikke dokumentert for bilen: da kan vi ikke si fører/passasjer.
  return verdi === 'left' ? 'Venstre side' : 'Høyre side';
}

function nodeTittel(felt: ValgFelt, verdi: string, styring: Kjorestyring): string {
  if (felt === 'side') return sideTittel(verdi, styring);
  if (felt === 'door') return verdi === 'front' ? 'Fremre dørrute' : 'Bakre dørrute';
  if (felt === 'placement') return verdi === 'front' ? 'Foran' : 'Bak';
  if (felt === 'body') return KROPP_TITTEL[verdi] || verdi;
  return verdi;
}

/**
 * Felt der alle kandidatene i settet er enige om ÉN dokumentert verdi.
 * En kandidat uten kjent verdi (eller «begge sider»/flere karosserier) gjør
 * feltet uavklart — da autofylles det aldri, for en kjent verdi pluss ukjente
 * er ikke enighet.
 */
function enigeFelt(kandidater: CatalogueCandidate[], feltrekke: ValgFelt[]): Record<string, string> {
  const ut: Record<string, string> = {};
  for (const felt of feltrekke) {
    let fane: string | null = null;
    let enig = true;
    for (const c of kandidater) {
      const { verdier } = feltVerdier(c, felt);
      if (!verdier || verdier.length !== 1) { enig = false; break; }
      if (fane === null) fane = verdier[0];
      else if (fane !== verdier[0]) { enig = false; break; }
    }
    if (enig && fane !== null) ut[felt] = fane;
  }
  return ut;
}

function byggNivaa(
  kandidater: CatalogueCandidate[],
  feltrekke: ValgFelt[],
  indeks: number,
  styring: Kjorestyring,
): ValgNode[] {
  if (indeks >= feltrekke.length) return [];
  const felt = feltrekke[indeks];
  const verdier: string[] = [];
  for (const c of kandidater) {
    const { verdier: vs } = feltVerdier(c, felt);
    if (vs) for (const v of vs) if (!verdier.includes(v)) verdier.push(v);
  }
  // Ett eller ingen kjente svar: steget kan hoppes over. Verdien følger med
  // som «automatisk» på nivået over, slik at oppsummeringen blir riktig.
  if (verdier.length < 2) return byggNivaa(kandidater, feltrekke, indeks + 1, styring);

  const sortert = verdier.sort((a, b) => {
    const orden = ['front', 'rear', 'left', 'right'];
    return orden.indexOf(a) - orden.indexOf(b);
  });

  return sortert.map((verdi) => {
    // En kandidat uten kjent verdi støtter alle svar; en med «begge sider» eller
    // flere karosserier støtter hver av sine dokumenterte verdier. Begge blir med
    // i hver gren de dokumentert støtter — ikke i grener de motstrider.
    const delmengde = kandidater.filter((c) => {
      const { verdier: vs } = feltVerdier(c, felt);
      return vs == null || vs.length === 0 || vs.includes(verdi);
    });
    return {
      felt,
      verdi,
      tittel: nodeTittel(felt, verdi, styring),
      antall: delmengde.length,
      automatisk: enigeFelt(delmengde, feltrekke),
      barn: byggNivaa(delmengde, feltrekke, indeks + 1, styring),
    };
  });
}

export interface ValgTreInndata {
  kandidater: CatalogueCandidate[];
  /** Dokumentert rattplassering for bilen. Utelates → UKJENT (aldri antatt). */
  styring?: Kjorestyring | null;
  /**
   * Dokumentert karosseri fra biloppslaget (f.eks. «estate» fra SVV/vognkort).
   * Når det finnes, spørres det ALDRI om karosseri: en dokumentert stasjonsvogn
   * skal ikke måtte velge mellom sedan, cabriolet og coupé. Kandidater som
   * uttrykkelig dokumenterer et annet karosseri forkastes; ukjente beholdes.
   * Utelates feltet → karosseri er ukjent og spørres bare når svaret skiller.
   */
  dokumentertKropp?: string | null;
}

export function byggValgTre({ kandidater, styring, dokumentertKropp }: ValgTreInndata): ValgTre {
  const kjoring: Kjorestyring = styring === 'LHD' || styring === 'RHD' ? styring : 'UKJENT';
  // Bare kjente kundeverdier godtas; et ukjent ord skal ikke bli et autosvar.
  const kropp = dokumentertKropp && Object.hasOwn(KROPP_TITTEL, dokumentertKropp) ? dokumentertKropp : null;

  // Dokumentert karosseri fjerner kandidater som uttrykkelig er en annen karosseritype.
  // Tømmer filtreringen listen, beholdes alt (samme regel som resten av kjeden).
  let brukte = kandidater;
  if (kropp) {
    const passer = kandidater.filter((c) => {
      const { verdier } = feltVerdier(c, 'body');
      return !verdier || verdier.length === 0 || verdier.includes(kropp);
    });
    if (passer.length) brukte = passer;
  }

  const perKind = new Map<ValgKind, CatalogueCandidate[]>();
  let ukjentPlassering = 0;
  for (const c of brukte) {
    const kind = KIND_AV_TYPE[c.posisjon.type];
    if (!kind) { ukjentPlassering += 1; continue; }
    const liste = perKind.get(kind) ?? [];
    liste.push(c);
    perKind.set(kind, liste);
  }

  const typer: TypeValg[] = [];
  for (const kind of Object.keys(TITTEL) as ValgKind[]) {
    const liste = perKind.get(kind);
    if (!liste || !liste.length) continue;
    // Dokumentert karosseri er ikke et spørsmål — det er et faktum om bilen.
    const feltrekke = kropp ? FELTREKKE[kind].filter((f) => f !== 'body') : FELTREKKE[kind];
    typer.push({
      kind,
      tittel: TITTEL[kind],
      antall: liste.length,
      automatisk: { ...enigeFelt(liste, feltrekke), ...(kropp ? { body: kropp } : {}) },
      barn: byggNivaa(liste, feltrekke, 0, kjoring),
    });
  }

  // Frontruten søkes i resolveren (/api/frontrute), ikke i CLASS_D-katalogen.
  // Den skal derfor alltid være et valg — ellers blir den vanligste kunden
  // uten inngang på biler der katalogen bare har sideglass.
  if (!typer.some((t) => t.kind === 'windshield')) {
    typer.unshift({ kind: 'windshield', tittel: TITTEL.windshield, antall: 0, automatisk: {}, barn: [] });
  }

  const antall = brukte.length;
  const dekning: Dekning = antall === 0 ? 'INGEN' : antall < 4 ? 'TYNN' : 'GOD';

  let melding: string;
  if (dekning === 'INGEN' && ukjentPlassering > 0) {
    melding = 'Vi har funnet glass til bilen, men kan ikke fastslå hvilken plassering det gjelder. Send oss en forespørsel, så undersøker vi videre.';
  } else if (dekning === 'INGEN') {
    melding = 'Vi fant ingen mulige glassvarianter til denne bilen i katalogen. Det betyr ikke at ruten ikke finnes — send oss en forespørsel, så undersøker vi videre.';
  } else {
    melding = 'Velg ruten det gjelder. Valgene er de plasseringene katalogen har mulige varianter for. Vi kontrollerer alltid glass og passform manuelt før tilbud.';
  }

  return {
    dekning,
    rattplassering: kjoring,
    sidehjelp: kjoring === 'UKJENT'
      ? 'Venstre og høyre side er sett i bilens kjøreretning. Er du usikker, velger du «Vet ikke» — da kontrollerer vi det.'
      : 'Sidene er sett i bilens kjøreretning, og rattplasseringen er dokumentert for denne bilen.',
    typer,
    antallKandidater: antall,
    ukjentPlassering,
    melding,
  };
}

/**
 * Bygger et komplett `selection`-objekt for én rutetype. Felt katalogen ikke
 * skiller på settes til «unknown» — det filtrerer ingenting og er alltid lovlig
 * i `normalizeGlassSelection`.
 */
export function byggSelection(kind: ValgKind, svar: Record<string, string> = {}): Record<string, string> {
  const felt: Record<ValgKind, string[]> = {
    windshield: [],
    door: ['side', 'door', 'body'],
    side: ['side', 'section', 'mounting', 'body'],
    rear: ['layout', 'splitSide', 'body'],
    ventil: ['side', 'placement', 'body'],
    roof: ['system', 'panel'],
  };
  const selection: Record<string, string> = { kind };
  for (const f of felt[kind]) {
    // Kontrakten avviser splitSide når layout ikke er «split».
    if (f === 'splitSide' && svar.layout !== 'split') continue;
    selection[f] = svar[f] || 'unknown';
  }
  return selection;
}
