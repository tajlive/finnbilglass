/**
 * fitment-v1/adapters/glavista — offline Glavista-adapter (TypeScript-port).
 * Leser den kompakte indeksen (data/glavista-index.json, bygget fra data/scrape/glavista/*.json).
 * Returnerer AMBIGUITET framfor å velge automatisk. Ingen prod-D1-skriving.
 */
import glavistaIndex from '../../../data/glavista-index.json';
import { canonicalOE, normalizeOE } from '../normalization/oe.js';
import type { SourceRecord } from '../domain.js';

export const GLAVISTA_SOURCE_RECORD: SourceRecord = {
  id: 'glavista-scrape-2026-05-17',
  provider: 'Glavista (Saint-Gobain Sekurit)',
  dataset: 'glavista.no frontrutekatalog-scrape',
  version: '2026-05-17',
  acquiredAt: '2026-05-17',
  url: 'https://www.glavista.no',
};

interface GlavistaRecord {
  oe?: string[];
  glavistaNr?: string | null;
  modell?: string | null;
  merke?: string | null;
  tinting?: string | null;
  props?: string | null;
  cal?: string | null;
  cert?: string[] | null;
  alleKoder?: string[];
}

export interface GlavistaGlass {
  eurocode: string;
  supplier: string;
  supplierSkus: { sku: string; supplier: string }[];
  r43Identifiers: string[];
  features: string[];
  rawProps: string | null;
  calibration: string | null;
  model: string | null;
  brand: string | null;
  tinting: string | null;
  oes: string[];
  allKoder: string[];
  catalogueRefs: { ref: string; url: string }[];
  sourceRecord: SourceRecord;
  sourceClass: 'INDEPENDENT_CATALOG';
}

export function featuresFromProps(props: string | null | undefined): string[] {
  if (!props) return [];
  const p = String(props).toLowerCase();
  const f: string[] = [];
  if (p.includes('acoustic')) f.push('acoustic');
  if (p.includes('sensor')) f.push('rainSensor');
  if (p.includes('camera') || p.includes('camara')) f.push('camera');
  if (p.includes('heated')) f.push('heated');
  if (p.includes('hud')) f.push('hud');
  if (p.includes('privacy')) f.push('privacy');
  if (p.includes('antenna')) f.push('antenna');
  if (p.includes('coated')) f.push('coated');
  return f;
}

export class GlavistaAdapter {
  private readonly index: Record<string, GlavistaRecord>;
  private readonly oeToEurocodes = new Map<string, Set<string>>();
  private readonly alleKoderToEurocodes = new Map<string, Set<string>>();

  constructor(index: Record<string, GlavistaRecord> = glavistaIndex as unknown as Record<string, GlavistaRecord>) {
    this.index = index;
    for (const [euro, rec] of Object.entries(index)) {
      for (const raw of rec.oe ?? []) {
        if (!raw || String(raw).toLowerCase().includes('eurocode')) continue;
        const n = canonicalOE(String(raw));
        if (!this.oeToEurocodes.has(n)) this.oeToEurocodes.set(n, new Set());
        this.oeToEurocodes.get(n)!.add(euro);
      }
      for (const k of rec.alleKoder ?? []) {
        const kk = String(k).trim().toUpperCase();
        if (!kk) continue;
        if (!this.alleKoderToEurocodes.has(kk)) this.alleKoderToEurocodes.set(kk, new Set());
        this.alleKoderToEurocodes.get(kk)!.add(euro);
      }
    }
  }

  get size(): number { return Object.keys(this.index).length; }

  lookupByOE(rawOE: string): { norm: ReturnType<typeof normalizeOE>; results: GlavistaGlass[]; note: string | null } {
    const norm = normalizeOE(rawOE, { source: 'glavista-scrape', sourceClass: 'INDEPENDENT_CATALOG', sourceRecord: GLAVISTA_SOURCE_RECORD.id });
    if (looksLikeGtinRaw(norm.rawOE)) return { norm, results: [], note: 'GTIN-lignende verdi — ikke OE-oppslag' };
    let set = this.oeToEurocodes.get(norm.normalizedOE);
    if (!set && norm.normalizedOE.startsWith('A')) set = this.oeToEurocodes.get(norm.normalizedOE.slice(1));
    if (!set) return { norm, results: [], note: 'ingen Glavista-treff' };
    return { norm, results: [...set].map((euro) => this.glassFromRecord(euro, this.index[euro])), note: null };
  }

  lookupByEurocode(euro: string): GlavistaGlass | null {
    const rec = this.index[euro];
    if (!rec) return null;
    return this.glassFromRecord(euro, rec);
  }

  lookupByAllKode(kode: string): string[] {
    const set = this.alleKoderToEurocodes.get(String(kode).trim().toUpperCase());
    return set ? [...set] : [];
  }

  glassFromRecord(euro: string, rec: GlavistaRecord): GlavistaGlass {
    return {
      eurocode: euro,
      supplier: 'Glavista (Saint-Gobain Sekurit)',
      supplierSkus: rec.glavistaNr ? [{ sku: String(rec.glavistaNr), supplier: 'Glavista' }] : [],
      r43Identifiers: (rec.cert ?? []).map((s) => String(s).trim()).filter(Boolean),
      features: featuresFromProps(rec.props),
      rawProps: rec.props ?? null,
      calibration: rec.cal ?? null,
      model: rec.modell ?? null,
      brand: rec.merke ?? null,
      tinting: rec.tinting ?? null,
      oes: rec.oe ?? [],
      allKoder: rec.alleKoder ?? [],
      catalogueRefs: [{ ref: `glavista.no → ${euro}`, url: `https://www.glavista.no/search?eurocode=${euro}` }],
      sourceRecord: GLAVISTA_SOURCE_RECORD,
      sourceClass: 'INDEPENDENT_CATALOG',
    };
  }
}

function looksLikeGtinRaw(raw: string): boolean {
  return /^0{4,5}\d{8,9}$/.test(raw);
}
