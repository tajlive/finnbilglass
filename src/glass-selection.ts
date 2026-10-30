export type GlassSide = 'left' | 'right' | 'unknown';
export type GlassKind = 'windshield' | 'door' | 'side' | 'rear' | 'roof' | 'unknown';

export type GlassSelection =
  | { kind: 'windshield' }
  | { kind: 'door'; side: GlassSide; door: 'front' | 'rear' | 'sliding' | 'unknown' }
  | { kind: 'side'; side: GlassSide; section: 'front_quarter' | 'rear_quarter' | 'cargo' | 'unknown'; mounting: 'body' | 'door' | 'unknown' }
  | { kind: 'rear'; layout: 'single' | 'split' | 'unknown'; splitSide?: GlassSide }
  | { kind: 'roof'; system: 'fixed' | 'opening' | 'unknown'; panel: 'whole' | 'front' | 'middle' | 'rear' | 'unknown' }
  | { kind: 'unknown' };

export type GlassAnswerKey = 'construction' | 'privacyTint' | 'heating' | 'antenna' | 'acoustic';
export type GlassAnswer = boolean | 'laminated' | 'tempered' | 'unknown' | null;
export interface GlassRequest {
  schemaVersion: 1;
  selection: GlassSelection;
  answers: Partial<Record<GlassAnswerKey, GlassAnswer>>;
  searchId?: string;
}

const ANSWER_KEYS = new Set<GlassAnswerKey>(['construction', 'privacyTint', 'heating', 'antenna', 'acoustic']);
const COMMON = new Set(['kind']);
const enumValue = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseGlassSelection(input: unknown): GlassSelection | null {
  if (!record(input) || typeof input.kind !== 'string') return null;
  switch (input.kind) {
    case 'windshield':
      return Object.keys(input).every(k => COMMON.has(k)) ? { kind: 'windshield' } : null;
    case 'door':
      return Object.keys(input).every(k => ['kind', 'side', 'door'].includes(k))
        && enumValue(input.side, ['left', 'right', 'unknown'])
        && enumValue(input.door, ['front', 'rear', 'sliding', 'unknown'])
        ? { kind: 'door', side: input.side as GlassSide, door: input.door as 'front' | 'rear' | 'sliding' | 'unknown' } : null;
    case 'side':
      return Object.keys(input).every(k => ['kind', 'side', 'section', 'mounting'].includes(k))
        && enumValue(input.side, ['left', 'right', 'unknown'])
        && enumValue(input.section, ['front_quarter', 'rear_quarter', 'cargo', 'unknown'])
        && enumValue(input.mounting, ['body', 'door', 'unknown'])
        ? { kind: 'side', side: input.side as GlassSide, section: input.section as 'front_quarter' | 'rear_quarter' | 'cargo' | 'unknown', mounting: input.mounting as 'body' | 'door' | 'unknown' } : null;
    case 'rear':
      return Object.keys(input).every(k => ['kind', 'layout', 'splitSide'].includes(k))
        && enumValue(input.layout, ['single', 'split', 'unknown'])
        && ((input.layout === 'split' && enumValue(input.splitSide, ['left', 'right', 'unknown']))
          || (input.layout !== 'split' && input.splitSide === undefined))
        ? { kind: 'rear', layout: input.layout as 'single' | 'split' | 'unknown', ...(input.layout === 'split' ? { splitSide: input.splitSide as GlassSide } : {}) } : null;
    case 'roof':
      return Object.keys(input).every(k => ['kind', 'system', 'panel'].includes(k))
        && enumValue(input.system, ['fixed', 'opening', 'unknown'])
        && enumValue(input.panel, ['whole', 'front', 'middle', 'rear', 'unknown'])
        ? { kind: 'roof', system: input.system as 'fixed' | 'opening' | 'unknown', panel: input.panel as 'whole' | 'front' | 'middle' | 'rear' | 'unknown' } : null;
    case 'unknown':
      return Object.keys(input).every(k => COMMON.has(k)) ? { kind: 'unknown' } : null;
    default: return null;
  }
}

export function parseGlassRequest(input: unknown): GlassRequest | null {
  if (!record(input) || Object.keys(input).some(k => !['schemaVersion', 'selection', 'answers', 'searchId'].includes(k))) return null;
  if (input.schemaVersion !== 1) return null;
  const selection = parseGlassSelection(input.selection);
  if (!selection || !record(input.answers)) return null;
  const answers: GlassRequest['answers'] = {};
  if (Object.keys(input.answers).length > ANSWER_KEYS.size) return null;
  for (const [key, value] of Object.entries(input.answers)) {
    if (!ANSWER_KEYS.has(key as GlassAnswerKey)) return null;
    if (!(typeof value === 'boolean' || value === null || enumValue(value, ['laminated', 'tempered', 'unknown']))) return null;
    answers[key as GlassAnswerKey] = value as GlassAnswer;
  }
  if (input.searchId !== undefined && (typeof input.searchId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(input.searchId))) return null;
  return { schemaVersion: 1, selection, answers, ...(input.searchId ? { searchId: input.searchId } : {}) };
}

export function normalizeGlassRequest(request: GlassRequest): string {
  const answerKeys = Object.keys(request.answers).sort() as GlassAnswerKey[];
  const answers: GlassRequest['answers'] = {};
  for (const key of answerKeys) answers[key] = request.answers[key];
  return JSON.stringify({ schemaVersion: 1, selection: request.selection, answers });
}

export function glassSelectionLabel(selection: GlassSelection): string {
  const side = selection.kind === 'door' || selection.kind === 'side' ? (selection.side === 'left' ? 'Venstre' : selection.side === 'right' ? 'Høyre' : 'Ukjent side') : '';
  switch (selection.kind) {
    case 'windshield': return 'Frontrute';
    case 'door': return `Dørrute · ${side} · ${selection.door === 'front' ? 'foran' : selection.door === 'rear' ? 'bak' : selection.door === 'sliding' ? 'skyvedør' : 'ukjent dør'}`;
    case 'side': return `Siderute · ${side} · ${selection.section} · ${selection.mounting}`;
    case 'rear': return `Bakrute · ${selection.layout === 'split' ? `delt, ${selection.splitSide}` : selection.layout === 'single' ? 'hel' : 'ukjent utførelse'}`;
    case 'roof': return `Panorama-/takglass · ${selection.system} · ${selection.panel}`;
    case 'unknown': return 'Ukjent glasstype';
  }
}
