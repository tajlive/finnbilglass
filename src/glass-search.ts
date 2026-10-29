import { aliasMerke } from './svv';
import { normalizeGlassRequest, type GlassRequest, type GlassSelection } from './glass-selection';

export interface GlassVehicle { merke: string; modell: string; vin?: string | null; aar?: number | null; generation?: string | null; bodyVariant?: string | null; }
export interface GlassSearchCandidate { candidateId: string; partNumber: string; manufacturer: string | null; kind: string; }
export interface GlassSearchResult {
  status: 'NEEDS_DETAILS' | 'CANDIDATES' | 'MANUAL_REVIEW';
  selection: GlassSelection;
  candidates: GlassSearchCandidate[];
  questions: string[];
  truncated: boolean;
  message: string;
  catalogVersion: string;
}

export async function glassRequestFingerprint(regnr: string, request: GlassRequest): Promise<string> {
  const bytes = new TextEncoder().encode(`${regnr.toUpperCase().replace(/[\s\-–—.]+/g, '')}\0${normalizeGlassRequest(request)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

function needsDetails(selection: GlassSelection): string[] {
  switch (selection.kind) {
    case 'door': return [ ...(selection.side === 'unknown' ? ['side'] : []), ...(selection.door === 'unknown' ? ['door'] : []) ];
    case 'side': return [ ...(selection.side === 'unknown' ? ['side'] : []), ...(selection.section === 'unknown' ? ['section'] : []), ...(selection.mounting === 'unknown' ? ['mounting'] : []) ];
    case 'rear': return selection.layout === 'unknown' || (selection.layout === 'split' && selection.splitSide === 'unknown') ? ['layout_or_split_side'] : [];
    case 'roof': return [ ...(selection.system === 'unknown' ? ['system'] : []), ...(selection.panel === 'unknown' ? ['panel'] : []) ];
    case 'unknown': return ['kind'];
    case 'windshield': return [];
  }
}

function stableSelection(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]])));
}

function answersMatch(answer: GlassRequest['answers'], attributes: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(answer)) {
    if (expected == null || expected === 'unknown') continue;
    const actual = attributes[key];
    if (actual !== undefined && actual !== null && actual !== 'unknown' && actual !== expected) return false;
  }
  return true;
}

export async function searchGlass(db: D1Database, vehicle: GlassVehicle | null, request: GlassRequest): Promise<GlassSearchResult> {
  const catalogVersion = 'multi-glass-v1';
  const selection = request.selection;
  const missing = needsDetails(selection);
  if (missing.length) return {
    status: 'NEEDS_DETAILS', selection, candidates: [], questions: missing, truncated: false,
    message: 'Velg side og plassering, eller send forespørselen til manuell kontroll.', catalogVersion,
  };
  if (selection.kind === 'windshield') return {
    status: 'MANUAL_REVIEW', selection, candidates: [], questions: [], truncated: false,
    message: 'Frontruten håndteres gjennom det eksisterende frontrutesøket.', catalogVersion,
  };
  if (!vehicle?.merke || !vehicle.modell || !vehicle.vin || !vehicle.generation || !vehicle.bodyVariant) return {
    status: 'MANUAL_REVIEW', selection, candidates: [], questions: [], truncated: false,
    message: 'Vi fikk ikke bekreftet bilgenerasjon og karosseri. Vi kontrollerer glasset manuelt.', catalogVersion,
  };
  const searchYear = vehicle.aar;
  if (typeof searchYear !== 'number' || !Number.isInteger(searchYear) || searchYear < 1900 || searchYear > 2100) return {
    status: 'MANUAL_REVIEW', selection, candidates: [], questions: [], truncated: false,
    message: 'Bilens år er ikke tilgjengelig. Vi kontrollerer forespørselen manuelt.', catalogVersion,
  };
  const kind = selection.kind;
  const make = aliasMerke(vehicle.merke).trim().toUpperCase().replace(/\s+/g, ' ');
  const model = vehicle.modell.trim().toUpperCase().replace(/\s+/g, ' ');
  const generation = vehicle.generation.trim().toUpperCase().replace(/\s+/g, ' ');
  const bodyVariant = vehicle.bodyVariant.trim().toUpperCase().replace(/\s+/g, ' ');
  const rows = await db.prepare(`SELECT i.item_id, i.part_number, i.manufacturer, i.position_json, i.attributes_json,
      i.source_version, a.body_variant
    FROM glass_vehicle_applications a
    JOIN glass_catalog_items i ON i.item_id = a.item_id
    WHERE i.glass_kind = ? AND i.classification = 'verified' AND i.public_use_allowed = 1 AND i.is_current = 1
      AND a.classification = 'verified' AND a.is_current = 1 AND a.make_key = ? AND a.model_key = ?
      AND a.generation_key = ? AND a.year_from IS NOT NULL AND a.year_from <= ? AND a.year_to IS NOT NULL AND a.year_to >= ?
      AND a.body_variant = ? AND a.market IN ('NO','EU','GLOBAL')
    LIMIT 201`).bind(kind, make, model, generation, searchYear, searchYear, bodyVariant).all<{
      item_id: string; part_number: string; manufacturer: string | null; position_json: string;
      attributes_json: string; source_version: string; body_variant: string | null;
    }>();
  const matchable = (rows.results ?? []).filter(row => {
    try {
      if (stableSelection(JSON.parse(row.position_json)) !== stableSelection(selection)) return false;
      const attributes = JSON.parse(row.attributes_json) as Record<string, unknown>;
      return answersMatch(request.answers, attributes);
    } catch { return false; }
  });
  const truncated = matchable.length > 20 || (rows.results?.length ?? 0) > 200;
  const candidates = matchable.slice(0, 20).map(row => ({
    candidateId: row.item_id, partNumber: row.part_number, manufacturer: row.manufacturer, kind,
  }));
  if (!candidates.length) return {
    status: 'MANUAL_REVIEW', selection, candidates: [], questions: [], truncated: false,
    message: 'Vi har ikke et dokumentert katalogtreff for denne bilen og plasseringen. Vi kontrollerer forespørselen manuelt.', catalogVersion,
  };
  return {
    status: 'CANDIDATES', selection, candidates, questions: [], truncated,
    message: 'Mulige treff fra dokumentert kataloggrunnlag. Vi bekrefter glasset før tilbud.', catalogVersion,
  };
}
