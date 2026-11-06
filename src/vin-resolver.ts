import { glassBodyRejection, isBodyIdentityWord } from './glass-body-compatibility';
/**
 * OE/VIN-pinpoint-resolver (finnbilglass, Fase 2).
 *
 * Tre eksplisitte utfall:
 *   PINPOINT — nøyaktig ETT salgbart glass for kjøretøyet.
 *   VERIFY   — 2+ kandidater (utstyrsvarianter) — kunden må verifisere.
 *   FALLBACK — ingen resolver-data — eksisterende tekstmatcher overtar.
 *
 * Doktrine (Tom 2026-08-13): ALDRI tving tvetydige biler til PINPOINT.
 * False positive er verre enn fallback.
 *
 * Lag (i rekkefølge, alle leser fra lokale tabeller — alternativ A):
 *   L1 ground_truth  — verifiserte kjøretøy → frontrute (auto-glass.no, 92 % i prisliste)
 *   L2 glass_catalog — Pilkington brand/modell/år + utstyrsflagg (Pilkington-dump)
 *   L3 ktype         — ktype_registry → glass_catalog.ktype (aktiv når B2B-live-data finnes)
 *   L4 FALLBACK      — matchFrontrute (eksisterende, uendret)
 */
import type { BilInput } from './matcher';
import { estimertFrontruteKundeprisInklMva, estimertKundeprisInklMva } from './pricing/nok-prising';
import { matcherAar, parseAar } from './aar-parser';
import { fraTypekode, klassifiserGlass, filtrerPaPosisjon, type TypekodePosisjon, type Posisjonsonske } from './glass-posisjon';
export { fraTypekode, klassifiserGlass, filtrerPaPosisjon, type TypekodePosisjon, type Posisjonsonske } from './glass-posisjon';
import { serieKey, normaliserKatalogModell } from './serie-mapping';
import { dekodeEurokode, type Dekodet } from './eurokode-dekoder';
import { karanteneGrunn, prisKaranteneGrunn } from './glass-karantene';

export type ResolverUtfall = 'PINPOINT' | 'VERIFY' | 'FALLBACK';

/** Hvilke glasstyper resolveren skal se etter. */
export type Sokemodus = 'FRONTRUTE_ONLY' | 'ALL_GLASS_CANDIDATES';

/** Posisjonsfelter som følger kandidaten i ALL_GLASS_CANDIDATES-modus. */
export interface KandidatPosisjon {
  typekode: string | null;
  glassklasse: string | null;
  sideKilde: 'forer' | 'passasjer' | null;
  /** Produktets fysiske side — katalogegenskap, ikke bilens. */
  produktFysiskSide: 'venstre' | 'hoyre' | 'begge' | null;
  sideGrunnlag: string;
  sideBekreftet: boolean;
  dorLedd: string | null;
  ventilLedd: string | null;
  sideruteNummer: number | null;
  deltBakrute: boolean;
  /** Sann når typekoden motsier navn/eurokode. Skal aldri bli EXACT. */
  konflikt: boolean;
}

export interface ResolverKandidat {
  varenr: string;
  varenavn: string | null;
  pris: number | null;      // sluttpris (tier), samme regel som matcher
  listepris: number | null;
  eurokode: string | null;
  /** Stabil identitet for PRODUKTVARIANTEN (varenr + full eurokode).
   *  Varenr alene er ikke unikt i prislisten — se variantNokkel(). */
  variantId?: string;
  /** Bare satt i ALL_GLASS_CANDIDATES-modus. */
  posisjon?: KandidatPosisjon;
  attributter: {
    sensor: boolean | null;
    antenne: boolean | null;
    hud: boolean | null;
    kamera: boolean | null;
    adas: boolean | null;
    coated: boolean | null;
    /** Varmetråder/varmefilm (eurokode H). ALDRI det samme som HUD. */
    oppvarmet?: boolean | null;
  };
}

export interface ResolverResultat {
  utfall: ResolverUtfall;
  /** Antall kandidater FUNNET, før visningsgrensen på 6. */
  totalAntall?: number;
  grunn: string;            // sporbarhet: lag + kontekst
  confidence: number;
  varenr?: string;
  varenavn?: string | null;
  pris?: number | null;     // sluttpris (tier)
  listepris?: number | null;
  eurokode?: string | null;
  /** Valgt produktvariant (varenr + full eurokode) — følger kandidaten gjennom
   *  API-svar, kundens valg og /ops, slik at «samme variant» kan spores. */
  variantId?: string | null;
  kandidater?: ResolverKandidat[];
  /** Spørsmål som FAKTISK skiller kandidatene (VERIFY) — tom liste = ingen spørsmål nødvendig. */
  sporsmaal?: string[];
}

interface Env { FINNBILGLASS_DB: D1Database }

/** Merke-aliaser (SVV/B2C-navn ↔ B2B-katalognavn). */
const BRAND_ALIAS: Record<string, string> = {
  VOLKSWAGEN: 'VW',
  'VW TRUCKS': 'VW',
  'MERCEDES-BENZ': 'MERCEDES',
  'MERCEDES BENZ': 'MERCEDES',
  'MERCEDES TRUCKS': 'MERCEDES',
  'OPEL VAUXHALL': 'OPEL',
  'FIAT TRUCKS': 'FIAT',
  'FORD TRUCKS': 'FORD',
  'IVECO TRUCKS': 'IVECO',
  'RENAULT TRUCKS': 'RENAULT',
  'PEUGEOT TRUCKS': 'PEUGEOT',
  'CITROEN TRUCKS': 'CITROEN',
  'NISSAN COMMERCIAL': 'NISSAN',
  'TOYOTA COMMERCIAL': 'TOYOTA',
  'SCANIA TRUCKS': 'SCANIA',
  'MAN TRUCKS': 'MAN',
  'VOLVO TRUCKS': 'VOLVO',
  'DAF TRUCKS': 'DAF',
  'MG MOTOR': 'MG',
};

const MODEL_TOKEN_ALIAS: Record<string, string[]> = {
  CARAVELLE: ['CARAV'],
  TRANSPORTER: ['TRANSP'],
  MULTIVAN: ['MULTI'],
};

export function normBrand(merke: string): string {
  const m = (merke || '').trim().toUpperCase();
  return BRAND_ALIAS[m] ?? m;
}

/** Tokens som ikke skiller glass-varianter (drivverk, utstyrsmarkører, generiske ord). */
const STOPP_TOKENS = new Set([
  'CLASS', 'SERIE', 'SERIES', 'LHD', 'RHD', 'AUTOMATIKK', 'AUTOMATIC', 'KOMBI', 'LIMITED',
  'SPORT', 'STYLE', 'TURBO', 'TDI', 'CDI', 'TFSI', 'TSI', 'TFSIE', '4MATIC', 'XDRIVE',
  'SDRIVE', 'BLUETEC', 'DIESEL', 'GTD', 'GTE', 'GTI', 'AMG', 'ACTIVE', 'DYNAMIC', 'TREND',
  'COUPE', 'COUPÉ', 'SUV', 'SEDAN', 'CABRIOLET', 'HATCHBACK', 'CROSSOVER', 'STV',
  'COMFORT', 'LIFE', 'PASSION', 'BASIC', 'EXECUTIVE', 'R-LINE', 'S-LINE', 'PREMIUM', 'BENZ',
]);

/**
 * Modellfamilier der skilletegn + ett siffer er meningsbærende: «ID.4» → ID4,
 * «MODEL 3» → MODEL3, «RAV 4» → RAV4.
 *
 * Bakgrunn (målt 2026-11-04): `modellTokensAv` forkaster tokens kortere enn to
 * tegn, så «ID.4» ble til `['ID']`. Siden `ordTreff` godtar ETT treffende token,
 * matchet «ID» hele VW ID-familien — en ID.3-frontrute (8652AGAC) ble tilbudt
 * som kandidat for ID.4 og ID.5. Familie-tokenet bevarer sifferet.
 *
 * Vakt mot motorkode: «TRANSIT 2.0» gir ikke familie-token (delsvolum, ikke modell).
 */
const FAMILIE_MONSTER = /([A-ZÆØÅ]{2,6})[.\s-]+(\d{1,2})(?![0-9])(?![.,]\d)/g;
/**
 * Samme for generiske familieord med bokstav-suffiks: «MODEL Y» → MODELY.
 * Bare for ID/MODEL — ellers ville «GOLF TDI» gitt GOLFTDI og lignende støy.
 */
const GENERISK_FAMILIE_MONSTER = /(ID|MODEL)[.\s-]+([A-ZÆØÅ])(?![A-ZÆØÅ0-9])/g;

export function familieTokens(s: string): string[] {
  const t = (s || '').toUpperCase();
  const ut: string[] = [];
  for (const m of t.matchAll(FAMILIE_MONSTER)) ut.push(m[1] + m[2]);
  for (const m of t.matchAll(GENERISK_FAMILIE_MONSTER)) ut.push(m[1] + m[2]);
  return ut;
}

/** Generiske familieord som aldri alene kan gi kandidatstøtte. */
const GENERISKE_TOKEN = new Set(['ID', 'MODEL', 'COUPE', 'COUPÉ', 'SUV', 'SEDAN', 'CABRIOLET', 'HATCHBACK', 'KOMBI', 'CROSSOVER', 'STV']);

/**
 * Modellnavn der butikkatalog og leverandørkatalog bruker ulike navn på samme bil.
 *
 * Målt 2026-11-04 mot www.auto-glass.no: butikken fører «TOYOTA PRIUS PLUS 7 + 5D
 * CC 12- FR…», mens Pilkington-katalogen (glass_catalog, pilkington-irl) kaller
 * samme bil «GRAND PRIUS LHD 04/2012 · 2012-2022». Uten synonymet faller en
 * PRIUS PLUS-kunde til manuell kontroll selv om varen finnes.
 *
 * Synonymet er smalt med vilje: det gjelder bare Prius+ / Prius Seven, aldri
 * «PRIUS» alene (en vanlig Prius skal ikke få Grand Prius-ruten).
 */
const MODELL_SYNONYM: Array<[RegExp, string]> = [
  [/\bPRIUS\s*(?:\+SEVEN|PLUS|SEVEN|\+)(?![A-Z0-9])/g, 'GRAND PRIUS'],
];

export function modellSynonym(s: string): string {
  let t = String(s ?? '').toUpperCase();
  for (const [re, til] of MODELL_SYNONYM) t = t.replace(re, til);
  return t;
}

/**
 * Rå ord-tokens fra modellstrengen (≥2 tegn, ikke merkenavn, ikke stopp-ord).
 * Brukes BÅDE til SQL-forfiltrering (LIKE) og som grunnlag for match-tokens.
 *
 * SQL-forfiltreringen må bruke de RÅ ordene: familie-tokenet «ID4» finnes ikke
 * som tekst i katalograder som skriver «ID.4 SUV», så et LIKE på ID4 ga null
 * rader (målt 2026-11-04: ID.4/ID.5 falt til FALLBACK etter familie-tokenet).
 */
function modellOrd(modell: string, merke: string): string[] {
  const merkeNorm = normBrand(merke).replace(/[^A-ZÆØÅ0-9]+/g, '');
  const ord = (modell || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const ut: string[] = [];
  for (const o of ord) {
    if (o.length < 2) continue;
    if (o === merkeNorm) continue;
    if (/^\d+$/.test(o) && o.length >= 3 && ord.length > 1) continue; // '200'-lignende trim/motor
    if (/^\d+(KW|KWH)$/.test(o)) continue; // effekt/batteri er ikke glassmodell
    if (STOPP_TOKENS.has(o) || isBodyIdentityWord(o)) continue;
    ut.push(o);
    ut.push(...(MODEL_TOKEN_ALIAS[o] ?? []));
  }
  return [...new Set(ut)];
}

/** Tokens for SQL-forfiltrering — rå ord, inkludert generiske («ID»). */
export function sqlTokensAv(modell: string, merke: string): string[] {
  return modellOrd(modell, merke);
}

/** Signifikante modell-tokens for MATCHING: familie-token først, generisk forstavelse fjernet. */
export function modellTokensAv(modell: string, merke: string): string[] {
  // Familie-tokenet settes først: det er det mest spesifikke, og L2 bruker .slice(0,4).
  const familier = familieTokens(modell);
  const rest = modellOrd(modell, merke).filter(
    // Generisk forstavelse («ID» av «ID.4», «MODEL» av «MODEL 3») skal ikke bli
    // et selvstendig token når familie-tokenet finnes — det er nettopp den
    // brede matchingen som ga ID.3-glass til ID.4/ID.5.
    (o) => !(GENERISKE_TOKEN.has(o) && familier.some((f) => f.startsWith(o))),
  );
  return [...new Set([...familier, ...rest])];
}

function escLike(s: string): string {
  return s.replace(/[%_]/g, '\\$&');
}

/** Ord-tokens (≥2 tegn) for ordbasert matching — aldri substring (unngår «CLA» ⊂ «CLASS»). */
function ordTokensAv(s: string): Set<string> {
  return new Set([
    ...familieTokens(s),
    ...(s || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/)
      .filter((t) => t.length >= 2),
  ]);
}

/**
 * Kandidat-matching for L2: som ordTreff, men et generisk treff («ID», «MODEL»)
 * gir aldri støtte alene. En katalograd må deles med et meningsbærende token —
 * modellfamilie (ID4), modellnavn eller seriekode.
 */
export function ordTreffKandidat(model: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const sett = ordTokensAv(model);
  for (const t of tokens) {
    const eksakt = sett.has(t);
    // Prefiks-treff (≥4 tegn) er en grov snarvei: den skal aldri gå via et
    // generisk ord, ellers ville «MODEL3» matchet katalograder som bare heter
    // «MODEL Y» (nøyaktig den lekkasjen testen under fanger).
    const prefiks = !eksakt && t.length >= 4 && [...sett].some(
      (o) => o.length >= 4 && !GENERISKE_TOKEN.has(o) && (o.startsWith(t) || t.startsWith(o)),
    );
    if ((eksakt || prefiks) && !GENERISKE_TOKEN.has(t)) return true;
  }
  return false;
}
export function ordTreff(model: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const sett = ordTokensAv(model);
  return tokens.some((t) => {
    if (sett.has(t)) return true;
    if (t.length < 4) return false;
    for (const ord of sett) {
      if (ord.length >= 4 && (ord.startsWith(t) || t.startsWith(ord))) return true;
    }
    return false;
  });
}

function modellAarIntervall(model: string | null): { start: number; slutt: number } | null {
  const intervall = parseAar(model);
  if (intervall) return intervall;
  const m = (model ?? '').match(/\b(19|20)\d{2}\b/);
  return m ? { start: parseInt(m[0], 10), slutt: Infinity } : null;
}

/** Ikke-frontrute-keywords (samme liste som scripts/gt-generator.mjs sin erFrontrute,
 *  pluss svenske varianter og pakning — sett i faktiske katalogdata).
 *  Ordgrense-lookaround forhindrer substring-falske positiver:
 *  «VENT» må IKKE treffe «VENTURE»/«VENTO», «HATCH» må IKKE treffe «HATCHBACK». */
const IKKE_FRONTRUTE = ['DØRRUTE', 'DORRUTE', 'SIDERUTE', 'SIDORUTE', 'SIDORUTA', 'SIDERUTA', 'BAKRUTE', 'BAGRUTE',
  'BACKLITE', 'SUNROOF', 'SOLTAK', 'HATCH', 'TAKLUKE', 'TAKRUTE', 'PANORAMA', 'REAR', 'QUARTER', 'VENT',
  'PYNTELIST', 'GUMMILIST', 'KLIPS', 'PAKNING',
  // Engelske/tyske markører som betyr dør/side/bak — «FRONT» i navnet kan være
  // «front door», ikke frontrute («BYD T3 FRONT DOORGLASS», «HONGQI HS9 FRONT DOOR»).
  'DOOR', 'DOORGLASS', 'TUER', 'TÜR', 'HECK'];
const IKKE_FRONTRUTE_RE = new RegExp(`(?<![A-ZÆØÅ0-9])(${IKKE_FRONTRUTE.join('|')})(?![A-ZÆØÅ0-9])`);

/** Er raden en FRONTRUTE-kandidat? Samme doktrine som gt-generator.mjs: avvis KUN klare
 *  ikke-frontrute-signaler (bak/side/dør/ventil-posisjon, takglass/keywords, side-glass-varenr
 *  L/R etter 3–5-sifret prefiks). 2-sifrede veteran-koder og OEM-delnummer uten side/bak-markør
 *  faller gjennom som frontrute-kandidater (aldri false-negative — Tom-doktrine). */
export function erFrontrute(varenavn: string | null, varenr: string, dek: Dekodet): boolean {
  const n = (varenavn ?? '').toUpperCase();
  if (IKKE_FRONTRUTE_RE.test(n)) return false;
  // PY*-suffiks = PYNTELIST, GU*-suffiks = GUMMILIST (dekorlist rundt glasset
  // som skjuler limfugen), IKKE glass — samme guard som gt-generator.mjs
  // (Tom 2026-08-17). «1979PY» 625 kr er en list, ikke frontrute (riktig:
  // 1979C 5 320 kr). YP/YPC/YPS/YPL er EKTE glass med list-attributt — behold.
  if (/(?:PY|GU)[A-Z]{0,4}$/.test(varenr.toUpperCase())) return false;
  // K-suffiks (rent siffer-prefiks + K) = KLIPS-KIT per bilmodell (popnagler/
  // spiletap), IKKE glass — «MERCEDES 190 KLIPS KIT» 1400K (Tom 2026-08-17).
  if (/^\d{3,5}K$/.test(varenr.toUpperCase())) return false;
  if (/^\d{3,5}[LR]/.test(varenr)) return false; // side-glass-varenr (8103LGAR5, 26270LFWXBYN)
  if (dek.posisjon && dek.posisjon !== 'frontrute') return false; // bak/side/dør/ventil
  return true; // frontrute-posisjon ELLER ukjent (veteran/OEM) → kandidat
}

/** Prisliste-oppslag på varenr ELLER eurokode (rad_type='glass'), frontrute-gated.
 *  Attributter: eurokode-dekoder er autoritativ for A/M/C/H (Tom 2026-08-13);
 *  glass_catalog brukes KUN for kamera/adas (ikke kodet i eurokoden). Ikke-frontrute
 *  (bak/side/dør/takglass) og OEM-delnummer uten FRONTR-markør returnerer null. */

/**
 * Variantnøkkel: varenr + full eurokode. Varenummeret alene er IKKE unikt —
 * Autoglass-prislisten fører flere frontruter på samme varenr med ulik eurokode
 * og ulikt utstyr (målt 2026-11-04: 1 925 varenr har flere eurokoder, 1 061 av
 * dem med IDENTISK varenavn). Uten eurokoden i nøkkelen kollapser variantene.
 *
 * Rader uten eurokode (pyntelister, klips, alias) får varenr + navn.
 */
export function variantNokkel(varenr: string | null | undefined, eurokode: string | null | undefined, varenavn?: string | null): string {
  const v = String(varenr ?? '').trim().toUpperCase();
  const e = String(eurokode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (e) return `${v}:${e}`;
  return `${v}:~${String(varenavn ?? '').trim().toUpperCase()}`;
}

/**
 * Alle prisrader som dekker bilens år — BARE den mest spesifikke gruppen.
 *
 * Retter to målte feil i den tidligere `velgPrisRadEtterAar`:
 *  1. Åpent intervall ble aldri sorterbart: parseAar gir `Infinity` for «2019-»,
 *     og `Infinity - Infinity` er NaN — sammenligningen ble en no-op, så en
 *     2024-bil fikk den FØRSTE raden (22 825 kr) i stedet for 22-varianten.
 *  2. ±1 års slakke på år-hintet fra varenavnet gjorde at et LUKKET intervall
 *     slo et åpent: en 2022-bil fikk «19-21»-ruten (slakke 2021+1 = 2022)
 *     fordi det lukkede intervallet er «mer spesifikt». Slakke hører til
 *     kolonnedata (L2), ikke til et år som står eksplisitt i varenavnet.
 *
 * Rangering blant radene som dekker året:
 *   lukket intervall (eksplisitt slutten år) foran åpent («2019-»),
 *   kortest spenn blant lukkede, senest start blant åpne.
 * Bare rader med BESTE rang returneres: for en 2024-RAV4 er «22-»-variantene
 * (tre stk, ulikt utstyr) svaret — ikke de bredere «2019-»-radene, som er en
 * svakere påstand om året. Flere rader med lik rang = ekte utstyrsvarianter og
 * skal gi VERIFY, ikke et gjett.
 *
 * Ingen rad dekker året:
 *   - rader UTEN årang (f.eks. «MERCEDES SPRINTER (LAV TYPE)») beholdes — de
 *     motsier ikke bilens år;
 *   - rader hvis dokumenterte årang UTELUKKER bilens år forkastes. En «23-»-rute
 *     skal ikke tilbys til en 2018-bil bare fordi GT peker på samme varenr.
 *   - finnes ingen av delene, returneres tom liste (ærlig tom fremfor feil glass).
 */
export function prisRaderEtterAar<T extends { varenavn: string | null }>(rader: T[], aar: number | null): T[] {
  if (!rader.length) return [];
  if (aar == null) return rader;
  const medAar = rader.map((r) => {
    const i = parseAar(r.varenavn);
    const slutt = i && Number.isFinite(i.slutt) ? (i.slutt as number) : null;
    return { r, start: i?.start ?? null, slutt };
  });
  const treff = medAar.filter((x) => x.start != null && aar >= x.start && (x.slutt == null || aar <= x.slutt));
  if (!treff.length) {
    // Ingen dokumentert rad dekker året. Behold bare rader uten årang.
    return medAar.filter((x) => x.start == null).map((x) => x.r);
  }
  // [0] = type (lukket først), [1] = spesifisitet (kort spenn / senest start).
  const rang = (x: { start: number | null; slutt: number | null }): [number, number] =>
    x.slutt != null ? [0, x.slutt - (x.start ?? x.slutt)] : [1, -(x.start ?? 0)];
  const rangert = treff.map((x) => ({ x, n: rang(x) }));
  rangert.sort((a, b) => a.n[0] - b.n[0] || a.n[1] - b.n[1]);
  const beste = rangert[0].n;
  return rangert.filter((y) => y.n[0] === beste[0] && y.n[1] === beste[1]).map((y) => y.x.r);
}

/** Bakoverkompatibel enkeltvalg: den beste raden for året. */
export function velgPrisRadEtterAar<T extends { varenavn: string | null }>(rader: T[], aar: number | null): T | null {
  return prisRaderEtterAar(rader, aar)[0] ?? null;
}

interface PrisRad {
  varenr: string;
  varenavn: string | null;
  pris: number | null;
  eurokode: string | null;
  kommentar: string | null;
}

/** Bygger én kandidat fra én prisrad. Returnerer null når raden ikke er salgbar
 *  som frontrute (produkt-/priskarantene eller feil glassposisjon). */
export async function byggKandidat(env: Env, r: PrisRad, modus: Sokemodus): Promise<ResolverKandidat | null> {
  // Produkt-karantene: rader merket som glass som egentlig er panel/list
  // (f.eks. TORPEDOVEGG). Se src/glass-karantene.ts.
  if (karanteneGrunn(r.kommentar, r.varenavn)) return null;
  // Pris-karantene: ekte glass, men listeprisen gjelder et kit/antall.
  // Produktet beholdes; prisen skjules (listepris = null → ingen kundepris).
  const prisKarantene = prisKaranteneGrunn(r.kommentar) != null;
  if (prisKarantene) console.warn(`pris-karantene: ${r.varenr} — ${r.kommentar}`);

  const dek = dekodeEurokode(r.eurokode);

  // Posisjon fra typekode-registeret. Mangler tabellen (eldre database),
  // er posisjonen ukjent — ikke «frontrute».
  const tp = await hentTypekode(env, r.varenr);
  const klassifisert = klassifiserGlass(r.varenavn, r.varenr, r.eurokode, tp?.kode ?? null);

  if (modus === 'FRONTRUTE_ONLY' && !klassifisert.erFrontrute) return null; // bak/side/dør/takglass
  if (modus === 'ALL_GLASS_CANDIDATES' && klassifisert.type === 'ukjent') return null; // ikke plasserbart

  const attributter: ResolverKandidat['attributter'] = { sensor: null, antenne: null, hud: null, kamera: null, adas: null, coated: null, oppvarmet: null };

  // Attributter: eurokode-dekoder er autoritativ for A/M/C/H (Tom 2026-08-13),
  // men KUN når koden faktisk er en eurokode (gyldig posisjonsbokstav). OEM-delnummer
  // (f.eks. VW 7H0877051) har posisjon=null — da er A/M/C/H ukjent (null), ikke false.
  if (dek.posisjon) {
    const eg = dek.egenskaper;
    attributter.sensor  = eg.includes('sensor');
    attributter.antenne = eg.includes('antenne');
    attributter.coated  = eg.includes('coated');
    // H i eurokoden betyr varmetråder/varmefilm — det er OPPVARMET, ikke HUD.
    // HUD er et projeksjonsbilde fra dashbordet og kan ikke leses av glasset
    // (Tom, fagregel 17). Tidligere ble hud satt = oppvarmet, som ga kunden
    // «med head-up-display» på en bil som bare har varmetråder.
    attributter.oppvarmet = eg.includes('oppvarmet');
    attributter.hud = null;
  }

  // glass_catalog kun for kamera + adas (ikke kodet i eurokoden)
  if (r.eurokode) {
    const f = await env.FINNBILGLASS_DB.prepare(
      `SELECT camera, adas FROM glass_catalog WHERE eurocode = ? LIMIT 1`
    ).bind(r.eurokode).first<{ camera: number | null; adas: number | null }>();
    if (f) {
      attributter.kamera = f.camera == null ? null : f.camera === 1;
      attributter.adas   = f.adas   == null ? null : f.adas   === 1;
    }
  }

  return {
    varenr: r.varenr,
    varenavn: r.varenavn,
    pris: prisKarantene ? null : (klassifisert.erFrontrute
      ? estimertFrontruteKundeprisInklMva(r.pris)
      : estimertKundeprisInklMva(r.pris)),
    listepris: prisKarantene ? null : r.pris,
    eurokode: r.eurokode,
    variantId: variantNokkel(r.varenr, r.eurokode, r.varenavn),
    posisjon: modus === 'ALL_GLASS_CANDIDATES' ? {
      typekode: tp?.kode ?? null,
      glassklasse: klassifisert.type,
      sideKilde: tp?.side ?? null,
      produktFysiskSide: tp?.produktFysiskSide ?? null,
      sideGrunnlag: tp?.sideGrunnlag ?? 'UKJENT',
      sideBekreftet: tp?.sideBekreftet ?? false,
      dorLedd: klassifisert.dorLedd,
      ventilLedd: klassifisert.ventilLedd,
      sideruteNummer: tp?.sideruteNummer ?? null,
      deltBakrute: tp?.deltBakrute ?? false,
      konflikt: klassifisert.typekodeKonflikt,
    } : undefined,
    attributter,
  };
}

const PRIS_RAD_SQL = `SELECT varenr, varenavn, pris, eurokode, kommentar FROM glass_prisliste
     WHERE rad_type='glass' AND (varenr = ? OR eurokode = ?) LIMIT 20`;

/**
 * Alle salgbare varianter for et varenr/eurokode-oppslag, avgrenset til bilens år.
 * Rekkefølgen er «mest spesifikke årang først» (se prisRaderEtterAar).
 */
async function prisKandidater(env: Env, kode: string, modus: Sokemodus = 'FRONTRUTE_ONLY', aar: number | null = null): Promise<ResolverKandidat[]> {
  const treff = await env.FINNBILGLASS_DB.prepare(PRIS_RAD_SQL)
    .bind(kode, kode).all<PrisRad>();
  const rader = prisRaderEtterAar(treff.results ?? [], aar);
  const ut: ResolverKandidat[] = [];
  const sett = new Set<string>();
  for (const r of rader) {
    const k = await byggKandidat(env, r, modus);
    if (!k) continue;
    const nokkel = k.variantId ?? k.varenr;
    if (sett.has(nokkel)) continue; // samme variant to ganger (identisk eurokode)
    sett.add(nokkel);
    ut.push(k);
  }
  return ut;
}

/** Enkeltkandidat: den best år-dekkende varianten. Brukes der oppslaget er
 *  entydig (VIN-overstyring, katalog-eurokode, ktype). */
async function prisKandidat(env: Env, kode: string, modus: Sokemodus = 'FRONTRUTE_ONLY', aar: number | null = null): Promise<ResolverKandidat | null> {
  return (await prisKandidater(env, kode, modus, aar))[0] ?? null;
}

/**
 * Slår opp typekode for et varenummer.
 * Mangler tabellen (produksjon før migrering), er svaret null — ikke en gjetning.
 */
async function hentTypekode(env: Env, varenr: string): Promise<TypekodePosisjon | null> {
  try {
    const r = await env.FINNBILGLASS_DB.prepare(
      'SELECT typekode FROM glass_typekode WHERE varenr = UPPER(?) LIMIT 1',
    ).bind(varenr).first<{ typekode: string }>();
    return fraTypekode(r?.typekode ?? null);
  } catch {
    return null;
  }
}

/** Spørsmål som FAKTISK skiller kandidatene: felt der minst én kandidat har true OG minst én har false.
 *  Ukjente verdier (null) teller ikke — vi spør aldri om ting vi ikke kan skille på. */
export function skillendeSporsmaal(kandidater: ResolverKandidat[]): string[] {
  const felt: Array<keyof ResolverKandidat['attributter']> = ['sensor', 'antenne', 'hud', 'kamera', 'adas', 'coated', 'oppvarmet'];
  const ut: string[] = [];
  for (const f of felt) {
    const verdier = kandidater.map((k) => k.attributter[f]).filter((v): v is boolean => typeof v === 'boolean');
    if (verdier.some((v) => v) && verdier.some((v) => !v)) ut.push(f);
  }
  return ut;
}

function normVin(vin: string | null | undefined): string | null {
  const v = (vin ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 11 ? v : null;
}

/** VIN-posisjon 10 → FAKTISK modellår (fabrikkåret). SVV gir kun norsk registreringsdato —
 *  importbiler registrert år X kan være modellår X−n, og katalog-/GT-år er modellårsbasert.
 *  Standard VIN-årskoder: 1980–2000 = A–Y (uten I/O/Q/U/Z), 2001–2009 = 1–9, 2010+ = A–Y igjen.
 *  hintAar (registreringsåret) disambiguerer syklusene (A = 1980 eller 2010). */
export function vinModelYear(vin: string | null | undefined, hintAar: number | null | undefined): number | null {
  const v = (vin ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length < 11) return null;
  const c = v.charAt(9); // posisjon 10 (1-indeksert)
  // VIN-året kan bare brukes når det er rimelig nær registreringsåret. Uten denne
  // sperren flyttet en enkelt tegnfeil/ukjent koding bilen flere tiår: VIN
  // W1N1673171A365845 (GLE Coupé 2021) har «1» i posisjon 10, som tabellen leser
  // som 2001 — og da matchet resolveren en W203 Coupé fra 2001–02.
  const innenforRimeligAvstand = (kandidat: number) =>
    hintAar == null || Math.abs(kandidat - hintAar) <= 10;
  if (/^[1-9]$/.test(c)) {
    const aar = 2000 + parseInt(c, 10); // 2001–2009
    return innenforRimeligAvstand(aar) ? aar : (hintAar ?? null);
  }
  const BOKSTAV: Record<string, number> = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, J: 8, K: 9, L: 10, M: 11, N: 12,
    P: 13, R: 14, S: 15, T: 16, V: 17, W: 18, X: 19, Y: 20,
  };
  const offset = BOKSTAV[c];
  if (offset == null) return null;
  const aar80 = offset + 1980; // 1980–2000
  const aar10 = offset + 2010; // 2010–2030
  if (hintAar != null) {
    return Math.abs(hintAar - aar80) <= Math.abs(hintAar - aar10) ? aar80 : aar10;
  }
  // Uten hint: moderne bilpark dominerer — velg 2010+-syklusen hvis den er rimelig.
  return aar10 <= new Date().getUTCFullYear() + 2 ? aar10 : aar80;
}

/** L0 — eksakt VIN-fasit. Kun manuelt verifiserte overstyringer. */
async function lagVinOverride(env: Env, vin: string | null | undefined): Promise<ResolverKandidat[]> {
  const v = normVin(vin);
  if (!v) return [];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT eurocode FROM vin_glass_overrides
     WHERE vin = ?
     ORDER BY confidence DESC
     LIMIT 5`
  ).bind(v).all<{ eurocode: string }>();
  const unike = new Map<string, ResolverKandidat>();
  for (const r of rows.results ?? []) {
    // VIN-overstyring er manuell fasit — år brukes ikke til å velge søskenrad.
    const k = await prisKandidat(env, r.eurocode, 'FRONTRUTE_ONLY', null);
    if (k && !unike.has(k.varenr)) unike.set(k.varenr, k);
  }
  return [...unike.values()];
}

/** GT-radens serie-kode — begge veier: direkte kode i navnet («GOLF IV», «W204»,
 *  «F56») ELLER utledet fra (merke, GT-modell-navn, år) som SVV-modell
 *  («1 HBK» 2007 → E81 — seed-rader uten kode får generasjonskoden sin). */
export function gtSerieFor(make: string, gtModell: string, aar: number | null): string | null {
  const direkte = normaliserKatalogModell(gtModell);
  if (direkte) return direkte;
  return serieKey(make, gtModell, aar);
}

/** Matcher én GT-rad mot kjøretøyet (make+år er allerede filtrert i SQL).
 *  Eksakt modell-navn, ordbasert token-treff (aldri substring) eller serie-kode-match. */
/**
 * Modellnøkkel: bokstaver og siffer, uten skilletegn og aksenter.
 *
 * «RAV4», «RAV 4» og «RAV-4» er samme bil, men GT-matchingen er ordbasert og
 * så dem som ulike (`RAV4` gir ett token, `RAV-4` gir `RAV` + `4`). Nøkkelen
 * brukes KUN ved eksakt likhet etter normalisering — den kan derfor aldri slå
 * sammen to modeller som faktisk heter noe forskjellig.
 */
export function modellNokkel(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Énbokstavs-tokens som skiller modeller: «MODEL 3» vs «MODEL Y», «A-CLASS» vs
 * «B-CLASS». Ord-treffet ser bare på tokens med ≥2 tegn, så uten denne vakten
 * ville «MODEL Y» matchet GT-raden «MODEL 3» på ordet MODEL alene.
 * Returnerer true bare når begge navn har slike tegn og de er helt ulike.
 */
/**
 * Ord som gjør en bil til en ANNEN bil, ikke en variant av samme glass:
 * Golf Sportsvan/Plus/Cross er ikke en Golf, Transit Connect/Courier er ikke en
 * Transit, Passat CC er ikke en Passat. Uten denne vakten matchet
 * «GOLF SPORTSVAN» GT-raden «GOLF» på ordet GOLF alene.
 *
 * Merk: «+» regnes som ordet PLUS. Katalogen skriver «PRIUS+» mens SVV skriver
 * «PRIUS PLUS» — uten denne normaliseringen ble det en falsk variantkonflikt og
 * Prius+ mistet alle kandidater (målt 2026-11-04).
 *
 * Drivlinjeord (PLUG/PLUGIN/HYBRID/PHEV) er bevisst IKKE med: SVV skriver
 * «V60 PLUG IN HYBRID», og en slik vakt fjernet en gyldig PINPOINT for V60 uten
 * å fjerne noen reell feilkilde (målt 2026-11-04). Om en plug-in har samme
 * frontrute er et fitment-spørsmål for Tom, ikke noe matchereren avgjør.
 */
const NAVNEMODELLER = new Set(['SPORTSVAN', 'PLUS', 'CROSS', 'CONNECT', 'COURIER', 'SHOOTING', 'CC', 'GRAND']);

/**
 * Drivlinjevarianter: en variant KJØRETØYET oppgir, som raden ikke har, gir ikke
 * treff. Ensidig med vilje — GT-raden «NIRO (HYBRID) 2016-2022» beskriver hele
 * modellinjen og skal fortsatt treffe en «Kia Niro».
 */
const DRIVLINJE_ORD = new Set(['PLUG', 'PLUGIN', 'HYBRID', 'LADEHYBRID', 'PHEV', 'PHV', 'MILD', 'MHEV']);

export function drivlinjeKonflikt(kjoretoy: string, rad: string): boolean {
  const kj = ordSett(kjoretoy);
  const r = ordSett(rad);
  return [...kj].some((o) => DRIVLINJE_ORD.has(o) && !r.has(o));
}

function ordSett(s: string): Set<string> {
  return new Set(
    (s || '').toUpperCase()
      // «PRIUS+» (plus på slutten av ordet) = «PRIUS PLUS». Men «SED+STV» er to
      // ord, ikke en PLUS-variant — derfor bare når + ikke følges av en bokstav.
      .replace(/\+(?![A-Z0-9])/g, ' PLUS ')
      .replace(/[^A-ZÆØÅ0-9]+/g, ' ').split(/\s+/).filter(Boolean),
  );
}

/** Ulike navnemodeller skal aldri møtes, uansett hvilken side ordet står på. */
export function variantKonflikt(a: string, b: string): boolean {
  const oa = ordSett(a);
  const ob = ordSett(b);
  const na = [...oa].filter((o) => NAVNEMODELLER.has(o));
  const nb = [...ob].filter((o) => NAVNEMODELLER.has(o));
  if (!na.length && !nb.length) return false;
  return na.some((o) => !ob.has(o)) || nb.some((o) => !oa.has(o));
}

const navnemodellKonflikt = variantKonflikt;

function enkelttegnKonflikt(a: string, b: string): boolean {
  const tegn = (s: string) => new Set(
    (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length === 1),
  );
  const ta = tegn(a);
  const tb = tegn(b);
  if (!ta.size || !tb.size) return false;
  for (const t of ta) if (tb.has(t)) return false;
  return true;
}

export function gtRadMatch(radModelRaa: string, make: string, modelRaa: string, aarList: number[]): boolean {
  // Butikk- og leverandørkatalog bruker ulike navn på samme bil (PRIUS PLUS =
  // GRAND PRIUS). Synonymet gjøres på BEGGE sider, så resten av reglene er uendret.
  const radModel = modellSynonym(radModelRaa);
  const model = modellSynonym(modelRaa);
  const tokens = modellTokensAv(model, make);
  const serie = serieKey(make, model, aarList[0]);
  if (radModel === model) return true;
  // Skilletegn skal ikke avgjøre: «RAV4» == «RAV 4» == «RAV-4».
  const nokkelRad = modellNokkel(radModel);
  if (nokkelRad && nokkelRad === modellNokkel(model)) return true;
  // Ulike modellbokstaver (MODEL 3 vs MODEL Y) og ulike navnemodeller
  // (GOLF vs GOLF SPORTSVAN) skal aldri falle gjennom til ord-treffet på de
  // felles ordene.
  if (enkelttegnKonflikt(radModel, model)) return false;
  if (navnemodellKonflikt(radModel, model)) return false;
  if (drivlinjeKonflikt(model, radModel)) return false;
  if (tokens.length && ordTreff(radModel, tokens)) return true;
  if (serie) {
    const gtSerie = gtSerieFor(make, radModel, aarList[0]);
    if (gtSerie === serie) return true;
  }
  return false;
}

/** Ren versjon av gtEurokoderSett: GT-rader (make+år-filtrert) → fasit-sett.
 *  Returnerer null når ingen rad matcher (G1-gaten må da nekte PINPOINT). */
export function gtRaderSett(
  rader: Array<{ model: string; frontrute_eurocode: string | null }>,
  make: string,
  model: string,
  aarList: number[]
): Set<string> | null {
  if (!aarList.length) return null;
  // Ingen early-return på tomme tokens: eksakt modell-navn («3», «X») må fortsatt
  // kunne treffe selv om token-utvinningen gir 0 signifikante tokens (1-tegns navn
  // droppes av modellTokensAv). gtRadMatch avgjør per rad.
  const sett = new Set<string>();
  for (const r of rader) {
    if (!gtRadMatch(r.model, make, model, aarList)) continue;
    sett.add(String(r.frontrute_eurocode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
  return sett.size ? sett : null;
}

/** Ren versjon av lagGroundTruth: GT-rader → unike salgbare frontrute-kandidater.
 *
 *  `tilKandidater` returnerer ALLE varianter raden peker på. GT lagrer varenr
 *  (salgsnummeret), og ett varenr kan ha flere dokumenterte eurokoder med ulikt
 *  utstyr og ulik årang. Deduplisering skjer derfor på variant (varenr+eurokode),
 *  ikke på varenr — ellers ville variantene blitt slått sammen her også.
 *  Flere varianter for samme år → VERIFY (doktrine: aldri tvetydig PINPOINT).
 *
 *  GT-SIKKERHETSREGEL (2026-11-04): en GT-rad som peker på et VARENR er ikke bevis
 *  for én bestemt full eurokode. Den kan bare gi PINPOINT når varenr + bilens år
 *  peker på NØYAKTIG ÉN dokumentert variant. Gir den flere, er koblingen tvetydig
 *  og resultatet skal være VERIFY — uansett hvor mange GT-rader som peker dit.
 *  GT-rader som selv inneholder en full eurokode (b2b-seed) er eksplisitt
 *  variantbevis og kan gi PINPOINT når prisen er kjent. */
export async function gtRaderKandidater(
  rader: Array<{ model: string; frontrute_eurocode: string | null }>,
  make: string,
  model: string,
  aarList: number[],
  tilKandidater: (kode: string) => Promise<ResolverKandidat[]>
): Promise<ResolverKandidat[]> {
  if (!aarList.length) return [];
  const unike = new Map<string, ResolverKandidat>();
  const sortert = [...rader].sort((a, b) =>
    (b.model.toUpperCase() === model ? 1 : 0) - (a.model.toUpperCase() === model ? 1 : 0)
  );
  for (const r of sortert) {
    if (!gtRadMatch(r.model, make, model, aarList)) continue;
    if (!r.frontrute_eurocode) continue;
    for (const k of await tilKandidater(r.frontrute_eurocode)) {
      const nokkel = k.variantId ?? variantNokkel(k.varenr, k.eurokode, k.varenavn);
      if (!unike.has(nokkel)) unike.set(nokkel, k);
    }
  }
  return [...unike.values()];
}

type ProfilFiltrerbar = 'sensor' | 'antenne' | 'coated';
const FILTRERBARE_PROFIL: ProfilFiltrerbar[] = ['sensor', 'antenne', 'coated'];

/** Utstyrsfiltrering på kundens svar: kun besvarte attributter virker.
 *  - svar=true  → behold kandidater der attributt !== false (true eller ukjent)
 *  - svar=false → behold kandidater der attributt !== true (false eller ukjent)
 *  - ukjent (null) strykes aldri; tom resultatliste → original liste (aldri tøm).
 *  - Positiv lookahead KUN for ja-svar: hvis nøyaktig én kandidat har alle
 *    ja-attributtene satt til true og resten er ukjente → velg den. */
export function filtrerPaaProfil(kandidater: ResolverKandidat[], profil: BilInput['profil'] | undefined): ResolverKandidat[] {
  if (!kandidater.length) return kandidater;
  const p = profil ?? {};
  const besvart = FILTRERBARE_PROFIL.filter((k) => p[k] === true || p[k] === false);
  if (!besvart.length) return kandidater;

  let rest = kandidater.filter((k) =>
    besvart.every((a) => (p[a] ? k.attributter[a] !== false : k.attributter[a] !== true))
  );
  if (rest.length === 1) return rest;
  if (!rest.length) return kandidater;

  // Lookahead kun for ja-svar: én kandidat med alle ja-attributter definitivt true.
  const ja = besvart.filter((a) => p[a] === true);
  if (ja.length) {
    const positive = rest.filter((k) => ja.every((a) => k.attributter[a] === true));
    if (positive.length === 1) return positive;
  }
  return rest;
}

/** Alla GT-eurokoder for et kjøretøy (inkl. de uten prislistetreff) — fasit-settet.
 *  Brukes for å gate PINPOINT fra L2/L3: kandidaten MÅ bekreftes av ground_truth.
 *  Serie-mapping: Mercedes W-koder («C 180 CDI» 2013 → W204), BMW E/F/G-koder
 *  («525D» 2001 → E39), VW-generasjoner («GOLF» 2005 → GOLF V), Opel-bokstaver,
 *  MINI R/F-koder, Nissan P/K/N, Toyota MK/J-serier — matches mot GT-rader
 *  nøklet med samme serie-kode (begge veier, se gtSerieFor). */
async function gtEurokoderSett(env: Env, make: string, model: string, aarList: number[], makeRaa?: string): Promise<Set<string> | null> {
  if (!aarList.length) return null;
  const makes = makeRaa && makeRaa !== make ? [make, makeRaa] : [make];
  const mPlasser = makes.map(() => '?').join(',');
  const plasser = aarList.map(() => '?').join(',');
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT model, frontrute_eurocode FROM ground_truth
     WHERE make IN (${mPlasser}) AND year IN (${plasser})
     ORDER BY model LIMIT 200`
  ).bind(...makes, ...aarList).all<{ model: string; frontrute_eurocode: string }>();
  return gtRaderSett(rows.results ?? [], make, model, aarList);
}

/** L1 — ground_truth: verifiserte kjøretøy → frontrute-kode (varenr i prisliste).
 *  Match: make + EKSAKT år + ordbasert modell-token (aldri substring)
 *  ELLER serie-kode-match (Mercedes W204 / BMW E39 / VW GOLF V / …).
 *  aarList: prioriterte år (VIN-modellåret først, registreringsåret som fallback) —
 *  GT-rader kan være nøklet på begge, og VIN-korreksjon må aldri MISTE GT-treff. */
async function lagGroundTruth(env: Env, make: string, model: string, aarList: number[], makeRaa?: string, profil?: BilInput['profil']): Promise<ResolverKandidat[]> {
  if (!aarList.length) return [];
  const makes = makeRaa && makeRaa !== make ? [make, makeRaa] : [make];
  const mPlasser = makes.map(() => '?').join(',');
  const plasser = aarList.map(() => '?').join(',');
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT model, frontrute_eurocode, confidence FROM ground_truth
     WHERE make IN (${mPlasser}) AND year IN (${plasser})
     ORDER BY confidence DESC, model ASC LIMIT 200`
  ).bind(...makes, ...aarList).all<{ model: string; frontrute_eurocode: string; confidence: number }>();
  const kandidater = await gtRaderKandidater(rows.results ?? [], make, model, aarList, (kode) => prisKandidater(env, kode, 'FRONTRUTE_ONLY', aarList[0] ?? null));
  // L1-profilsmaling: kundens utstyrssvar gjør GT-varianter entydige (samme
  // doktrine som L2). Uten svar: alle GT-varianter → VERIFY (G1-ærlig).
  return kandidater.length > 1 ? filtrerPaaProfil(kandidater, profil) : kandidater;
}

/** L2 — glass_catalog (Pilkington): brand + ordbasert modell-token + år + utstyrsflagg.
 *  År-regel når bilens år er kjent: kandidatens vindu (kolonne ELLER modellstreng) må
 *  være kjent og inneholde året — ellers ekskluderes (unngår feil generasjon). */
async function lagPilkington(env: Env, make: string, model: string, aar: number | null, profil: BilInput['profil']): Promise<ResolverKandidat[]> {
  const modelSyn = modellSynonym(model);
  const tokens = modellTokensAv(modelSyn, make).slice(0, 4);
  if (!tokens.length) return [];
  // SQL-forfiltreringen bruker RÅ ord: familie-tokenet («ID4») finnes ikke som
  // tekst i katalograder som skriver «ID.4 SUV». Uten dette ga LIKE null rader
  // og ID.4/ID.5 falt til FALLBACK (målt 2026-11-04).
  const prefilter = sqlTokensAv(model, make).slice(0, 4);
  const likeOrd = prefilter.length ? prefilter : tokens;
  const like = likeOrd.map(() => 'model LIKE ?').join(' OR ');
  const params: (string | number)[] = [make, ...likeOrd.map((t) => `%${escLike(t)}%`)];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT eurocode, brand, model, year_from, year_to, rain_sensor, antenna, hud, camera, adas, description
     FROM glass_catalog
     WHERE brand = ? AND category IN ('frontrute','annet') AND (${like})
     LIMIT 50`
  ).bind(...params).all<{
    eurocode: string; brand: string; model: string | null; year_from: number | null; year_to: number | null;
    rain_sensor: number | null; antenna: number | null; hud: number | null; camera: number | null; adas: number | null; description: string | null;
  }>();
  const variantSpesifikk: ResolverKandidat[] = [];
  const generisk: ResolverKandidat[] = [];
  for (const r of rows.results ?? []) {
    const radModel = modellSynonym(r.model ?? '');
    if (!ordTreffKandidat(radModel, tokens)) continue; // ordbasert — aldri substring, aldri generisk treff alene
    if (variantKonflikt(radModel, modelSyn)) continue;  // Golf Sportsvan ≠ Golf
    // Årvindu: kolonne-verdier, ellers år-hint i modellstrengen
    if (aar != null) {
      const intervall = r.year_from != null
        ? { start: r.year_from, slutt: r.year_to ?? Infinity }
        : modellAarIntervall(r.model);
      if (!intervall) continue; // ukjent generasjon → ekskluder (false positive verre enn fallback)
      if (!matcherAar({ start: intervall.start - 1, slutt: intervall.slutt === Infinity ? Infinity : intervall.slutt + 1 }, aar)) continue;
    }
    const k = await prisKandidat(env, r.eurocode, 'FRONTRUTE_ONLY', aar);
    if (!k) continue;
    // prisKandidat gir allerede korrekte attributter (eurokode-dekoder for A/M/C/H,
    // glass_catalog kun for kamera/adas) — IKKE overstyr med glass_catalog-flagg her
    // (glass_catalog har feil/manglende antenna/rain_sensor for 57 %+ av radene).
    // Drivlinje: en variant kjøretøyet oppgir skal ikke arve grunnmodellens rute —
    // MEN bare når katalogen faktisk skiller varianten (har en egen rad for den).
    // Uten en slik rad blokkerer vi ikke kandidatene; resultatet blir VERIFY (målt
    // 2026-11-04: V60 PLUG IN HYBRID mistet all dekning uten denne nyansen).
    if (drivlinjeKonflikt(modelSyn, radModel)) variantSpesifikk.push(k);
    else generisk.push(k);
  }
  // Katalogen skiller varianten → bruk bare de variantspesifikke radene.
  // Ellers: katalogen skiller ikke → behold de generiske (utfall blir VERIFY).
  const valgte = variantSpesifikk.length ? variantSpesifikk : generisk;
  const unike = new Map<string, ResolverKandidat>();
  for (const k of valgte) {
    const nøkkel = k.eurokode ?? k.varenr;
    if (!unike.has(nøkkel)) unike.set(nøkkel, k);
  }
  let liste = [...unike.values()];
  // Utstyrsfiltrering: profil-flagg → kun kandidater som matcher (ukjente flagg straffes ikke)
  liste = filtrerPaaProfil(liste, profil);
  return liste;
}

/** L3 — ktype: ktype_registry → glass_catalog.ktype → eurokoder (klar, tom lokal). */
async function lagKtype(env: Env, make: string, model: string, aar: number | null): Promise<ResolverKandidat[]> {
  const tokens = modellTokensAv(model, make).slice(0, 4);
  if (!tokens.length) return [];
  const like = tokens.map(() => 'model LIKE ?').join(' OR ');
  const params: (string | number)[] = [make, ...tokens.map((t) => `%${escLike(t)}%`)];
  const reg = await env.FINNBILGLASS_DB.prepare(
    `SELECT ktype, model FROM ktype_registry WHERE brand = ? AND (${like}) LIMIT 20`
  ).bind(...params).all<{ ktype: string; model: string }>();
  const ktypes = [...new Set((reg.results ?? []).filter((r) => ordTreff(r.model, tokens)).map((r) => r.ktype))];
  if (!ktypes.length) return [];
  const unike = new Map<string, ResolverKandidat>();
  for (let i = 0; i < ktypes.length; i += 40) {
    const batch = ktypes.slice(i, i + 40);
    const plasser = batch.map(() => '?').join(',');
    const rows = await env.FINNBILGLASS_DB.prepare(
      `SELECT eurocode FROM glass_catalog WHERE ktype IN (${plasser}) AND category IN ('frontrute','annet') LIMIT 20`
    ).bind(...batch).all<{ eurocode: string }>();
    for (const r of rows.results ?? []) {
      const k = await prisKandidat(env, r.eurocode, 'FRONTRUTE_ONLY', aar);
      if (k && !unike.has(k.varenr)) unike.set(k.varenr, k);
    }
  }
  return [...unike.values()];
}

/** L3T — lisensiert TecDoc: VIN → kType → canonical vehicle linkage.
 *
 * VIN-koblingen må være minst 0,90. Ett eneste kompatibelt glass gir fortsatt
 * VERIFY inntil OEM/build- eller feature-bevis finnes; kType alene beskriver
 * bilvarianten, ikke nødvendigvis fabrikkens komplette ruteutstyr.
 *
 * Defensiv: tabellene glass_master/glass_vehicle_links finnes KUN i staging (C10 knowledge graph).
 * I prod faller vi trygt gjennom til L2/FALLBACK via try/catch + tabell-check.
 */
async function lagTecdocKtype(env: Env, vin: string | null | undefined): Promise<ResolverKandidat[]> {
  const v = normVin(vin);
  if (!v) return [];
  const map = await env.FINNBILGLASS_DB.prepare(
    `SELECT ktype FROM vin_ktype_map
     WHERE vin = ? AND confidence >= 0.90 AND source LIKE 'tecdoc:%'
     LIMIT 2`
  ).bind(v).all<{ ktype: string }>();
  const ktypes = [...new Set((map.results ?? []).map((row) => row.ktype))];
  if (ktypes.length !== 1) return [];

  // Defensiv tabell-eksistens-sjekk — unngå krasj i prod (tabeller mangler)
  try {
    const check = await env.FINNBILGLASS_DB.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='glass_vehicle_links' LIMIT 1`
    ).all<{ '1': number }>();
    if (!check.results?.length) return [];
  } catch {
    return [];
  }

  try {
    const rows = await env.FINNBILGLASS_DB.prepare(
      `SELECT DISTINCT gm.eurocode
       FROM glass_vehicle_links AS link
       JOIN glass_master AS gm ON gm.id = link.glass_id
       WHERE link.ktype = ? AND link.is_current = 1
         AND gm.is_current = 1 AND gm.status = 'active'
       LIMIT 20`
    ).bind(ktypes[0]).all<{ eurocode: string | null }>();

    const unike = new Map<string, ResolverKandidat>();
    for (const row of rows.results ?? []) {
      if (!row.eurocode) continue;
      // TecDoc-laget er VIN-basert og kjenner ikke årsmodellen her — ingen årvalg.
      const kandidat = await prisKandidat(env, row.eurocode, 'FRONTRUTE_ONLY', null);
      if (kandidat && !unike.has(kandidat.varenr)) unike.set(kandidat.varenr, kandidat);
    }
    return [...unike.values()];
  } catch {
    // Tabeller mangler eller annen DB-feil → returner tomt, la resolveren falle til L2/FALLBACK
    return [];
  }
}

/**
 * PINPOINT-sperre: glasskoder der ground_truth kan være for vide i årene.
 *
 * Svekker PINPOINT til VERIFY — kandidaten blir stående, men kunden må bekrefte.
 * Brukes når en pålitelig kilde motsier GT: målt 2026-11-04 fører www.auto-glass.no
 * «TOYOTA RAV 4 19-21 FR…» som egen vare, atskilt fra «TOYOTA RAV 4 2019- FR…»,
 * mens GT mapper 2022-2025 til samme eurokode (8432AGAC). GT-årene endres IKKE
 * for å få resultatet til å passe; sperren fjernes først når leverandør har
 * bekreftet passformen.
 */
const PINPOINT_SPERRET: Array<{
  eurokodePrefiks: string[];
  merke?: RegExp;
  modell: RegExp;
  aarFra: number;
  aarTil: number;
  grunn: string;
}> = [
  {
    eurokodePrefiks: ['8432AGAC'],
    merke: /^TOYOTA$/,
    modell: /(?:^|\s)RAV[\s-]?4\b/,  // SVV kan sende «TOYOTA RAV4» som modellstreng
    aarFra: 2022,
    aarTil: 2025,
    grunn: 'GT sier 2022-2025, men varenr 8432AGAC finnes både som «RAV 4 19-21» og «RAV 4 2019-» — årsmodell er ikke bekreftet av leverandør',
  },
];

/** Returnerer sperre-årsak, eller null. Matcher på eurokode-prefiks + bil + år. */
export function pinpointSperre(make: string, model: string, aar: number | null, eurokode: string | null): string | null {
  if (aar == null || !eurokode) return null;
  const kode = eurokode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const s of PINPOINT_SPERRET) {
    if (!s.eurokodePrefiks.some((p) => kode.startsWith(p))) continue;
    if (s.merke && !s.merke.test(make.toUpperCase())) continue;
    if (!s.modell.test(model.toUpperCase())) continue;
    if (aar < s.aarFra || aar > s.aarTil) continue;
    return s.grunn;
  }
  return null;
}

/** Svekker PINPOINT til VERIFY når koden er sperret. Fjerner aldri kandidaten. */
function medPinpointSperre(res: ResolverResultat, make: string, model: string, aar: number | null): ResolverResultat {
  if (res.utfall !== 'PINPOINT') return res;
  const grunn = pinpointSperre(make, model, aar, res.eurokode ?? res.kandidater?.[0]?.eurokode ?? null);
  if (!grunn) return res;
  return { ...res, utfall: 'VERIFY', grunn: `PINPOINT sperret: ${grunn}`, confidence: Math.min(res.confidence ?? 0, 0.5) };
}

/** Kan kandidaten bli PINPOINT? Krever kjent, salgbar pris.
 *  Kilden bruker 0 som «ikke priset» (importen gjør det om til NULL), og et
 *  PINPOINT med ukjent pris er en pris-lovnad vi ikke kan holde. */
export function pinpointTillatt(k: { listepris: number | null }): boolean {
  return typeof k.listepris === 'number' && k.listepris > 0;
}

/** Felles utfalls-logikk: 0 → FALLBACK, 1 → PINPOINT (med GT-gate), 2+ → VERIFY.
 *  GT-gate (G1-doktrine): PINPOINT krever at kandidaten bekreftes av ground_truth —
 *  unntak: L0 (manuell VIN-fasit) og L1 (GT er selv kilden). */
export function utfraKandidater(kandidater: ResolverKandidat[], lag: string, confidence: number, gtSett: Set<string> | null = null): ResolverResultat | null {
  if (kandidater.length === 0) return null;
  if (kandidater.length === 1) {
    const k = kandidater[0];
    // Pris må være kjent og salgbar. Kilden bruker 0 som «ikke priset», og
    // importen har gjort det om til NULL; en kandidat uten pris kan vises som
    // kandidat, men aldri bli PINPOINT (målt 2026-11-04: BMW i7 2022 ble
    // PINPOINT på en pris-0-rad så snart varianten kom inn i basen).
    const prisKjent = pinpointTillatt(k);
    if (!prisKjent) {
      return {
        utfall: 'VERIFY',
        grunn: `L${lag}: 1 kandidat, men prisen er ikke kjent — må bekreftes manuelt`,
        confidence: Math.min(confidence, 0.5),
        totalAntall: 1,
        varenr: k.varenr,
        varenavn: k.varenavn,
        eurokode: k.eurokode,
        variantId: k.variantId ?? null,
        kandidater: [k],
        sporsmaal: skillendeSporsmaal([k]),
      };
    }
    const gtOk = lag.startsWith('0 ') || lag.startsWith('1 ') || (gtSett && k.eurokode && gtSett.has(k.eurokode.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    if (!gtOk) {
      return {
        utfall: 'VERIFY',
        grunn: `L${lag}: 1 kandidat, men ikke bekreftet av ground_truth — utstyr må verifiseres`,
        confidence: Math.min(confidence, 0.5),
        totalAntall: 1,
        kandidater: [k],
        sporsmaal: skillendeSporsmaal([k]),
      };
    }
    return {
      utfall: 'PINPOINT',
      grunn: `L${lag}: entydig treff (${kandidater.length} kandidat)`,
      confidence,
      totalAntall: 1,
      varenr: k.varenr,
      varenavn: k.varenavn,
      pris: k.pris,
      listepris: k.listepris,
      eurokode: k.eurokode,
      variantId: k.variantId ?? null,
      kandidater: [k],
      sporsmaal: [],
    };
  }
  return {
    utfall: 'VERIFY',
    grunn: `L${lag}: ${kandidater.length} varianter${kandidater.length > 6 ? ' (viser 6)' : ''} — utstyr må verifiseres`,
    confidence: Math.min(confidence, 0.5),
    totalAntall: kandidater.length,
    kandidater: kandidater.slice(0, 6),
    sporsmaal: skillendeSporsmaal(kandidater.slice(0, 6)),
  };
}

/** Hovedresolver: bil → PINPOINT / VERIFY / FALLBACK. */
export async function resolveFrontrute(env: Env, bil: BilInput): Promise<ResolverResultat> {
  const make = normBrand(bil.merke);
  // Rå make beholder katalog-spesifikke former («VOLVO TRUCKS», «FIAT TRUCKS»)
  // som GT-tabellen bruker — normBrand-aliaset alene mister lastebil/kommersiell-glasstreff.
  const makeRaa = (bil.merke ?? '').trim().toUpperCase();
  const model = (bil.modell ?? '').trim().toUpperCase();
  // Faktisk modellår fra VIN (pos 10) vinner over registreringsåret: SVV gir kun norsk
  // registreringsdato, så importbiler registrert senere enn modellåret fikk feil generasjon.
  const aarVin = vinModelYear(bil.vin, bil.aar);
  const aar = aarVin ?? bil.aar ?? null;
  // GT-oppslag prøver begge år (VIN-året først, registreringsåret som fallback) —
  // GT-rader kan være nøklet på enten, og VIN-korreksjon må aldri miste GT-treff.
  const aarList = aar == null ? [] : [...new Set([aar, ...(bil.aar != null ? [bil.aar] : [])])];

  // Filter fully materialised variants at EVERY layer, before ranking/capping.
  const compatible = (ks: ResolverKandidat[]) => ks.filter(k => !glassBodyRejection(bil, k.varenavn));

  // L0 — eksakt VIN-overstyring for manuelt verifiserte fasitbiler
  let kand = await lagVinOverride(env, bil.vin);
  let res = utfraKandidater(compatible(kand), '0 (vin_glass_overrides)', 0.95);
  if (res) return res;

  // L1 — ground_truth (verifiserte kjøretøy)
  kand = await lagGroundTruth(env, make, model, aarList, makeRaa, bil.profil);
  res = utfraKandidater(compatible(kand), '1 (ground_truth)', 0.85);
  if (res) return medPinpointSperre(res, make, model, aar);

  // GT-fasit-settet for kjøretøyet (gate for L2/L3-PINPOINT — G1-doktrine)
  const gtSett = await gtEurokoderSett(env, make, model, aarList, makeRaa);

  // L3T — lisensiert TecDoc Vehicle Identification + parts linkage.
  // Ktype alene kan aldri overstyre feature-/OEM-gaten for PINPOINT.
  kand = await lagTecdocKtype(env, bil.vin);
  res = utfraKandidater(compatible(kand), '3T (TecDoc VIN→KType)', 0.9, gtSett);
  if (res) return medPinpointSperre(res, make, model, aar);

  // L2 — Pilkington-katalog
  kand = await lagPilkington(env, make, model, aar, bil.profil);
  res = utfraKandidater(compatible(kand), '2 (glass_catalog)', 0.7, gtSett);
  if (res) return medPinpointSperre(res, make, model, aar);

  // L3 — ktype (kun når data finnes)
  kand = await lagKtype(env, make, model, aar);
  res = utfraKandidater(compatible(kand), '3 (ktype)', 0.75, gtSett);
  if (res) return medPinpointSperre(res, make, model, aar);

  return { utfall: 'FALLBACK', grunn: 'ingen resolver-data — tekstmatcher overtar', confidence: 0 };
}

/**
 * Finner glasskandidater for alle posisjoner (dør, ventil, side, bakrute),
 * valgfritt filtrert på ønsket plassering.
 *
 * Viktig: dette gir KANDIDATER, ikke fitment. En kandidat herfra er ikke bevist
 * å passe bilen — kjøretøytilknytning må komme fra applikasjonsdata eller
 * manuell kontroll. Funksjonen returnerer derfor aldri EXACT.
 */
export async function finnGlassKandidater(
  env: Env,
  sok: string,
  onske?: Posisjonsonske | null,
  maks = 25,
): Promise<ResolverKandidat[]> {
  const kode = (sok || '').trim().toUpperCase();
  if (kode.length < 2) return [];
  const like = `%${kode.replace(/[%_]/g, '')}%`;

  let rader: Array<{ varenr: string; eurokode: string | null }> = [];
  try {
    const r = await env.FINNBILGLASS_DB.prepare(
      `SELECT varenr, eurokode FROM glass_prisliste
        WHERE rad_type = 'glass' AND (UPPER(varenr) = ?1 OR UPPER(eurokode) = ?1
           OR UPPER(varenr) LIKE ?2 OR UPPER(eurokode) LIKE ?2)
        ORDER BY varenr LIMIT 200`,
    ).bind(kode, like).all<{ varenr: string; eurokode: string | null }>();
    rader = r.results ?? [];
  } catch {
    return [];
  }

  const kandidater: ResolverKandidat[] = [];
  for (const rad of rader) {
    const k = await prisKandidat(env, rad.varenr, 'ALL_GLASS_CANDIDATES');
    if (k) kandidater.push(k);
  }

  const filtrert = filtrerPaPosisjon(
    kandidater.map((k) => ({ ...k, typekode: k.posisjon?.typekode ?? null })),
    onske ?? null,
  );
  return filtrert.slice(0, maks);
}
