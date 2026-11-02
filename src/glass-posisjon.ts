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
  /** Sann når typekoden motsier navn/eurokode. Blokkerer alltid auto-godkjenning. */
  typekodeKonflikt: boolean;
  navnType: GlassType | null;
  eurokodeType: GlassType | null;
  grunn: string;
  /** Normalisert typekode når registeret har en dokumentert plassering. */
  typekode?: TypekodePosisjon | null;
}

/**
 * Fullstendig, normalisert plassering fra typekode-registeret.
 * Typekodene er dokumentert i `docs/glass-position-codebook.md` og verifisert
 * mot 20 601 rader i `glass_typekode`.
 */
export interface TypekodePosisjon {
  kode: string;
  type: GlassType;
  /** Kildens egen betegnelse — fører/passasjer, ikke venstre/høyre. */
  side: 'forer' | 'passasjer' | null;
  /** Fysisk side. Alltid null når styretypen ikke er kjent — aldri gjettet. */
  fysiskSide: GlassSide;
  /** Sann når det mangler dokumentert styretype og fysisk side må avklares. */
  fysiskSideKreverAvklaring: boolean;
  dorLedd: DorLedd;
  ventilLedd: VentilLedd;
  /** 1, 2 eller 3 for nummererte bakre sideruter. */
  sideruteNummer: number | null;
  /** BF/BP = delt bakrute (to glass), ikke vanlig bakrute. */
  deltBakrute: boolean;
  gyldig: boolean;
  grunn: string;
}

/** Alle kodene som finnes i registeret. Ukjente koder skal ikke tolkes. */
const TYPEKODE_MONSTER = /^(F|B|BF|BP|D[FP][FB][V]?|S[FP]B[123])$/;

/**
 * Oversetter en typekode til full posisjon.
 *
 * @param kjorestyring — 'venstre' (LHD, norsk standard) eller 'hoyre' (RHD).
 *   Sendes den ikke, utledes fysisk side ikke, og `fysiskSideAntatt` blir true
 *   bare når vi faller tilbake på venstrestyring. Fører/passasjer lagres alltid.
 */
export function fraTypekode(
  kode: string | null | undefined,
  kjorestyring: 'venstre' | 'hoyre' | null = null,
): TypekodePosisjon | null {
  if (!kode) return null;
  const k = kode.trim().toUpperCase();
  if (!TYPEKODE_MONSTER.test(k)) return null;

  // Uten dokumentert styretype finnes ingen fysisk side. Vi lagrer aldri en
  // antakelse som om den var et faktum — kunden må avklare styretypen først.
  const kreverAvklaring = kjorestyring === null;
  const forerErVenstre = kjorestyring === 'venstre';
  const fysisk = (side: 'forer' | 'passasjer' | null): GlassSide => {
    if (side === null || kreverAvklaring) return null;
    return side === 'forer' ? (forerErVenstre ? 'venstre' : 'hoyre') : forerErVenstre ? 'hoyre' : 'venstre';
  };

  const base: TypekodePosisjon = {
    kode: k,
    type: 'ukjent',
    side: null,
    fysiskSide: null,
    fysiskSideKreverAvklaring: kreverAvklaring,
    dorLedd: null,
    ventilLedd: null,
    sideruteNummer: null,
    deltBakrute: false,
    gyldig: true,
    grunn: '',
  };

  if (k === 'F') return { ...base, type: 'frontrute', grunn: 'frontrute' };
  if (k === 'B') return { ...base, type: 'bakrute', grunn: 'bakrute' };
  if (k === 'BF' || k === 'BP') {
    const side = k === 'BF' ? 'forer' : 'passasjer';
    return { ...base, type: 'bakrute', side, fysiskSide: fysisk(side), deltBakrute: true, grunn: `delt bakrute, ${side}` };
  }
  if (/^D[FP][FB]$/.test(k)) {
    const side = k[1] === 'F' ? 'forer' : 'passasjer';
    const ledd: DorLedd = k[2] === 'F' ? 'fremre' : 'bakre';
    return { ...base, type: 'dor', side, fysiskSide: fysisk(side), dorLedd: ledd, grunn: `dørrute ${ledd} ${side}` };
  }
  if (/^D[FP][FB]V$/.test(k)) {
    const side = k[1] === 'F' ? 'forer' : 'passasjer';
    const ledd: VentilLedd = k[2] === 'F' ? 'foran' : 'bakre';
    return { ...base, type: 'ventil', side, fysiskSide: fysisk(side), ventilLedd: ledd, grunn: `ventilrute ${ledd} ${side}` };
  }
  const sideRute = /^(S[FP])B([123])$/.exec(k);
  if (sideRute) {
    const side = sideRute[1] === 'SF' ? 'forer' : 'passasjer';
    const nummer = Number(sideRute[2]);
    return { ...base, type: 'side', side, fysiskSide: fysisk(side), sideruteNummer: nummer, grunn: `siderute ${nummer} ${side}` };
  }

  return { ...base, gyldig: false, grunn: `ukjent typekode «${k}»` };
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

/**
 * Hvilke dører bilen HAR ifølge karosseritypen.
 *
 * Denne funksjonen sier IKKE hvilken dørrute et bestemt glass er, og brukes
 * derfor aldri til å sette `dorLedd`. Bare typekoden gir det svaret.
 *
 *  2-dør (coupe, cabriolet, hardtop, 2D, 2-DOOR) → kun fremre dør
 *  3-dør (hatchback 3d, 3D, 3-DOOR) → kun fremre dør
 *  4/5-dør (sedan, kombi, st.vogn, station wagon, 4D, 5D, 4-DOOR, 5-DOOR) → fremre + bakre dør
 *  SUV / CROSSOVER / ESTATE / AVANT / TOURING / SPORTBACK ofte 4/5-dør
 *  Returnerer { harFremre: boolean, harBakre: boolean } eller null hvis ukjent.
 */
export function carBodyStyleFraNavn(navn: string): { harFremre: boolean; harBakre: boolean } | null {
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
  let side = sideFraNavn(navn) ?? euroSide;

  // Typekode først: registeret (F, B, DFF, DFB, DPF, DPB, SFB1-3, DFFV …)
  // er autoritativt. Beskrivelsesstrenger («Dørrute fremre førerside») er reserve.
  const tp = fraTypekode(typekode);
  const tk = tp && tp.gyldig ? null : parseTypekode(typekode);
  let dorLedd: DorLedd = tp?.dorLedd ?? null;
  let ventilLedd: VentilLedd = tp?.ventilLedd ?? null;
  let kildeOverride = false;
  const harTypekode = !!typekode; // typekode-parameter ble eksplisitt sendt (kan være tom streng)

  if (tk) {
    if (tk.dorLedd) { dorLedd = tk.dorLedd; kildeOverride = true; }
    if (tk.ventilLedd) { ventilLedd = tk.ventilLedd; kildeOverride = true; }
  }

  // Typekoden bestemmer hva slags glass det er — men bare når den ikke
  // motsier navn/eurokode. Motstrid blokkerer automatisk godkjenning.
  let typekodeKonflikt = false;
  if (tp && tp.gyldig && tp.type !== 'ukjent') {
    if (type !== 'ukjent' && type !== 'sidefamilie' && tp.type !== type) {
      typekodeKonflikt = true;
    } else {
      type = tp.type;
      kildeOverride = true;
      if (tp.fysiskSide && side === null) side = tp.fysiskSide;
      else if (tp.fysiskSide && side !== 'begge' && tp.fysiskSide !== side) {
        // Navn/eurokode sier én side, typekoden en annen.
        typekodeKonflikt = true;
      }
    }
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
  // Karosseritype sier hvilke dører bilen HAR, ikke hvilken dørrute dette glasset er.
  // Den kan derfor aldri sette dorLedd — bare bekrefte at posisjonen er mulig.
  // Uten typekode forblir dorLedd null, og posisjonen må avklares med kunden.

  // Ikke-glass: dekorlist, klips, pakning og klips-kit.
  const erListe = harOrd(navn, LIST_ORD) || /(?:PY|GU)[A-Z]{0,4}$/.test(vr) || /^\d{3,5}K$/.test(vr);
  const erFrontrute = type === 'frontrute' && !erListe && !typekonflikt && !typekodeKonflikt;

  let grunn: string;
  if (typekodeKonflikt) grunn = `typekode ${tp?.kode} (${tp?.grunn}) motsier navn/eurokode (${type}) — må verifiseres`;
  else if (typekonflikt) grunn = `navn sier ${navnType}, eurokode sier ${gruppe} — må verifiseres`;
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
    typekodeKonflikt,
    navnType,
    eurokodeType: gruppe,
    grunn,
    typekode: tp,
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

/**
 * Ønske om en bestemt glassposisjon — slik kunden eller saksbehandleren har uttrykt det.
 * Alle felt er valgfrie: det som ikke er oppgitt, filtrerer ikke.
 */
export interface Posisjonsonske {
  glassklasse?: 'frontrute' | 'bakrute' | 'dor' | 'ventil' | 'side' | null;
  sideKilde?: 'forer' | 'passasjer' | null;
  dorLedd?: 'fremre' | 'bakre' | null;
  ventilLedd?: 'foran' | 'bakre' | null;
  sideruteNummer?: number | null;
  deltBakrute?: boolean | null;
}

/**
 * Filtrerer kandidater på posisjon.
 *
 * Regler:
 *  - Bare oppgitte ønsker filtrerer. «Siderute» uten nummer beholder 1, 2 og 3.
 *  - Kandidat uten dokumentert plassering beholdes når ønsket er bredt, men
 *    fjernes når ønsket er spesifikt (vi kan ikke bevise at den passer).
 *  - Filtrering gir aldri EXACT. Den fjerner bare det som beviselig er feil plass.
 */
export function filtrerPaPosisjon<T extends { varenavn?: string | null; varenr?: string | null; eurokode?: string | null; typekode?: string | null }>(
  kandidater: T[],
  onske: Posisjonsonske | null | undefined,
): T[] {
  if (!onske) return kandidater;
  const spesifikt = Boolean(onske.glassklasse || onske.sideKilde || onske.dorLedd || onske.ventilLedd || onske.sideruteNummer != null || onske.deltBakrute != null);
  if (!spesifikt) return kandidater;

  return kandidater.filter((k) => {
    const tp = fraTypekode(k.typekode ?? null);
    // Ingen dokumentert plassering: behold bare når vi ikke leter etter noe bestemt.
    if (!tp || !tp.gyldig || tp.type === 'ukjent') return false;
    if (onske.glassklasse && tp.type !== onske.glassklasse) return false;
    if (onske.sideKilde && tp.side !== onske.sideKilde) return false;
    if (onske.dorLedd && tp.dorLedd !== onske.dorLedd) return false;
    if (onske.ventilLedd && tp.ventilLedd !== onske.ventilLedd) return false;
    if (onske.sideruteNummer != null && tp.sideruteNummer !== onske.sideruteNummer) return false;
    if (onske.deltBakrute != null && tp.deltBakrute !== onske.deltBakrute) return false;
    return true;
  });
}
