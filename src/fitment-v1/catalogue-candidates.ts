/**
 * fitment-v1/catalogue-candidates — CLASS_D-kandidatgenerator fra gt-auto-prislisten.
 *
 * Katalogdata er KUN kandidatmateriale: CLASS_D_CATALOGUE_CANDIDATE, ALDRI
 * VERIFIED_FITMENT, ALDRI EXACT, ALDRI automatisk OE-aksept (Tom-beslutning C7.5).
 *
 * Kjernen er tre uavhengige avgjørelser, og hver av dem har én autoritativ kilde:
 *
 *   1. HVILKEN BIL raden gjelder  — merke + modell-familie parset fra `varenavn`
 *      med ORDAVGRENSEDE regexer. «/CLA/» uten grense matcher «E-CLASS» og
 *      «C-CLASSE», og gir da frontruter til helt andre Mercedes-modeller.
 *   2. HVILKEN PLASSERING raden har — `klassifiserGlass()` i `src/glass-posisjon.ts`
 *      (navn + eurokode + varenr). Nøkkelord i navnet alene gir NULL treff på
 *      ekte katalograder: «MERCEDES CLA-CLASSE 4D COUPE 13-» er en frontrute
 *      uten at ordet «front» finnes i navnet.
 *   3. HVILKE ÅR raden dekker — katalogens tosifrede intervall, klemt inn til
 *      dokumentert generasjonsvindu. Et åpent intervall («91-») betyr «til
 *      videre», ikke «matcher alt»: uten klemming matcher 1991-raden en 2005-bil.
 *
 * Ved tvil returneres INGEN kandidat. En manglende kandidat gir manuell
 * kontroll; en feil kandidat gir feil glass på bilen.
 */
import {
  klassifiserGlass,
  erListeRad,
  type GlassType,
  type GlassSide,
  type DorLedd,
  type VentilLedd,
} from '../glass-posisjon.js';

export interface CatalogueCandidate {
  eurokode: string;
  varenr: string;
  varenavn: string;
  features: string[];
  source: 'GT_AUTO_PRISLISTE';
  klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE';
  matchReason: string;
  /** Intern: merke raden ble parset inn i. Aldri i et offentlig svar. */
  merke: string;
  /** Intern: modell-familie raden ble parset inn i. Aldri i et offentlig svar. */
  familie: string;
  /** Intern: produksjonsintervall slik katalogen oppgir det (uklemt). */
  aarFra: number | null;
  aarTil: number | null;
  /** Intern: generasjons-token fra varenavnet (T5, IV, B8 …). */
  generasjon: string | null;
  /** Intern: plassering utledet av klassifiserGlass(). */
  posisjon: {
    type: GlassType;
    side: GlassSide;
    dorLedd: DorLedd;
    ventilLedd: VentilLedd;
    /** Navn og eurokode uenige om type — plasseringen er ikke beviselig. */
    konflikt: boolean;
  };
}

interface ParsedRow {
  varenr: string;
  eurokode: string;
  varenavn: string;
  merke: string;
  familie: string;
  aarFra: number | null;
  aarTil: number | null;
  generasjon: string | null;
}

const MERKE_ALIAS: Record<string, string[]> = {
  VW: ['VW', 'VOLKSWAGEN', 'VAG'],
  MERCEDES: ['MERCEDES', 'MB', 'M-B'],
  BMW: ['BMW'],
  VOLVO: ['VOLVO'],
  TESLA: ['TESLA'],
  NISSAN: ['NISSAN'],
  TOYOTA: ['TOYOTA'],
  FORD: ['FORD'],
  OPEL: ['OPEL'],
  AUDI: ['AUDI'],
  RENAULT: ['RENAULT'],
  PEUGEOT: ['PEUGEOT'],
  HONDA: ['HONDA'],
  MAZDA: ['MAZDA'],
  MINI: ['MINI'],
};

/**
 * Ordavgrenset regex for katalog-tokens.
 *
 * Katalogen skiller modeller med bindestrek og suffiks («CLA-CLASSE»,
 * «E-CLASS», «A+B CLASSE»), så et prefiks-treff er alltid feil bil.
 */
function ordbundet(alternativer: string): RegExp {
  return new RegExp(`(?<![A-ZÆØÅ0-9])(?:${alternativer})(?![A-ZÆØÅ0-9])`);
}

/** Familie-regler: (merke, ordavgrenset regex på modell-token) → familie-nøkkel. */
export const FAMILIER: { merke: string; re: RegExp; familie: string }[] = [
  { merke: 'VW', re: ordbundet('GOLF'), familie: 'GOLF' },
  { merke: 'VW', re: ordbundet('PASSAT'), familie: 'PASSAT' },
  { merke: 'VW', re: ordbundet('POLO'), familie: 'POLO' },
  { merke: 'VW', re: ordbundet('TRANSPORTER|TRANSPORT|MULTIVAN|CARAVELLE|T5|T6|T6\\.1'), familie: 'TRANSPORTER' },
  { merke: 'MERCEDES', re: ordbundet('CLA'), familie: 'CLA' },
  { merke: 'MERCEDES', re: ordbundet('SPRINTER'), familie: 'SPRINTER' },
  { merke: 'MERCEDES', re: ordbundet('VITO|V-CLASS|V-CLASSE'), familie: 'VITO' },
  { merke: 'MERCEDES', re: ordbundet('A-CLASS|A-CLASSE|A KLASSE'), familie: 'A-CLASS' },
  { merke: 'MERCEDES', re: ordbundet('GLA'), familie: 'GLA' },
  { merke: 'BMW', re: ordbundet('1-SERIE|1 SERIE|1ER|1(?:14|16|18|20|25)[A-Z]?'), familie: '1-SERIE' },
  { merke: 'BMW', re: ordbundet('3-SERIE|3 SERIE|3ER|3(?:16|18|20|25|28|30|35|40)[A-Z]?'), familie: '3-SERIE' },
  { merke: 'VOLVO', re: ordbundet('XC60'), familie: 'XC60' },
  { merke: 'VOLVO', re: ordbundet('XC90'), familie: 'XC90' },
  { merke: 'TESLA', re: ordbundet('MODEL\\s?3'), familie: 'MODEL-3' },
  { merke: 'TESLA', re: ordbundet('MODEL\\s?Y'), familie: 'MODEL-Y' },
  { merke: 'NISSAN', re: ordbundet('LEAF'), familie: 'LEAF' },
  { merke: 'TOYOTA', re: ordbundet('RAV4|RAV\\s?4'), familie: 'RAV4' },
  { merke: 'TOYOTA', re: ordbundet('COROLLA'), familie: 'COROLLA' },
  { merke: 'TOYOTA', re: ordbundet('HILUX'), familie: 'HILUX' },
  { merke: 'FORD', re: ordbundet('TRANSIT'), familie: 'TRANSIT' },
  { merke: 'OPEL', re: ordbundet('CORSA'), familie: 'CORSA' },
  { merke: 'OPEL', re: ordbundet('ASTRA'), familie: 'ASTRA' },
  { merke: 'OPEL', re: ordbundet('VECTRA'), familie: 'VECTRA' },
  { merke: 'MINI', re: ordbundet('COOPER|MINI'), familie: 'MINI' },
];

/**
 * Generasjonsvinduer per familie.
 *
 * KILDE: `src/fitment-v1/generation-registry.ts` (SVV-mønsteranalyse 2026-08-16,
 * Wikipedia-fasit). Tabellen her er en duplikat fordi kandidatgeneratoren skal
 * være avhengighetsfri; `tests/generasjon-konsistens.test.mjs` låser at de to
 * tabellene er enige, slik at de ikke kan gli fra hverandre.
 *
 * Én rad per generasjon med HELE produksjonsintervallet — facelift-splittene i
 * registeret brukes ikke til posisjonsmatching.
 */
export interface Generasjonsvindu {
  token: string;
  fra: number;
  til: number | null;
}

export const GENERASJONER: Record<string, Generasjonsvindu[]> = {
  TRANSPORTER: [
    { token: 'T4', fra: 1990, til: 2003 },
    { token: 'T5', fra: 2003, til: 2015 },
    { token: 'T6', fra: 2015, til: 2024 },
  ],
  GOLF: [
    { token: 'I', fra: 1974, til: 1983 },
    { token: 'II', fra: 1983, til: 1991 },
    { token: 'III', fra: 1991, til: 1997 },
    { token: 'IV', fra: 1997, til: 2003 },
    { token: 'V', fra: 2003, til: 2008 },
    { token: 'VI', fra: 2008, til: 2012 },
    { token: 'VII', fra: 2012, til: 2019 },
    { token: 'VIII', fra: 2019, til: null },
  ],
  PASSAT: [
    { token: 'B1', fra: 1973, til: 1981 },
    { token: 'B2', fra: 1981, til: 1988 },
    { token: 'B3', fra: 1988, til: 1993 },
    { token: 'B4', fra: 1993, til: 1996 },
    { token: 'B5', fra: 1996, til: 2005 },
    { token: 'B6', fra: 2005, til: 2010 },
    { token: 'B7', fra: 2010, til: 2014 },
    { token: 'B8', fra: 2014, til: 2023 },
    { token: 'B9', fra: 2023, til: null },
  ],
  POLO: [
    { token: 'I', fra: 1975, til: 1981 },
    { token: 'II', fra: 1981, til: 1994 },
    { token: 'III', fra: 1994, til: 2002 },
    { token: 'IV', fra: 2002, til: 2009 },
    { token: 'V', fra: 2009, til: 2017 },
    { token: 'VI', fra: 2017, til: null },
  ],
  CLA: [
    { token: 'C117', fra: 2013, til: 2019 },
    { token: 'C118', fra: 2019, til: null },
  ],
  CORSA: [
    { token: 'A', fra: 1982, til: 1993 },
    { token: 'B', fra: 1993, til: 2000 },
    { token: 'C', fra: 2000, til: 2006 },
    { token: 'D', fra: 2006, til: 2014 },
  ],
  ASTRA: [
    { token: 'F', fra: 1991, til: 1998 },
    { token: 'G', fra: 1998, til: 2004 },
    { token: 'H', fra: 2004, til: 2010 },
    { token: 'J', fra: 2010, til: 2015 },
    { token: 'K', fra: 2015, til: 2021 },
  ],
  VECTRA: [
    { token: 'A', fra: 1988, til: 1995 },
    { token: 'B', fra: 1995, til: 2002 },
    { token: 'C', fra: 2002, til: 2008 },
  ],
  MINI: [
    { token: 'R50', fra: 2001, til: 2006 },
    { token: 'R56', fra: 2007, til: 2013 },
    { token: 'F56', fra: 2014, til: null },
  ],
};

/**
 * Hvor mange år et ÅPENT katalogintervall («13-») antas å dekke når vi ikke har
 * et dokumentert generasjonsvindu for familien.
 *
 * 12 år = det lengste produksjonsforløpet som er dokumentert i
 * generation-registry (VW Transporter T5, 2003–2015). Uten tak matcher «91-»
 * evig og en 1991-rute blir foreslått til en 2005-bil. Taket kan bare gi
 * MANGLENDE kandidat (→ manuell kontroll), aldri feil kandidat.
 */
export const APENT_INTERVALL_SPENN = 12;

function toAar(token: string): number {
  const n = parseInt(token, 10);
  if (token.length === 4) return n;
  return n <= 25 ? 2000 + n : 1900 + n;
}

/**
 * Trekker ut produksjonsintervall fra varenavnet.
 *
 * Godtar tosifret katalogform («84-90», «03-08», «12-») og firesifret form
 * («2003-», «2016-2019»). Det som IKKE er et intervall skal ikke tolkes som ett:
 * derfor kreves to siffer og ordgrense på begge sider («4D» er ikke år 4).
 */
export function aarIntervall(varenavn: string): { fra: number | null; til: number | null } {
  const navn = String(varenavn ?? '').toUpperCase();
  const lukket = /(?<![A-ZÆØÅ0-9])(?:19|20)?(\d{2})\s*[-–]\s*(?:19|20)?(\d{2})(?![0-9])/.exec(navn);
  if (lukket) {
    const fra = toAar(lukket[1]);
    const til = toAar(lukket[2]);
    if (til >= fra) return { fra, til };
  }
  // Åpent intervall: «03-» kan stå midt i navnet («… T5 03- FRONTRUTE»), ikke
  // bare på slutten. Et bindestrek som innleder et nytt tall er derimot et
  // lukket intervall (håndtert over), ikke et åpent.
  const apent = /(?<![A-ZÆØÅ0-9])(?:19|20)?(\d{2})\s*[-–](?!\s*[0-9])/.exec(navn);
  if (apent) return { fra: toAar(apent[1]), til: null };
  return { fra: null, til: null };
}

/** Generasjons-token fra varenavnet. Bare former katalogen faktisk bruker. */
function generasjonsToken(varenavn: string, familie: string): string | null {
  const vinduer = GENERASJONER[familie];
  if (!vinduer) return null;
  for (const v of vinduer) {
    // Token må stå som eget ord: «T5», «B8», «IV», «C117», «R56».
    const re = new RegExp(`(?<![A-ZÆØÅ0-9])${v.token.replace('.', '\\.')}(?![A-ZÆØÅ0-9])`);
    if (re.test(varenavn)) return v.token;
  }
  return null;
}

function finnMerke(varenavn: string): string | null {
  for (const [merke, aliases] of Object.entries(MERKE_ALIAS)) {
    if (aliases.some((a) => varenavn.startsWith(a) || varenavn.includes(' ' + a))) return merke;
  }
  return null;
}

/** Normaliserer innkommende merke (SVV: «VOLKSWAGEN»/«MERCEDES-BENZ») til katalog-nøkkel. */
export function normMerke(merke: string): string {
  const m = String(merke ?? '').trim().toUpperCase();
  for (const [nokkel, aliases] of Object.entries(MERKE_ALIAS)) {
    if (aliases.some((a) => m === a || m.startsWith(a + ' ') || m.startsWith(a + '-'))) return nokkel;
  }
  return m;
}

function parseRow(r: { varenr: string; eurokode?: string | null; varenavn?: string | null }): ParsedRow | null {
  const varenavn = String(r.varenavn ?? '').toUpperCase();
  const merke = finnMerke(varenavn);
  if (!merke) return null;
  for (const fam of FAMILIER) {
    if (fam.merke !== merke) continue;
    // Familien avgjøres av MODELL-tokenet, ikke av hele navnet: merkenavnet
    // står først i varenavnet og skal ikke kunne tilfredsstille familie-regexen.
    const utenMerke = varenavn.replace(/^[A-ZÆØÅ0-9-]+[,\s]+/, '');
    if (!fam.re.test(utenMerke)) continue;
    const { fra, til } = aarIntervall(varenavn);
    return {
      varenr: r.varenr,
      eurokode: r.eurokode ?? '',
      varenavn,
      merke,
      familie: fam.familie,
      aarFra: fra,
      aarTil: til,
      generasjon: generasjonsToken(varenavn, fam.familie),
    };
  }
  return null;
}

function featuresFraKommentar(kommentar?: string | null): string[] {
  const k = String(kommentar ?? '').toUpperCase();
  const f: string[] = [];
  if (/EMB=10\d/.test(k)) f.push('encapsulated');
  if (/ANTENNEFESTE|ANTENNE/.test(k)) f.push('antenna');
  if (/REGN|SENSOR|REGNSENSOR/.test(k)) f.push('rainSensor');
  if (/CAMERA|KAMERA|LDW/.test(k)) f.push('camera');
  if (/COATED|SOLAR|IR-/.test(k)) f.push('coated');
  if (/HEATED|OPPVARMET/.test(k)) f.push('heated');
  if (/ACOUSTIC|AKUSTISK|NOISE/.test(k)) f.push('acoustic');
  return f;
}

/** CLASS_D-kandidatindeks bygget fra gt-auto-prisliste-radene. */
export function buildClassDCandidates(
  rows: { varenr: string; eurokode?: string | null; varenavn?: string | null; kommentar?: string | null }[],
): CatalogueCandidate[] {
  const out: CatalogueCandidate[] = [];
  for (const r of rows) {
    const p = parseRow(r);
    if (!p) continue;
    const pos = klassifiserGlass(p.varenavn, p.varenr, p.eurokode);
    out.push({
      eurokode: p.eurokode,
      varenr: p.varenr,
      varenavn: p.varenavn,
      features: featuresFraKommentar(r.kommentar),
      source: 'GT_AUTO_PRISLISTE',
      klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE',
      matchReason: `${p.merke} ${p.familie}${p.generasjon ? ' ' + p.generasjon : ''}${p.aarFra ? ' ' + p.aarFra + '–' + (p.aarTil ?? '') : ''}`,
      merke: p.merke,
      familie: p.familie,
      aarFra: p.aarFra,
      aarTil: p.aarTil,
      generasjon: p.generasjon,
      posisjon: {
        type: pos.type,
        side: pos.side,
        dorLedd: pos.dorLedd,
        ventilLedd: pos.ventilLedd,
        konflikt: pos.typekonflikt || pos.typekodeKonflikt,
      },
    });
  }
  return out;
}

export interface ClassDOenske {
  glassklasse?: string | null;
  dorLedd?: string | null;
  ventilLedd?: string | null;
  /**
   * Produktets FYSISKE side, utledet av kundens venstre/høyre.
   *
   * Norsk marked er venstrestyrt (MARKEDSSTANDARD), så «venstre sett i
   * kjøreretningen» = førersiden = fysisk venstre glass. Det er en
   * markedsantakelse, ikke en måling — derfor filtreres bare det som er
   * beviselig motsatt side, og rader med ukjent side beholdes.
   */
  produktSide?: 'venstre' | 'hoyre' | null;
}

/**
 * Navn som er egne modeller, ikke varianter av familiebilen.
 *
 * Katalogen legger dem i samme familie fordi de deler merke og plattform, men
 * de har egne karosserier og dermed eget glass: Golf Sportsvan er ikke en Golf,
 * Transit Connect er ikke en Transit, CLA Shooting Brake er ikke CLA-coupéen.
 * Raden forkastes bare når kjøretøyets eget modellnavn ikke inneholder navnet.
 */
export const NÆRMODELL: Record<string, readonly string[]> = {
  GOLF: ['SPORTVAN', 'PLUS', 'CROSS'],
  CLA: ['SHOOTING'],
  TRANSIT: ['CONNECT', 'COURIER'],
};

/**
 * Er dette en annen modell enn kjøretøyet? Symmetrisk: en Golf skal ikke få
 * Sportsvan-glass, og en Sportsvan skal ikke få Golf-glass. er lik en
 * navnemodell, må raden være samme navnemodell.
 */
function erAnnenModell(varenavn: string, familie: string, modellOrd: Set<string>): boolean {
  const konflikt = NÆRMODELL[familie];
  if (!konflikt) return false;
  const ord = new Set(String(varenavn).toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter(Boolean));
  const bilens = konflikt.filter((token) => modellOrd.has(token));
  if (bilens.length) return !bilens.some((token) => ord.has(token));
  return konflikt.some((token) => ord.has(token));
}

/** Klasse → hvilke plasseringstyper som er gyldige svar på ønsket. */
const KLASSE_TYPER: Record<string, GlassType[]> = {
  frontrute: ['frontrute'],
  bakrute: ['bakrute'],
  // «Dørrute»: sidefamilie = sideglass der katalogen ikke oppgir om det er dør,
  // ventil eller kvartal. Raden er en mulig dørrute, og vises merket «type må
  // avklares» — alternativet er en tom liste, som er en blindvei for kunden.
  dor: ['dor', 'sidefamilie'],
  // «Siderute» er kundens ord for alt sideglass (sidefelt og småruter).
  side: ['side', 'sidefamilie'],
  ventil: ['ventil'],
  tak: ['tak'],
};

function normaliserKlasse(klasse: string | null | undefined): string | null {
  if (!klasse) return null;
  const k = String(klasse).trim().toLowerCase();
  const map: Record<string, string> = {
    front: 'frontrute', windshield: 'frontrute', frontrute: 'frontrute',
    rear: 'bakrute', back: 'bakrute', bakrute: 'bakrute',
    door: 'dor', dor: 'dor', dør: 'dor',
    side: 'side', siderute: 'side',
    ventil: 'ventil', quarter: 'ventil', trekant: 'ventil',
    roof: 'tak', tak: 'tak',
  };
  return map[k] ?? null;
}

/**
 * Plasseringsfilter.
 *
 * Regelen «filtrering fjerner aldri en kandidat vi ikke kan motbevise» gjelder
 * bare ledd (fremre/bakre): en kandidat uten dokumentert ledd beholdes, fordi
 * den kan være riktig. TYPE derimot må være dokumentert — en rad vi ikke kan
 * klassifisere er ikke et svar på «dørrute».
 */
function posisjonsfilter(
  hits: CatalogueCandidate[],
  klasse: string,
  dorLedd: string | null,
  ventilLedd: string | null,
): CatalogueCandidate[] {
  const typer = KLASSE_TYPER[klasse];
  if (!typer) return hits;
  let ut = hits.filter((c) => typer.includes(c.posisjon.type) && !c.posisjon.konflikt);
  if (!ut.length) return ut;

  if (klasse === 'dor' && (dorLedd === 'fremre' || dorLedd === 'bakre')) {
    const snevrere = ut.filter((c) => c.posisjon.dorLedd === null || c.posisjon.dorLedd === dorLedd);
    if (snevrere.length) ut = snevrere;
  }
  if (klasse === 'ventil' && (ventilLedd === 'foran' || ventilLedd === 'bakre')) {
    const snevrere = ut.filter((c) => c.posisjon.ventilLedd === null || c.posisjon.ventilLedd === ventilLedd);
    if (snevrere.length) ut = snevrere;
  }
  return ut;
}

interface EffektivIntervall {
  fra: number | null;
  til: number | null;
  vindu: Generasjonsvindu | null;
}

/** Vinduet som starter nærmest (men ikke etter) et gitt år. */
function vinduForStart(vinduer: Generasjonsvindu[], aar: number): Generasjonsvindu | null {
  let valgt: Generasjonsvindu | null = null;
  for (const v of vinduer) {
    if (v.fra <= aar && (!valgt || v.fra > valgt.fra)) valgt = v;
  }
  return valgt;
}

function vinduerForAar(vinduer: Generasjonsvindu[], aar: number): Generasjonsvindu[] {
  return vinduer.filter((v) => aar >= v.fra && (v.til == null || aar <= v.til));
}

/**
 * Klemmer radens intervall inn til generasjonsvinduet.
 *
 * Poenget er å gi åpne intervaller en dokumentert øvre grense: en rad merket
 * «91-» tilhører T4-generasjonen (1990–2003) og skal ikke foreslås for en
 * 2005-bil. Uten kjent vindu brukes `APENT_INTERVALL_SPENN`.
 */
function effektivtIntervall(c: CatalogueCandidate): EffektivIntervall {
  const vinduer = GENERASJONER[c.familie] ?? [];
  let vindu: Generasjonsvindu | null = null;
  if (c.generasjon) {
    vindu = vinduer.find((v) => v.token === c.generasjon) ?? null;
  } else if (c.aarFra != null) {
    vindu = vinduForStart(vinduer, c.aarFra);
  }

  let fra = c.aarFra;
  let til = c.aarTil;
  if (vindu) {
    if (fra != null) fra = Math.max(fra, vindu.fra);
    const ovre = vindu.til == null ? Infinity : vindu.til;
    til = til == null ? (Number.isFinite(ovre) ? ovre : null) : Math.min(til, ovre);
  } else if (til == null && fra != null) {
    til = fra + APENT_INTERVALL_SPENN;
  }
  return { fra, til, vindu };
}

/** Er raden en tilbehørs-/listesrad som aldri skal presenteres som glass? */
function erTilbehor(c: CatalogueCandidate): boolean {
  return erListeRad(c.varenavn, c.varenr) || /PYNTELIST|GUMMILIST|KLIPS|PAKNING/.test(c.varenavn);
}

/** Kundevendt plasseringstekst. Intern klassifisering skal aldri vises. */
export function posisjonsTekst(c: CatalogueCandidate): string {
  const p = c.posisjon;
  const side = p.side === 'venstre' ? ' venstre' : p.side === 'hoyre' ? ' høyre' : p.side === 'begge' ? ' begge sider' : '';
  if (p.type === 'frontrute') return 'Frontrute';
  if (p.type === 'bakrute') return `Bakrute${side}`;
  if (p.type === 'dor') return `Dørrute${p.dorLedd ? ' ' + p.dorLedd : ''}${side}`;
  if (p.type === 'ventil') return `Ventilrute${p.ventilLedd ? ' ' + p.ventilLedd : ''}${side}`;
  if (p.type === 'side') return `Siderute${side}`;
  if (p.type === 'tak') return 'Takglass';
  if (p.type === 'sidefamilie') return `Sideglass${side} (type må avklares)`;
  return 'Plassering må avklares';
}

/**
 * Finner CLASS_D-kandidater for en bil (make, model, year). Aldri fasit.
 *
 * @param onske — kundens posisjonsvalg. Ukjent/ugyldig klasse filtrerer ikke.
 */
export function matchClassDCandidates(
  index: CatalogueCandidate[],
  make: string,
  model: string,
  year: number | null,
  onske?: ClassDOenske,
): CatalogueCandidate[] {
  const mk = normMerke(make);
  const mo = String(model ?? '').toUpperCase();
  const fam = FAMILIER.find((f) => f.merke === mk && f.re.test(mo));
  if (!fam) return [];

  const modellOrd = new Set([mk, ...mo.split(/[^A-ZÆØÅ0-9]+/)].filter(Boolean));
  let hits = index.filter(
    (c) => c.merke === fam.merke
      && c.familie === fam.familie
      && !erTilbehor(c)
      && !erAnnenModell(c.varenavn, fam.familie, modellOrd),
  );

  const klasse = normaliserKlasse(onske?.glassklasse ?? null);
  if (klasse) {
    const posisjonsfiltrert = posisjonsfilter(hits, klasse, onske?.dorLedd ?? null, onske?.ventilLedd ?? null);
    hits = posisjonsfiltrert;
  }

  if (year != null) {
    const vinduer = GENERASJONER[fam.familie] ?? [];
    const bilensVinduer = vinduerForAar(vinduer, year);
    hits = hits.filter((c) => {
      const { fra, til, vindu } = effektivtIntervall(c);
      // Rad uten produksjonsintervall er ikke kandidat for en årspesifikk bil.
      if (fra == null) return false;
      if (year < fra) return false;
      if (til != null && year > til) return false;
      // Kryss-generasjon: begge kjent og bilens år ligger i en annen generasjon.
      // En T4-rute er ikke riktig for en T5-bil selv om intervallene møtes i 2003.
      if (vindu && bilensVinduer.length && !bilensVinduer.some((v) => v.token === vindu.token)) return false;
      return true;
    });
  }

  // ── Side ────────────────────────────────────────────────────────────────
  // Kunden har oppgitt venstre eller høyre: da skal ikke motsatt sides glass
  // foreslås. Bare beviselig feil side fjernes; rader uten dokumentert side
  // beholdes, og hvis filtreringen tømmer listen beholdes alt (en tom liste
  // er verre enn en merket usikker kandidat).
  const side = onske?.produktSide ?? null;
  if (side) {
    const riktigSide = hits.filter((c) => c.posisjon.side === null || c.posisjon.side === 'begge' || c.posisjon.side === side);
    if (riktigSide.length) hits = riktigSide;
  }

  // ── Relevans og duplikater ──────────────────────────────────────────────
  // Katalogen har flere rader per varenr (ulik tekst, samme produkt) og rader
  // for nærliggende modeller («TRANSIT CONNECT» for en TRANSIT). Uten dette
  // får kunden samme produkt to ganger, eller en Sportsvan-rute til en Golf.
  const bilOrd = new Set([mk, ...mo.split(/[^A-ZÆØÅ0-9]+/)].filter(Boolean));
  const vekt = (c: CatalogueCandidate) => {
    const ukjentPosisjon = c.posisjon.type === 'ukjent' ? 1 : 0;
    const ekstraModellord = ekstraModellordI(c.varenavn, bilOrd);
    return ukjentPosisjon * 100 + ekstraModellord * 10;
  };
  const sortert = hits
    .map((c, i) => ({ c, i }))
    .sort((a, b) => vekt(a.c) - vekt(b.c) || (b.c.aarFra ?? 0) - (a.c.aarFra ?? 0) || a.i - b.i)
    .map((x) => x.c);

  // Dedupe på varenr: samme produkt skal stå én gang. Første forekomst etter
  // sortering er den mest relevante raden.
  const sett = new Set<string>();
  const unike: CatalogueCandidate[] = [];
  for (const c of sortert) {
    const nokkel = c.varenr.toUpperCase();
    if (sett.has(nokkel)) continue;
    sett.add(nokkel);
    unike.push(c);
  }
  return unike;
}

/**
 * Ord som beskriver karosseri/posisjon og derfor ikke sier «dette er en annen
 * bil». Alt annet i varenavnet som ikke står i bilens eget modellnavn, regnes
 * som et ekstra modellord — jo flere, jo lenger ned i listen.
 */
const GENERISKE_ORD = new Set([
  'D', 'DOOR', 'DOORS', 'DOORGLASS', 'CC', 'STV', 'STVOGN', 'ST', 'VOGN', 'STASJONSWAGON', 'STATION', 'WAGON',
  'SED', 'SEDAN', 'HBK', 'HATCH', 'HATCHBACK', 'CPE', 'COUPE', 'CAB', 'CABRIOLET', 'KOMBI', 'MPV', 'SUV',
  'CROSSOVER', 'ESTATE', 'AVANT', 'TOURING', 'SPORTBACK', 'VAN', 'MINIBUSS', 'BUSS', 'TRUCK',
  'PICK', 'UP', 'PICKUP', 'KASSE', 'DOBBEL', 'LOW', 'MED', 'MEDIUM', 'HIGH', 'ALLE',
  '2D', '3D', '4D', '5D', '2-DOOR', '3-DOOR', '4-DOOR', '5-DOOR',
  'FRONT', 'FRONTRUTE', 'FRONTRUTA', 'BAKRUTE', 'BAKRUTA', 'DØRRUTE', 'DORRUTE', 'DÖRRUTE',
  'SIDERUTE', 'SIDERUTER', 'SIDORUTE', 'VENTILRUTE', 'TAKGLASS', 'TAKRUTE', 'SKYVEDØR', 'SKYVEDOR',
  'VS', 'HS', 'V', 'H', 'OG', 'AND',
]);

function ekstraModellordI(varenavn: string, bilOrd: Set<string>): number {
  const ord = String(varenavn).toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter(Boolean);
  let antall = 0;
  const sett = new Set<string>();
  for (const o of ord) {
    if (GENERISKE_ORD.has(o)) continue;
    if (bilOrd.has(o)) continue;
    if (/^\d{2,4}$/.test(o)) continue; // årstall
    if (sett.has(o)) continue;         // samme ord to ganger teller én gang
    sett.add(o);
    antall++;
  }
  return antall;
}
