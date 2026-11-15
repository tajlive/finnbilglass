import { parseEurocodePosition } from './normalization/eurocode-position.js';
import { parseCatalogueComment, type ParsedFeatureComment } from './normalization/catalogue-feature-comment.js';

/**
 * fitment-v1/catalogue-candidates — CLASS_D-kandidatgenerator fra gt-auto-prislisten.
 * Katalogdata er KUN kandidatmateriale: CLASS_D_CATALOGUE_CANDIDATE, ALDRI VERIFIED_FITMENT,
 * ALDRI EXACT, ALDRI automatisk OE-aksept (Tom-beslutning C7.5, 2026-08-18).
 * Kjernen: varenavn-parsing (merke → familie → generasjon → produksjonsår) + år-intervall-match.
 */
export interface CatalogueCandidate {
  eurokode: string;
  varenr: string;
  varenavn: string;
  features: string[];
  /** Weak tri-state product-description hints, never verified vehicle equipment. */
  featureEvidence?: ParsedFeatureComment;
  generationHint?: string | null;
  source: 'GT_AUTO_PRISLISTE';
  klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE';
  matchReason: string;
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
  MITSUBISHI: ['MITSUBISHI'],
  FIAT: ['FIAT'],
  MINI: ['MINI'],
};

/** Familie-regler: (merke, regex på modell-token) → familie-nøkkel + generasjons-hint-fra-varenavn */
export const FAMILIER: { merke: string; re: RegExp; familie: string }[] = [
  { merke: 'VW', re: /GOLF/, familie: 'GOLF' },
  { merke: 'VW', re: /PASSAT/, familie: 'PASSAT' },
  { merke: 'VW', re: /POLO/, familie: 'POLO' },
  { merke: 'VW', re: /TRANSPORTER|TRANSPORT|MULTIVAN|CARAVELLE|T5|T6/, familie: 'TRANSPORTER' },
  { merke: 'VW', re: /\bUP!?(?:\s|$)/, familie: 'UP' },
  { merke: 'MERCEDES', re: /CLA/, familie: 'CLA' },
  { merke: 'MERCEDES', re: /SPRINTER/, familie: 'SPRINTER' },
  { merke: 'MERCEDES', re: /VITO|V-CLASS/, familie: 'VITO' },
  { merke: 'MERCEDES', re: /A-CLASS|A KLASSE/, familie: 'A-CLASS' },
  { merke: 'MERCEDES', re: /GLA/, familie: 'GLA' },
  { merke: 'BMW', re: /1-SERIE|1 SERIE|1ER|116|118|120|125/, familie: '1-SERIE' },
  { merke: 'BMW', re: /3-SERIE|3 SERIE|3ER|316|318|320|325|330/, familie: '3-SERIE' },
  { merke: 'VOLVO', re: /XC60/, familie: 'XC60' },
  { merke: 'VOLVO', re: /XC90/, familie: 'XC90' },
  { merke: 'TESLA', re: /MODEL\s?3/, familie: 'MODEL-3' },
  { merke: 'TESLA', re: /MODEL\s?Y/, familie: 'MODEL-Y' },
  { merke: 'NISSAN', re: /LEAF/, familie: 'LEAF' },
  { merke: 'MITSUBISHI', re: /\bASX\b/, familie: 'ASX' },
  { merke: 'MAZDA', re: /\bCX[-\s]?5\b/, familie: 'CX-5' },
  // Electric variant first: never pool the new 500 Electric with 500 (2007-).
  { merke: 'FIAT', re: /\b500(?:E|\s+(?:ELECTRIC|EV))\b/, familie: '500-ELECTRIC' },
  { merke: 'FIAT', re: /\b500\b/, familie: '500' },
  { merke: 'TOYOTA', re: /RAV4|RAV\s?4/, familie: 'RAV4' },
  { merke: 'TOYOTA', re: /COROLLA/, familie: 'COROLLA' },
  { merke: 'TOYOTA', re: /HILUX/, familie: 'HILUX' },
  { merke: 'FORD', re: /TRANSIT/, familie: 'TRANSIT' },
  { merke: 'OPEL', re: /CORSA/, familie: 'CORSA' },
  { merke: 'OPEL', re: /ASTRA/, familie: 'ASTRA' },
  { merke: 'OPEL', re: /VECTRA/, familie: 'VECTRA' },
  { merke: 'MINI', re: /COOPER|MINI/, familie: 'MINI' },
];

/** Trekker ut tosifret årsintervall («84-90», «03-08», «12-») fra varenavnet. */
function aarIntervall(varenavn: string): { fra: number | null; til: number | null } {
  const m = varenavn.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
  if (m) {
    const a = (y: string) => (parseInt(y, 10) <= 25 ? 2000 + parseInt(y, 10) : 1900 + parseInt(y, 10));
    return { fra: a(m[1]), til: a(m[2]) };
  }
  const en = varenavn.match(/\b(\d{2})\s*[-–]\s*$/);
  if (en) return { fra: parseInt(en[1], 10) <= 25 ? 2000 + parseInt(en[1], 10) : 1900 + parseInt(en[1], 10), til: null };
  return { fra: null, til: null };
}

function parseRow(r: { varenr: string; eurokode?: string | null; varenavn?: string | null }): ParsedRow | null {
  const varenavn = String(r.varenavn ?? '').toUpperCase();
  const merke = Object.entries(MERKE_ALIAS).find(([, aliases]) => aliases.some((a) => varenavn.startsWith(a) || varenavn.includes(' ' + a)))?.[0];
  if (!merke) return null;
  for (const fam of FAMILIER) {
    if (fam.merke === merke && fam.re.test(varenavn)) {
      const { fra, til } = aarIntervall(varenavn);
      // generasjons-hint: «GOLF II», «PASSAT B8», «T5»
      const g = varenavn.match(/\b(?:GOLF|PASSAT|POLO)\s+([IVX]{1,4})\b/) ??
        varenavn.match(/\bPASSAT\s+(B\d)\b/) ??
        varenavn.match(/\b(T\d(?:\.1)?)\b/) ??
        varenavn.match(/\bCX[-\s]?5\s+(II|I)\b/);
      return { varenr: r.varenr, eurokode: r.eurokode ?? '', varenavn, merke, familie: fam.familie, aarFra: fra, aarTil: til, generasjon: g ? g[1] : null };
    }
  }
  return null;
}

/** CLASS_D-kandidatindeks bygget fra gt-auto-prisliste-radene. */
export function buildClassDCandidates(rows: { varenr: string; eurokode?: string | null; varenavn?: string | null; kommentar?: string | null }[]): CatalogueCandidate[] {
  const out: CatalogueCandidate[] = [];
  for (const r of rows) {
    const p = parseRow(r);
    if (!p) continue;
    const featureEvidence = parseCatalogueComment(r.kommentar);
    out.push({
      eurokode: p.eurokode,
      varenr: p.varenr,
      varenavn: p.varenavn,
      features: Object.entries(featureEvidence.states).filter(([, value]) => value === true).map(([key]) => key),
      featureEvidence,
      generationHint: p.generasjon,
      source: 'GT_AUTO_PRISLISTE',
      klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE',
      matchReason: `${p.merke} ${p.familie}${p.generasjon ? ' ' + p.generasjon : ''}${p.aarFra ? ' ' + p.aarFra + '–' + (p.aarTil ?? '') : ''}`,
    });
  }
  return out;
}

/** Finner CLASS_D-kandidater for en bil (make, model, year). Aldri fasit. */
export function matchClassDCandidates(
  index: CatalogueCandidate[], make: string, model: string, year: number | null,
  options: { confirmedGeneration?: string | null } = {},
): CatalogueCandidate[] {
  const rawMake = make.toUpperCase().trim();
  const mk = Object.entries(MERKE_ALIAS).find(([, aliases]) => aliases.includes(rawMake))?.[0] ?? rawMake;
  const mo = model.toUpperCase();
  const fam = FAMILIER.find((f) => f.merke === mk && f.re.test(mo));
  if (!fam) return [];
  // Kandidatkvalitet: ekskluder bak/side-ruter OG tilbehør (PY/GU/K-lister, klips-kit — kjent katalogfelle)
  const erBakSide = (c: CatalogueCandidate) => /BAKRUTE|SIDERUTE|DØRRUTE|DORRUTE|BAKRUT|SIDERUT/.test(c.varenavn);
  const erTilbehor = (c: CatalogueCandidate) => /(PYT|PYB|PYV|PYH|PYS|PYC|PYKIT|PY|GU|GUM)$/.test(c.varenr) || /^\d{3,5}K$/.test(c.varenr) || /PYNTELIST|GUMMILIST|KLIPS|PYNTELISTE/.test(c.varenavn);
  // Position in a numeric Eurocode: A=front, B=rear, F=vent, L/R=door,
  // S=side. A clear non-A position is structural negative evidence for a
  // WINDSCREEN search, even when free-text 'varenavn' omits glass position.
  // Codes without a recognised numeric prefix remain UNKNOWN: do not guess.
  const erDokumentertAnnenPosisjon = (c: CatalogueCandidate) =>
    parseEurocodePosition(c.eurokode).position === 'OTHER';
  // Only explicitly confirmed generation may exclude a candidate. A generation
  // guessed from model year is merely a possible application, not vehicle proof.
  const normalizeGeneration = (g: string) => {
    const upper = g.trim().toUpperCase();
    return (upper.match(/\b(?:GOLF|POLO|PASSAT|CX[-\s]?5)\s+(B\d+|T\d+(?:\.1)?|[IVX]{1,4})\b/) ??
      upper.match(/\b(T\d+(?:\.1)?)\b/))?.[1] ?? upper;
  };
  const confirmed = options.confirmedGeneration ? normalizeGeneration(options.confirmedGeneration) : null;
  const generationCompatible = (c: CatalogueCandidate) =>
    !confirmed || !c.generationHint || normalizeGeneration(c.generationHint) === confirmed;
  const familyKey = fam.merke + ' ' + fam.familie;
  // Exact family boundary: FIAT 500 must never include FIAT 500-ELECTRIC.
  const hits = index.filter((c) => (c.matchReason === familyKey || c.matchReason.startsWith(familyKey + ' ')) && !erBakSide(c) && !erTilbehor(c) && !erDokumentertAnnenPosisjon(c) && generationCompatible(c));
  if (year == null) return hits.slice(0, 6);
  return hits.filter((c) => {
    const y = year;
    // C9.5-fix: match intervall på HELE matchReason — slice(3) krevde generasjon og ga tom
    // array for «BMW 3-SERIE 1983–1990»/«NISSAN LEAF 2012–» (3 ord) → 0 kandidater for
    // alle år-spesifikke biler uten generasjons-hint (moderne BMW 3, LEAF, Model Y).
    const r = /(\d{4})–(\d{4}|)$/.exec(c.matchReason);
    // Katalog-rad UTEN produksjonsintervall er ikke kandidat-evidence for en år-spesifikk bil
    if (!r) return false;
    const fra = parseInt(r[1], 10);
    const til = r[2] ? parseInt(r[2], 10) : Infinity;
    return y >= fra && y <= til;
  });
}
