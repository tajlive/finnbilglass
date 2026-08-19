/**
 * approval/decisions.ts — operatør-beslutninger i ops-center (Oppgave 3 + 4).
 *
 * Beslutningstyper:
 *   approve_sku             — policy-gate: kun når approvalPolicy gir approved
 *                             (1 kandidat + ingen konflikt). Skriver override.
 *   choose_alternative_sku  — operatørens EKSPLISITTE valg blant 2+ kandidater
 *                             (menneskelig kontroll, append-only logget).
 *                             Skriver override.
 *   request_better_image    — ber om bedre bevis; ingen fitment-endring.
 *   reject                  — avslår saken; ingen fitment-endring.
 *
 * Alle beslutninger logges i case_sku_decisions; overrides logges i tillegg i
 * evidence_events (hard regel 5: kilde, tidspunkt, godkjent_av).
 */
import type { GlassAttributes, GlassSku } from '../fitment-v1/glass-sku.js';
import { approvalPolicy, attributkonflikter, type ApprovalVurdering } from './policy.js';
import type { ManualOverride } from './overrides.js';

export type BeslutningType = 'approve_sku' | 'request_better_image' | 'choose_alternative_sku' | 'reject';

export interface BeslutningInput {
  caseId: string;
  decision: BeslutningType;
  sku?: string | null;
  eurocode?: string | null;
  reason?: string | null;
  actor: string;
}

export interface OverrideSkrivInput {
  vin?: string | null;
  make: string;
  modelSeries?: string | null;
  attrs?: Partial<GlassAttributes>;
  sku: string;
  eurocode?: string | null;
  actor: string;
  notes?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface BeslutningResultat {
  ok: boolean;
  status?: string;          // sak-status etter beslutning
  approval?: ApprovalVurdering;
  overrideId?: number;
  error?: string;
}

/** Mapper resolver-kandidat (vehicle_json-snapshot) → GlassSku for policy-sjekk. */
export function snapshotKandidatTilSku(k: Record<string, unknown>): GlassSku {
  const a = (k.attributter ?? {}) as Record<string, unknown>;
  const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  return {
    sku: `AUTOGLASS:${String(k.varenr ?? '')}`,
    varenr: (k.varenr as string | null) ?? null,
    supplier: 'AUTOGLASS',
    supplierPartNumbers: [],
    oemPartNumbers: [],
    eurocodes: k.eurokode ? [String(k.eurokode)] : [],
    vehicleRules: [],
    attributes: {
      windshield: true,
      hud: b(a.hud),
      cameraBracket: b(a.kamera) ?? b(a.adas),
      rainLightSensor: b(a.sensor),
      heating: b(a.oppvarmet),
      acoustic: b(a.acoustic),
      antenna: b(a.antenne),
      tint: (a.fargetone as string | null) ?? null,
    },
    evidence: [],
    status: 'candidate',
  };
}

/** Skriv manual_review_overrides + evidence_events-rad (append-only, sporbar). */
export async function skrivOverride(
  env: { FINNBILGLASS_DB: D1Database },
  o: OverrideSkrivInput,
): Promise<{ overrideId: number }> {
  const attrs = o.attrs ? JSON.stringify(o.attrs) : null;
  const res = await env.FINNBILGLASS_DB.prepare(
    `INSERT INTO manual_review_overrides
       (vin_prefix, make, model_series, valid_from, valid_to, attributes_json,
        approved_sku, eurocode, source, approved_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual_review', ?, ?)`,
  )
    .bind(
      o.vin ? o.vin.slice(0, 6).toUpperCase() : null,
      o.make.toUpperCase(),
      o.modelSeries ?? null,
      o.validFrom ?? null,
      o.validTo ?? null,
      attrs,
      o.sku,
      o.eurocode ?? null,
      o.actor,
      o.notes ?? null,
    )
    .run();
  const overrideId = Number(res.meta.last_row_id);

  // Hard regel 5: evidensledger-rad med kilde/tidspunkt/godkjent_av.
  const now = Math.floor(Date.now() / 1000);
  const hashInput = `${o.make}|${o.modelSeries ?? ''}|${o.sku}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.FINNBILGLASS_DB.prepare(
    `INSERT INTO evidence_events
       (id, vehicle_identity_hash, created_at, source_type, evidence_type,
        value, confidence, status, created_by, candidate_varenr, notes)
     VALUES (?, ?, ?, 'MONTOR', 'OTHER', ?, 100, 'VERIFIED', 'installer', ?, ?)`,
  )
    .bind(
      `evt-mro-${overrideId}-${now}`,
      hash,
      now,
      o.sku,
      o.eurocode ?? null,
      `manual_review override godkjent_av=${o.actor}${o.notes ? ` — ${o.notes}` : ''}`,
    )
    .run();

  return { overrideId };
}

/** Logg beslutningen append-only i case_sku_decisions. */
export async function skrivBeslutning(
  env: { FINNBILGLASS_DB: D1Database },
  b: BeslutningInput,
): Promise<void> {
  await env.FINNBILGLASS_DB.prepare(
    `INSERT INTO case_sku_decisions (case_id, decision_type, sku, eurocode, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(b.caseId, b.decision, b.sku ?? null, b.eurocode ?? null, b.reason ?? null, b.actor)
    .run();
}

/**
 * Policy-gate for «godkjenn SKU»: approved KUN når approvalPolicy gir approved.
 * Returnerer needs_verification med grunn — operatøren må da bruke
 * choose_alternative_sku (eksplisitt valg) eller be om bedre bevis.
 */
export function godkjenningsGate(
  kandidater: GlassSku[],
  bevis: Partial<GlassAttributes>,
): ApprovalVurdering {
  const konflikter = attributkonflikter(kandidater, bevis);
  return approvalPolicy(kandidater, true, konflikter);
}
