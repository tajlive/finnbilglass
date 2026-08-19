/**
 * Fase A — Operations Center-konsolidering.
 *
 * Én «sak» = én kundereise. En kunde kan i samme besøk generere både en
 * henvendelse (beta_inquiries) og en evidenssak (evidence_cases); de deler
 * session_id (frontend localStorage). Her samles de til én sak slik at
 * operatøren ser hele reisen på ett sted.
 *
 * Ren logikk, ingen D1-binding — enhetstestes deterministisk.
 */

export interface InquiryRow {
  id: number;
  regnr: string | null;
  navn: string;
  kontakt: string;
  melding: string | null;
  status: string;
  assigned_to: string | null;
  vehicle_json: string | null;
  session_id: string | null;
  created_at: number | string;
  updated_at: number | null;
}

export interface EvidenceCaseRow {
  case_id: string;
  registration_hash: string;
  session_id: string | null;
  status: string;
  created_at: number;
  image_count: number;
}

export interface KonsolidertSak {
  key: string; // stabil: 'inquiry-<id>' eller 'evidence-<case_id>'
  kind: 'inquiry' | 'evidence';
  regnr: string | null;
  navn: string | null;
  kontakt: string | null;
  melding: string | null;
  status: string;
  inquiryId: number | null;
  evidenceCaseIds: string[];
  imageCount: number;
  assignedTo: string | null;
  createdAt: number;
  updatedAt: number | null;
  /** Resolver-utfall: PINPOINT / VERIFY / FALLBACK / null (ukjent/evidence-only). */
  resolverUtfall: string | null;
  /** Antall kandidater fra resolver-snapshot (0 = ingen). */
  kandidatantall: number;
  /** Arbeids-prioritet: 0 = mest arbeid (FALLBACK), 3 = minst (PINPOINT/ukjent). */
  prioritet: number;
}

/** Normaliser kjennemerke for sammenligning (SVV-format: 2 bokstaver + 5 siffer). */
export function normaliserRegnr(regnr: string | null | undefined): string {
  if (!regnr) return '';
  return regnr.toUpperCase().replace(/[\s\-–—.]+/g, '');
}

function tilEpoch(v: number | string): number {
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** Resolver-utfall + kandidatantall fra et frosset vehicle_json-snapshot. */
function utfallFraSnapshot(vehicleJson: string | null): { utfall: string | null; kandidater: number } {
  if (!vehicleJson) return { utfall: null, kandidater: 0 };
  try {
    const v = JSON.parse(vehicleJson) as { resolver?: { utfall?: string; kandidater?: unknown[] } };
    return {
      utfall: typeof v.resolver?.utfall === 'string' ? v.resolver.utfall : null,
      kandidater: Array.isArray(v.resolver?.kandidater) ? v.resolver.kandidater.length : 0,
    };
  } catch {
    return { utfall: null, kandidater: 0 };
  }
}

function arbeidsPrioritet(utfall: string | null, kandidater: number, kind: 'inquiry' | 'evidence'): number {
  if (kind === 'evidence') return 1; // bilder uten henvendelse → trenger manuell vurdering
  if (utfall === 'FALLBACK') return 0; // mest arbeid
  if (utfall === 'VERIFY') return 1;
  if (utfall === 'PINPOINT') return 2; // minst arbeid
  return kandidater > 1 ? 1 : 3; // ukjent utfall: med kandidater → vurder, uten → sist
}

/**
 * Konsolider inquiries + evidence cases til én saksliste.
 * Match-nøkkel: session_id (begge ikke-null og like). Evidence uten match
 * blir egen sak. Sortert nyest-først.
 */
export function konsoliderSaker(
  inquiries: InquiryRow[],
  evidenceCases: EvidenceCaseRow[],
): KonsolidertSak[] {
  const saker = new Map<string, KonsolidertSak>();

  // 1. Inquiries er primær-enheten.
  for (const i of inquiries) {
    const createdAt = tilEpoch(i.created_at);
    const snap = utfallFraSnapshot(i.vehicle_json);
    saker.set(`inquiry-${i.id}`, {
      key: `inquiry-${i.id}`,
      kind: 'inquiry',
      regnr: i.regnr,
      navn: i.navn,
      kontakt: i.kontakt,
      melding: i.melding,
      status: i.status,
      inquiryId: i.id,
      evidenceCaseIds: [],
      imageCount: 0,
      assignedTo: i.assigned_to,
      createdAt,
      updatedAt: i.updated_at ?? null,
      resolverUtfall: snap.utfall,
      kandidatantall: snap.kandidater,
      prioritet: arbeidsPrioritet(snap.utfall, snap.kandidater, 'inquiry'),
    });
  }

  // 2. Koble evidence cases via session_id.
  const inquiryBySession = new Map<string, number>();
  for (const i of inquiries) {
    if (i.session_id) inquiryBySession.set(i.session_id, i.id);
  }

  for (const e of evidenceCases) {
    const match = e.session_id ? inquiryBySession.get(e.session_id) : undefined;
    if (match !== undefined) {
      const sak = saker.get(`inquiry-${match}`);
      if (sak) {
        sak.evidenceCaseIds.push(e.case_id);
        sak.imageCount += e.image_count;
        if (e.created_at > (sak.updatedAt ?? -1)) sak.updatedAt = e.created_at;
        continue;
      }
    }
    // Ingen match → egen evidenssak (kunden sendte bilder men ingen henvendelse).
    saker.set(`evidence-${e.case_id}`, {
      key: `evidence-${e.case_id}`,
      kind: 'evidence',
      regnr: null,
      navn: null,
      kontakt: null,
      melding: null,
      status: e.status,
      inquiryId: null,
      evidenceCaseIds: [e.case_id],
      imageCount: e.image_count,
      assignedTo: null,
      createdAt: e.created_at,
      updatedAt: null,
      resolverUtfall: null,
      kandidatantall: 0,
      prioritet: 1,
    });
  }

  // Prioriter: mest arbeid først (FALLBACK→VERIFY→PINPOINT), deretter eldst først.
  return [...saker.values()].sort((a, b) => a.prioritet - b.prioritet || a.createdAt - b.createdAt);
}
