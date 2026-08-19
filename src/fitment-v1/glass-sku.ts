/**
 * glass-sku — enhetlig GlassSku-modell for godkjenningsflyten (2026-08-19).
 *
 * Mål: Én kanonisk SKU-representasjon på tvers av katalogkilder (glavista-index,
 * GT-auto-prisliste, canonical-master, Tom-fasiter) slik at godkjenningsreglene
 * (src/approval/policy.ts) kan vurdere entydighet, verifiserte regler og
 * attributkonflikter uten å kjenne til kildens interne format.
 *
 * Doktrine: katalog foreslår, evidens bestemmer. `attributes` med `null` =
 * UKJENT — aldri fabrikkert. `status:'verified'` settes KUN fra Tom-fasit
 * (data/fasit-glass.json), aldri fra katalog alene.
 */
import type { Provenance } from './domain.js';

// ── Attributter (null = ukjent — skiller aldri en kandidat automatisk) ──
export interface GlassAttributes {
  /** Frontrute (true for alle poster i frontrute-katalogen). */
  windshield: boolean;
  /** Head-up-display (projeksjon i ruten). */
  hud: boolean | null;
  /** Kamera-feste bak speil (ADAS). */
  cameraBracket: boolean | null;
  /** Regn-/lyssensor. */
  rainLightSensor: boolean | null;
  /** Varmetråder / defogging-sone. */
  heating: boolean | null;
  /** Akustisk / lydempet rute. */
  acoustic: boolean | null;
  /** Antenne i glasset. */
  antenna: boolean | null;
  /** Fargetone-kode (GY/GN/BL/BZ/CL/…). null = ukjent/klar. */
  tint: string | null;
}

export function ukjenteAttributter(a: GlassAttributes): string[] {
  const ut: string[] = [];
  for (const [k, v] of Object.entries(a)) {
    if (k !== 'windshield' && v === null) ut.push(k);
  }
  return ut;
}

// ── VehicleRule — én katalog-/GT-regel som knytter kjøretøy til SKU ──
export interface VehicleRule {
  make: string;
  /** Modellserie/modell-streng slik kilden skriver den («VW TRANSP+T5 2003-»). */
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** Kilde: 'glavista-index' | 'ground-truth' | 'fasit' | 'manual_review'. */
  source: string;
  /** Rå regeltekst fra kilden. */
  raw: string;
  /** GT: verified_by/confidence når kilden er ground_truth. */
  verifiedBy?: string | null;
  confidence?: number | null;
  provenance: Provenance;
}

// ── GlassSku — enhetlig SKU ──
export type GlassSkuStatus = 'verified' | 'candidate' | 'deprecated';

export interface GlassSku {
  /** Unik SKU-identifikator: leverandør-prefiks + leverandørens varenr. */
  sku: string;
  /** Autoglass-varenr når kjent (f.eks. 2525GYA). */
  varenr?: string | null;
  supplier: string;
  supplierPartNumbers: string[];
  oemPartNumbers: string[];
  eurocodes: string[];
  vehicleRules: VehicleRule[];
  attributes: GlassAttributes;
  evidence: Provenance[];
  status: GlassSkuStatus;
}

// ── Kildetyper ──
export interface GlavistaRad {
  oe?: string[];
  glavistaNr?: string;
  modell?: string;
  merke?: string;
  tinting?: string;
  props?: string;
  cal?: string;
  cert?: string[];
  alleKoder?: string[];
}

// ── Mapper: glavista-props (fritekst) → attributter (konservativt) ──
const PROP_RE: Array<[RegExp, keyof Omit<GlassAttributes, 'windshield' | 'tint'>, boolean]> = [
  [/mirror\s*boss|mirror\s*plate|adas/i, 'cameraBracket', true],
  [/\brain\b|rain\s*sensor|rain\/light|light\s*sensor/i, 'rainLightSensor', true],
  [/hud|head\s*[- ]?up/i, 'hud', true],
  [/defog|heated|heating|heat/i, 'heating', true],
  [/acoustic|acoust|insulated|akustisk/i, 'acoustic', true],
  [/antenna|aerial|diversity/i, 'antenna', true],
];

export function parseGlavistaProps(props: string | undefined): Partial<GlassAttributes> {
  const ut: Partial<GlassAttributes> = {};
  if (!props) return ut;
  for (const [re, key, verdi] of PROP_RE) {
    if (re.test(props)) ut[key] = verdi;
  }
  return ut;
}

const TINT_MAP: Array<[RegExp, string]> = [
  [/green\s*solar\s*grey|green\s*solar/i, 'GS'],
  [/green/i, 'GN'],
  [/blue/i, 'BL'],
  [/bronze/i, 'BZ'],
  [/grey|gray/i, 'GY'],
  [/clear|neutral/i, 'CL'],
];

export function glavistaTint(tinting: string | undefined): string | null {
  if (!tinting) return null;
  for (const [re, kode] of TINT_MAP) {
    if (re.test(tinting)) return kode;
  }
  return null;
}

/** Glavista-rad → GlassAttributes. Attributes som ikke nevnes forblir null (UKJENT). */
export function glavistaTilAttributes(rad: GlavistaRad): GlassAttributes {
  const fraProps = parseGlavistaProps(rad.props);
  return {
    windshield: true,
    hud: fraProps.hud ?? null,
    cameraBracket: fraProps.cameraBracket ?? null,
    rainLightSensor: fraProps.rainLightSensor ?? null,
    heating: fraProps.heating ?? null,
    acoustic: fraProps.acoustic ?? null,
    antenna: fraProps.antenna ?? null,
    tint: glavistaTint(rad.tinting),
  };
}

/** Parse årsintervall fra katalogens modelltekst («VW TRANSP+T5 2003-», «BMW 3ER F30 2011-»). */
export function parseAarIntervall(tekst: string): { from: number | null; to: number | null } {
  const m = /(\d{4})\s*[-–]\s*(\d{4}|)$/.exec(tekst) ?? /(\d{4})\s*$/.exec(tekst.replace(/[-–].*$/, ''));
  if (!m) return { from: null, to: null };
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : null;
  return { from, to: to && to > from ? to : null };
}

/** Glavista-rad → GlassSku (kandidat-status; fasit oppgraderer til verified). */
export function byggSkuFraGlavista(eurokode: string, rad: GlavistaRad): GlassSku {
  const glavistaNr = rad.glavistaNr || eurokode;
  const interval = parseAarIntervall(rad.modell || '');
  return {
    sku: `GLAVISTA:${glavistaNr}`,
    varenr: null,
    supplier: 'GLAVISTA',
    supplierPartNumbers: [glavistaNr],
    oemPartNumbers: rad.oe ?? [],
    eurocodes: [...new Set([eurokode, ...(rad.alleKoder ?? [])])],
    vehicleRules: [{
      make: (rad.merke || '').toUpperCase(),
      model: rad.modell || null,
      yearFrom: interval.from,
      yearTo: interval.to,
      source: 'glavista-index',
      raw: rad.modell || '',
      provenance: { source: 'glavista-index', sourceClass: 'INDEPENDENT_CATALOG', datasetVersion: '2026-08' },
    }],
    attributes: glavistaTilAttributes(rad),
    evidence: [{
      source: 'glavista-index',
      sourceClass: 'INDEPENDENT_CATALOG',
      sourceRecord: eurokode,
      datasetVersion: '2026-08',
      notes: `glavistaNr=${glavistaNr}${rad.cal ? `, cal=${rad.cal}` : ''}`,
    }],
    status: 'candidate',
  };
}

/** Fasit-rad (data/fasit-glass.json) → ekstra vehicleRule + verified-status for matchende SKU. */
export interface FasitRad {
  regnr?: string;
  vin?: string;
  bil?: string;
  varenr?: string;
  eurocode?: string;
  egenskaper?: string;
  listepris?: number;
  kilde?: string;
}

export function fasitTilSku(f: FasitRad): GlassSku | null {
  if (!f.eurocode && !f.varenr) return null;
  const euro = (f.eurocode || '').toUpperCase();
  const sku = f.varenr ? `AUTOGLASS:${f.varenr}` : `EUROCODE:${euro}`;
  const m = /^(.*?)\s+(\d{4})$/.exec((f.bil || '').trim());
  return {
    sku,
    varenr: f.varenr || null,
    supplier: f.varenr ? 'AUTOGLASS' : 'EUROCODE',
    supplierPartNumbers: f.varenr ? [f.varenr] : [],
    oemPartNumbers: [],
    eurocodes: euro ? [euro] : [],
    vehicleRules: [{
      make: (m ? m[1] : (f.bil || '')).toUpperCase().split(' ')[0] || '',
      model: f.bil || null,
      yearFrom: m ? parseInt(m[2], 10) : null,
      yearTo: m ? parseInt(m[2], 10) : null,
      source: 'fasit',
      raw: f.bil || '',
      verifiedBy: f.kilde || 'tom-fasit',
      confidence: 1,
      provenance: { source: 'fasit-glass.json', sourceClass: 'AUTHORITATIVE', notes: `fasit ${f.regnr || ''}` },
    }],
    attributes: {
      windshield: true,
      hud: null, cameraBracket: null, rainLightSensor: null,
      heating: null, acoustic: null, antenna: null, tint: null,
    },
    evidence: [{ source: 'fasit-glass.json', sourceClass: 'AUTHORITATIVE', notes: `fasit ${f.regnr || ''}` }],
    status: 'verified',
  };
}

/** GT-rad (ground_truth) → VehicleRule (verifisert katalogregel). */
export interface GtRad {
  make: string;
  model: string;
  year: number | null;
  frontruteEurocode?: string;
  eurocode?: string;
  verifiedBy?: string;
  confidence?: number;
  source?: string;
}

export function gtTilVehicleRule(r: GtRad): VehicleRule | null {
  const euro = (r.frontruteEurocode || r.eurocode || '').toUpperCase();
  if (!euro || !r.make) return null;
  return {
    make: r.make.toUpperCase(),
    model: r.model || null,
    yearFrom: r.year ?? null,
    yearTo: r.year ?? null,
    source: 'ground-truth',
    raw: `${r.make} ${r.model} ${r.year ?? ''}`.trim(),
    verifiedBy: r.verifiedBy || 'gt-generator',
    confidence: r.confidence ?? 0.95,
    provenance: { source: 'gt-auto-prisliste', sourceClass: 'INTERNAL_CATALOG', notes: `source=${r.source || 'gt-generator'}` },
  };
}

/** Fletter GT-regler inn i en eksisterende SKU (matcher på eurokode — ingen data mistes). */
export function leggTilGtRule(sku: GlassSku, r: VehicleRule): GlassSku {
  const finnes = sku.vehicleRules.some((v) => v.raw === r.raw && v.source === r.source);
  if (finnes) return sku;
  return { ...sku, vehicleRules: [...sku.vehicleRules, r] };
}
