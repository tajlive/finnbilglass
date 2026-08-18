/**
 * fitment-v1/differentiation — informasjonsgevinst-spørsmålsmotor.
 * Spørsmål utledes KUN fra kandidatforskjeller. Irrelevante spørsmål er forbudt:
 * et spørsmål er irrelevant hvis svaret ikke kan endre fitment eller ordrekonfigurasjon.
 */
import type { Candidate } from './domain.js';

export interface Differentiator {
  feature: string;
  values: (string | boolean | null)[];
  distinctCount: number;
  /** True hvis svaret kan skille kandidater (≥2 distinkte verdier) */
  informative: boolean;
}

export interface EvidenceRequest {
  feature: string;
  question: string;
  modality: 'YES_NO' | 'PHOTO' | 'IDENTIFIER' | 'MANUAL';
  photoInstruction?: string | null;
  candidateImpact: string;
}

/** Strukturert feature-profil per kandidat (funnet i katalog + Glavista-props). */
export function candidateFeatureProfile(c: Candidate): Record<string, string | boolean | null> {
  const f: Record<string, string | boolean | null> = {};
  for (const feat of c.features ?? []) f[feat] = true;
  const g = c.glavista as { features?: string[]; calibration?: string; oes?: string[] } | null | undefined;
  if (g) {
    for (const p of g.features ?? []) f[p] = true;
    if (g.calibration === 'Yes') f.calibrated = true;
    if ((g.oes?.length ?? 0) > 0) f.OE = true;
  }
  if (c.variant) f.variant = c.variant;
  return f;
}

const FEATURE_LABELS: Record<string, string> = {
  rainSensor: 'regnsensor',
  camera: 'ADAS-kamera',
  cameraBracket: 'kamerafeste',
  sensorBracket: 'sensorhus',
  sensor: 'sensor',
  heated: 'varme',
  acoustic: 'akustisk',
  coated: 'coated (IR/solar)',
  antenna: 'antenne',
  tint: 'farge/sjatter',
  shadeBand: 'sjatterbånd',
  moulding: 'innkapslet list',
  calibrated: 'kalibrering',
  variant: 'variant',
  OE: 'OE-revisjon',
};

/**
 * Finn informasjonsrike skiller mellom gjenstående kandidater.
 * Spørsmål genereres KUN for features der kandidatene faktisk skiller seg.
 */
export function candidateDifferences(candidates: Candidate[]): Differentiator[] {
  const profiles = candidates.map(candidateFeatureProfile);
  const allFeatures = new Set<string>();
  for (const p of profiles) for (const k of Object.keys(p)) allFeatures.add(k);
  const out: Differentiator[] = [];
  for (const feature of allFeatures) {
    const values = profiles.map((p) => p[feature] ?? null);
    const distinct = new Set(values.map((v) => String(v)));
    const informative = distinct.size >= 2;
    out.push({ feature, values, distinctCount: distinct.size, informative });
  }
  return out.sort((a, b) => (b.informative ? 1 : 0) - (a.informative ? 1 : 0));
}

/** Spørre-motor: KUN informative skiller → spørsmål. ALDRI generiske glass-spørsmål. */
export function buildEvidenceRequests(candidates: Candidate[], photoEnabled = true): EvidenceRequest[] {
  const diffs = candidateDifferences(candidates);
  const out: EvidenceRequest[] = [];
  for (const d of diffs) {
    if (!d.informative) continue;
    if (d.feature === 'OE') {
      out.push({
        feature: 'OE', question: 'Kan du lese merkingen på ruta? (OE-nummer i hjørnet)', modality: 'IDENTIFIER',
        candidateImpact: 'OE-revisjonen skiller variantene', photoInstruction: photoEnabled ? 'Ta nærbilde av merkingen nederst i hjørnet av frontruten.' : null,
      });
      continue;
    }
    const label = FEATURE_LABELS[d.feature] ?? d.feature;
    out.push({
      feature: d.feature,
      question: `Har bilen ${label}?`,
      modality: 'YES_NO',
      candidateImpact: `skiller ${d.distinctCount} konfigurasjoner`,
      photoInstruction: photoEnabled && (d.feature === 'camera' || d.feature === 'cameraBracket' || d.feature === 'sensor' || d.feature === 'sensorBracket') ? 'Ta et bilde av området bak innvendig speil.' : null,
    });
  }
  return out;
}

/** Irrelevans-sjekk: spørsmålet endrer verken fitment eller ordrekonfigurasjon? */
export function isIrrelevantQuestion(q: EvidenceRequest, candidates: Candidate[]): boolean {
  if (q.feature === 'OE') return !candidates.some((c) => (c.glavista as { oes?: string[] } | null | undefined)?.oes?.length);
  const diffs = candidateDifferences(candidates).find((d) => d.feature === q.feature);
  return !(diffs?.informative ?? false);
}
