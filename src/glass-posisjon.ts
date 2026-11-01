/**
 * Glassposisjon — deterministisk klassifisering av hvilken rute en katalog-rad er.
 *
 * Bakgrunn: `rad_type` er upålitelig, og «FRONT» i et varenavn betyr ofte
 * frontDØR («FRONT DOORGLASS»), ikke vindusrute. Posisjon må derfor utledes fra
 * tre uavhengige signaler og slås sammen — ikke fra ett felt alene:
 *
 *   1. eurokode-posisjonsbokstav (A/B/F/L/R/S) — sterkest for TYPE og SIDE
 *   2. varenavn (norsk/engelsk/tysk) — eneste kilde for fremre/bakre og tak
 *   3. varenr-mønster (PY/GU = list, K = klips, <siffer><L|R> = sideglass)
 *
 * Viktig skille: eurokoden sier *side* for dørglass (L/R), men ikke om det er
 * fremre eller bakre dør. Navnet sier fremre/bakre, men nesten aldri side.
 * Derfor er de to ikke konflikt når de utfyller hverandre — bare når de er
 * uenige om TYPE (front vs bak vs dør vs side vs tak vs ventil).
 *
 * Verifisert mot alle 29 627 rader i produksjons-D1 2026-10-31
 * (se references/plassering-klassifisering.md i skill finnbilglass-katalog).
 */

export type GlassType = 'frontrute' | 'bakrute' | 'dor' | 'side' | 'ventil' | 'tak' | 'sidefamilie' | 'ukjent';
export type GlassSide = 'venstre' | 'hoyre' | 'begge' | null;
export type DorLedd = 'fremre' | 'bakre' | null;
export type VentilLedd = 'foran' | 'bakre' | null;

/** Typekode fra varekort (auto-glass.no) — eneste autoritative kilde for fremre/bakre */
export interface TypekodeInfo {
  dorLedd?: DorLedd;        // fremre | bakre
  ventilLedd?: VentilLedd;  // foran | bakre
  raa: string;              // original typekode-streng
}

export interface Posisjonsresultat {
  type: GlassType;
  side: GlassSide;
  dorLedd: DorLedd;
  ventilLedd: VentilLedd;
  /** Bare frontruter kan selges i denne releasen. */
  erFrontrute: boolean;
  /** Hvor typen kom fra — for sporing når noe ser feil ut. */
  kilde: 'eurokode' | 'navn' | 'begge' | 'typekode' | 'car-body-style' | 'ingen';
  /** Sann når navn og eurokode er uenige om TYPE. Skal ikke auto-avgjøres. */
  typekonflikt: boolean;
  navnType: GlassType | null;
  eurokodeType: GlassType | null;
  grunn: string;
}

/**
 * Hva eurokodens posisjonsbokstav faktisk sier — validerert mot 28 140 rader
 * (bokstav × navnetype, 2026-10-31):
 *
 *   A → frontrute 667 · B → bakrute 1 466
 *   L → dør 1 554, side 382, ventil 250   (venstre sideglass, alle typer)
 *   R → dør 1 521, side 354, ventil 242   (høyre sideglass, alle typer)
 *   F → dør 12, ventil 10, side 5         (for sjelden og tvetydig)
 *   S → 2 rader                            (for sjelden)
 *
 * Derfor: A og B gir type; L/R gir bare «sidefamilie» + side; F/S/andre gir
 * ingen type. Å mappe F→ventil ga falske konflikter på dørglass.
 */
const EUROKODE_GRUPPE: Record<string, GlassType> = {
  A: 'frontrute',
  B: 'bakrute',
  L: 'sidefamilie',
  R: 'sidefamilie',
};

const EUROKODE_SIDE: Record<string, GlassSide> = {
  L: 'venstre',
  R: 'hoyre',
};

/** Ord som bevisst navngir en annen rutetype. Ordgrenser hindrer
 *  «VENT» ⊂ «VENTURE» og «HATCH» ⊂ «HATCHBACK». */
function harOrd(navn: string, ord: readonly string[]): boolean {
  for (const o of ord) {
    const re = new RegExp(`(?<![A-ZÆØÅ0-9])${o}(?![A-ZÆØÅ0-9])`);
    if (re.test(navn)) return true;
  }
  return false;
}

const TAK_ORD = ['TAKGLASS', 'TAKRUTE', 'SOLTAK', 'TAKLUKE', 'PANORAMA', 'SUNROOF'] as const;
const BAK_ORD = ['BAKRUTE', 'BAKRUTA', 'BAGRUTE', 'BAGRUTA', 'BACKLITE', 'HECK'] as const;
// Svensk/tysk stavemåte forekommer i kilden: «3D DÖRRUTE», «DÖR», «TÜR».
const DOR_ORD = ['DØRRUTE', 'DORRUTE', 'DÖRRUTE', 'DÖRR', 'DÖR', 'DOOR', 'DOORGLASS', 'DOORWAY', 'DOORS', 'TUER', 'TÜR', 'TUR'] as const;
const VENTIL_ORD = ['VENTILRUTE', 'VENTRUTE', 'VENTIL', 'VENT'] as const;
const SIDE_ORD = ['SIDERUTE', 'SIDORUTE', 'SIDERUTA', 'SIDORUTA', 'SIDEGLASS', 'QUARTER', 'SIDE'] as const;
const FRONT_ORD = ['FRONTRUTE', 'VINDRUTE', 'WINDSHIELD', 'WS'] as const;
const FREMME_ORD = ['FREMME', 'FRAMME', 'FRAM', 'FORAN', 'FRONT'] as const;
const BAKRE_ORD = ['BAK', 'BAKRE', 'REAR'] as const;
const LIST_ORD = ['PYNTELIST', 'GUMMILIST', 'KLIPS', 'PAKNING', 'LIST'] as const;

/** Car-body-style mapping fra varenavn → antall dører → fremre/bakre logikk.
 *  2-dør (coupe, cabriolet, hardtop, 2D, 2-DOOR) → kun fremre dør
 *  3-dør (hatchback 3d, 3D, 3-DOOR) → kun fremre dør
 *  4/5-dør (sedan, kombi, st.vogn, station wagon, 4D, 5D, 4-DOOR, 5-DOOR) → fremre + bakre dør
 *  SUV / CROSSOVER / ESTATE / AVANT / TOURING / SPORTBACK ofte 4/5-dør
 *  Returnerer { harFremre: boolean, harBakre: boolean } eller null hvis ukjent. */
function carBodyStyleFraNavn(navn: string): { harFremre: boolean; harBakre: boolean } | null {
  const n = navn.toUpperCase();
  // 2-dør indikatorer
  if (/(?<![A-ZÆØÅ])COUPE(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])CABRIOLET(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])HARDTOP(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])2D(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])2-DOOR(?![A-ZÆØÅ])/.test(n)) {
    return { harFremre: true, harBakre: false };
  }
  // 3-dør (hatchback 3d) — kun fremre dør
  if (/(?<![A-ZÆØÅ])3D(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])3-DOOR(?![A-ZÆØÅ])/.test(n)) {
    return { harFremre: true, harBakre: false };
  }
  // 4/5-dør indikatorer (5D = 5 dørs, 4D = 4 dørs)
  if (/(?<![A-ZÆØÅ])SEDAN(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])KOMBI(?![A-ZÆØÅ])|(?<![A-ZØÅ])ST\.?VOGN(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])STATION\s*WAGON(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])4D(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])5D(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])4-DOOR(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])5-DOOR(?![A-ZÆØÅ])/.test(n)) {
    return { harFremre: true, harBakre: true };
  }
  // SUV / CROSSOVER / ESTATE / AVANT / TOURING / SPORTBACK ofte 4/5-dør
  if (/(?<![A-ZÆØÅ])SUV(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])CROSSOVER(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])ESTATE(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])AVANT(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])TOURING(?![A-ZÆØÅ])|(?<![A-ZÆØÅ])SPORTBACK(?![A-ZÆØÅ])/.test(n)) {
    return { harFremre: true, harBakre: true };
  }
  return null;
}

/** Parse typekode-streng fra varekort til strukturert info.
 *  Eksempler: "Dørrute fremre førerside", "Ventilrute bakre høyre", "Dørrute bakre venstre" */
function parseTypekode(typekode: string | null | undefined): TypekodeInfo | null {
  if (!typekode) return null;
  const t = typekode.toUpperCase();
  const info: TypekodeInfo = { raa: typekode };
  // Dørrute fremre/bakre
  if (t.includes('DØRRUTE') || t.includes('DORRUTE') || t.includes('DOOR')) {
    if (t.includes('FREMRE') || t.includes('FRAMME') || t.includes('FRONT') || t.includes('FORAN')) info.dorLedd = 'fremre';
    else if (t.includes('BAKRE') || t.includes('REAR') || t.includes('BAK')) info.dorLedd = 'bakre';
  }
  // Ventilrute foran/bakre
  if (t.includes('VENTIL') || t.includes('VENT')) {
    if (t.includes('FREMRE') || t.includes('FRAMME') || t.includes('FRONT') || t.includes('FORAN') || t.includes('FOR')) info.ventilLedd = 'foran';
    else if (t.includes('BAKRE') || t.includes('REAR') || t.includes('BAK')) info.ventilLedd = 'bakre';
  }
  return (info.dorLedd || info.ventilLedd) ? info : null;
}

/** Type fra varenavn. Rekkefølgen er prioritet: tak og bak vinner over dør,
 *  dør vinner over front — slik at «FRONT DOORGLASS» blir dør, ikke frontrute. */
function typeFraNavn(navn: string): GlassType | null {
  if (harOrd(navn, TAK_ORD)) return 'tak';
  if (harOrd(navn, BAK_ORD)) return 'bakrute';
  if (harOrd(navn, DOR_ORD)) return 'dor';
  if (harOrd(navn, VENTIL_ORD)) return 'ventil';
  if (harOrd(navn, SIDE_ORD)) return 'side';
  if (harOrd(navn, FRONT_ORD)) return 'frontrute';
  return null;
}

function eurokodeDeler(kode: string | null | undefined): { gruppe: GlassType | null; side: GlassSide } {
  if (!kode) return { gruppe: null, side: null };
  const m = /^(\d{3,5})(.*)$/.exec(kode.toUpperCase());
  // Ingen 3–5-sifret katalogkode → ikke en eurokode (OEM-delnummer, «BYTTNR»).
  if (!m) return { gruppe: null, side: null };
  const bokstav = m[2].charAt(0);
  return { gruppe: EUROKODE_GRUPPE[bokstav] ?? null, side: EUROKODE_SIDE[bokstav] ?? null };
}

/** Er navnetypen forenlig med eurokodegruppen? Dør/side/ventil er alle
 *  «sidefamilie» i eurokoden — de er ikke i konflikt med hverandre. */
function forenlig(navnType: GlassType, gruppe: GlassType): boolean {
  if (gruppe === 'sidefamilie') return navnType === 'dor' || navnType === 'side' || navnType === 'ventil';
  return navnType === gruppe;
}

function sideFraNavn(navn: string): GlassSide {
  // Kilden skriver både «VS/HS» og «VS+HS».
  if (/VS\s*[\/+]\s*HS|V\s*[\/+]\s*H(?![A-ZÆØÅ])|VENSTRE\s*[\/+]\s*HØYRE/.test(navn)) return 'begge';
  if (/(?<![A-ZÆØÅ])VS(?![A-ZÆØÅ])|VENSTRE/.test(navn)) return 'venstre';
  if (/(?<![A-ZÆØÅ])HS(?![A-ZÆØÅ])|HØYRE|HOYRE/.test(navn)) return 'hoyre';
  return null;
}

function dorLeddFraNavn(navn: string): DorLedd {
  if (harOrd(navn, FREMME_ORD)) return 'fremre';
  if (harOrd(navn, BAKRE_ORD)) return 'bakre';
  return null;
}

/**
 * Klassifiser én katalograd.
 *
 * `erFrontrute` er bevisst konservativ: bare når typen er frontrute (fra navn
 * eller eurokode) og radet ikke er en list/klips og ikke har typekonflikt.
 *
 * @param typekode — typekode fra varekort (auto-glass.no) for presis fremre/bakre, foran/bakre ventil
 */
export function klassifiserGlass(
  varenavn: string | null | undefined,
  varenr: string | null | undefined,
  eurokode: string | null | undefined,
  typekode?: string | null,
): Posisjonsresultat {
  const navn = (varenavn ?? '').toUpperCase();
  const vr = (varenr ?? '').toUpperCase();

  const navnType = typeFraNavn(navn);
  const { gruppe, side: euroSide } = eurokodeDeler(eurokode);

  let type: GlassType;
  let kilde: Posisjonsresultat['kilde'];
  if (navnType && gruppe) {
    kilde = 'begge';
    type = navnType;
  } else if (navnType) {
    type = navnType;
    kilde = 'navn';
  } else if (gruppe) {
    type = gruppe;
    kilde = 'eurokode';
  } else {
    type = 'ukjent';
    kilde = 'ingen';
  }

  const typekonflikt = !!(navnType && gruppe && !forenlig(navnType, gruppe));
  const side = sideFraNavn(navn) ?? euroSide;

  // Typekode fra varekort (høyest prioritet for fremre/bakre, foran/bakre ventil)
  const tk = parseTypekode(typekode);
  let dorLedd: DorLedd = null;
  let ventilLedd: VentilLedd = null;
  let kildeOverride = false;
  const harTypekode = !!typekode; // typekode-parameter ble eksplisitt sendt (kan være tom streng)

  if (tk) {
    if (tk.dorLedd) { dorLedd = tk.dorLedd; kildeOverride = true; }
    if (tk.ventilLedd) { ventilLedd = tk.ventilLedd; kildeOverride = true; }
  }

  // Navn-basert fremre/bakre (hvis typekode ikke ga svar)
  if (!dorLedd && type === 'dor') {
    dorLedd = dorLeddFraNavn(navn);
    if (dorLedd) kildeOverride = true;
  }
  if (!ventilLedd && type === 'ventil') {
    // Navnet har ingen foran/bakre for ventil — fallback til car-body-style under
  }

  // Car-body-style fallback for dørruter: KUN når ingen typekode-parameter ble sendt
  // (typekode fra varekort er eneste autoritative kilde; car-body-style er kun estimat)
  if (!dorLedd && type === 'dor' && !harTypekode) {
    const cbs = carBodyStyleFraNavn(navn);
    if (cbs) {
      // Hvis eurokode side = venstre → fremre førerside (venstre)
      // Hvis eurokode side = høyre → fremre passasjerside (høyre)
      // For bakre: motsatt side av fremre på samme bil
      // Enkel logikk: venstre side = fremre venstre (førerside), høyre side = fremre høyre (passasjerside)
      // Bakre dør er samme side som fremre (venstre/høyre), men bakre
      if (side === 'venstre' && cbs.harFremre) dorLedd = 'fremre';
      else if (side === 'hoyre' && cbs.harFremre) dorLedd = 'fremre';
      else if (side === 'venstre' && cbs.harBakre) dorLedd = 'bakre';
      else if (side === 'hoyre' && cbs.harBakre) dorLedd = 'bakre';
      // Hvis bilen har både fremre og bakre (4/5-dør), bestem utfra kontekst:
      // De fleste dørruter i katalogen er fremre — men vi vet det ikke uten typekode.
      // Så vi setter ikke dorLedd her uten typekode, men logger at car-body-style finnes.
      if (dorLedd) kilde = 'car-body-style';
    }
  }

  // Ikke-glass: dekorlist, klips, pakning og klips-kit.
  const erListe = harOrd(navn, LIST_ORD) || /(?:PY|GU)[A-Z]{0,4}$/.test(vr) || /^\d{3,5}K$/.test(vr);
  const erFrontrute = type === 'frontrute' && !erListe && !typekonflikt;

  let grunn: string;
  if (typekonflikt) grunn = `navn sier ${navnType}, eurokode sier ${gruppe} — må verifiseres`;
  else if (erListe) grunn = 'list/klips/pakning, ikke glass';
  else if (type === 'ukjent') grunn = 'ingen posisjon i navn eller eurokode';
  else if (type === 'sidefamilie') grunn = `sideglass (${side ?? 'ukjent side'}), type ikke oppgitt i navnet`;
  else {
    const ledd = type === 'dor' ? dorLedd : type === 'ventil' ? ventilLedd : null;
    grunn = `${type}${side ? ` ${side}` : ''}${ledd ? ` ${ledd}` : ''} (${kildeOverride ? 'typekode' : kilde})`;
  }

  return {
    type,
    side,
    dorLedd,
    ventilLedd,
    erFrontrute,
    kilde: kildeOverride ? 'typekode' : kilde,
    typekonflikt,
    navnType,
    eurokodeType: gruppe,
    grunn,
  };
}

/** Bekvemmelighet for filtrering: er raden en frontrute vi kan vise kunden? */
export function erFrontruteRad(
  varenavn: string | null | undefined,
  varenr: string | null | undefined,
  eurokode: string | null | undefined,
  typekode?: string | null,
): boolean {
  return klassifiserGlass(varenavn, varenr, eurokode, typekode).erFrontrute;
}
