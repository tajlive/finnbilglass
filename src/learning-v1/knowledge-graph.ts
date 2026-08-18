/**
 * learning-v1/knowledge-graph — C10 Phase 1: Glass Knowledge Graph (rent domene, ingen D1/I/O).
 * «Ikke en grafdatabase — relasjonstabeller i D1, traversert deterministisk.»
 *
 * Binder hele kjeden i én traversering:
 *   Vehicle (SVV-truth) → kandidatglass (katalog/Glavista) → OE → Evidence Ledger
 *   → C8.4 Quality Score → EXACT/AMBIGUOUS/UNKNOWN → explainDecision.
 *
 * Evidence Ledger er ENESTE sannhetskilde. Katalog foreslår (0 poeng), evidens bestemmer.
 * WRONG_GLASS eliminerer. Én kandidat ≠ bevis — uten autoritativ evidens blir det aldri EXACT.
 */
import type { LedgerEvent, FixtureRecord } from './evidence-ledger.js';
import { evidenceQualityScore, explainQualityScore, type EvidenceQualityResult } from './quality-score.js';
import { canonicalOE } from '../fitment-v1/normalization/oe.js';

// ── Graf-noder ──

export interface GraphVehicle {
  /** sha256 av kjennemerke (personvern — aldri rå regnr i grafen). */
  identityHash: string;
  /** Kun for visning i forklaring. */
  registrationNumber: string;
  make: string;
  model: string;
  generation: string | null;
  modelYear: number | null;
}

export interface GraphCandidate {
  eurocode: string;
  varenr: string | null;
  features: string[];
  /** OE-koder dette glasset matcher (fra Glavista/OE-indeks). */
  oes: string[];
}

export interface CandidateResolution {
  eurocode: string;
  varenr: string | null;
  /** Matcher observert OE (om noen). */
  oeMatch: boolean;
  eliminated: boolean;
  eliminateReason: string | null;
  /** C8.4-kvalitetsscore for denne kandidaten. */
  quality: EvidenceQualityResult;
  installedCount: number;
  wrongGlassCount: number;
  relevantEvents: LedgerEvent[];
  relevantFixtures: FixtureRecord[];
}

export interface GraphTraversalResult {
  vehicle: GraphVehicle;
  fitmentStatus: 'EXACT' | 'AMBIGUOUS' | 'UNKNOWN';
  selectedGlass: string | null;
  selectedVarenr: string | null;
  qualityScore: number | null;
  qualityMax: number;
  candidates: CandidateResolution[];
  eliminations: { eurocode: string; varenr: string | null; reason: string }[];
  /** Full norsk audit-trail (evidens + installasjonshistorikk + eliminasjoner). */
  explanation: string;
}

/** Sterkeste OE-observasjon: OE_IMAGE (bilde) > CUSTOMER (lesning) > andre. */
function strongestOE(events: LedgerEvent[]): { value: string; sourceType: string } | null {
  const oes = events.filter(
    (e) => e.evidenceType === 'OE' && (e.status === 'CONFIRMED' || e.status === 'VERIFIED') && e.createdBy !== 'ai',
  );
  if (oes.length === 0) return null;
  const image = oes.find((e) => e.sourceType === 'OE_IMAGE');
  if (image) return { value: image.value, sourceType: 'OE_IMAGE' };
  const customer = oes.find((e) => e.sourceType === 'CUSTOMER');
  if (customer) return { value: customer.value, sourceType: 'CUSTOMER' };
  return { value: oes[0].value, sourceType: oes[0].sourceType };
}

/**
 * traverseKnowledgeGraph — deterministisk graf-traversering av hele beviskjeden.
 * Ren funksjon: samme input gir alltid samme output (replay-sikker).
 */
export function traverseKnowledgeGraph(opts: {
  vehicle: GraphVehicle;
  candidates: GraphCandidate[];
  events: LedgerEvent[];
  fixtures: FixtureRecord[];
}): GraphTraversalResult {
  const { vehicle, candidates, events, fixtures } = opts;

  // 1. OE-observasjon (om noen) — autoritativ evidens som skiller kandidater.
  const oe = strongestOE(events);
  const oeCanon = oe ? canonicalOE(oe.value) : null;

  // 2. Kandidat-oppløsning: kvalitetsscore + eliminasjon.
  const resolutions: CandidateResolution[] = candidates.map((c) => {
    const oeMatch = Boolean(oeCanon && c.oes.some((o) => canonicalOE(o) === oeCanon));

    const relevantFixtures = fixtures.filter((f) => f.candidateVarenr === c.varenr);
    // OE-evidens gjelder kandidaten som MATCHER OE; feature-bekreftelse (kunde) gjelder glasset som HAR feature-en;
    // øvrig evidens kobles via candidateVarenr.
    const relevantEvents = events.filter((e) => {
      if (e.candidateVarenr === c.varenr) return true;                          // direkte varenr-kobling
      if (e.evidenceType === 'OE' && oeMatch) return true;                      // OE peker på dette glasset
      if (e.candidateVarenr === null && e.sourceType === 'CUSTOMER' && c.features.includes(String(e.evidenceType).toLowerCase())) return true; // kunde bekreftet feature glasset har
      return false;
    });

    const quality = evidenceQualityScore(relevantEvents, relevantFixtures);
    const installedCount = relevantFixtures.filter((f) => f.outcome === 'INSTALLED_SUCCESSFULLY' && f.status !== 'REJECTED').length;
    const wrongGlassCount = relevantFixtures.filter((f) => f.outcome === 'WRONG_GLASS' && f.status !== 'REJECTED').length;

    let eliminated = quality.eliminated; // WRONG_GLASS eliminerer
    let eliminateReason = quality.eliminateReason;

    // OE-eliminasjon: observerer OE X som matcher ett glass → andre glass elimineres.
    if (!eliminated && oeCanon && oeMatch === false) {
      const matchedEurocode = candidates.find((k) => k.oes.some((o) => canonicalOE(o) === oeCanon))?.eurocode;
      eliminated = matchedEurocode !== undefined; // kun hvis OE faktisk peker på et kjent glass
      if (eliminated) {
        eliminateReason = `OE ${oe!.value} matcher ikke dette glasset${matchedEurocode ? ` (matcher ${matchedEurocode})` : ''}`;
      }
    }

    return { eurocode: c.eurocode, varenr: c.varenr, oeMatch, eliminated, eliminateReason, quality, installedCount, wrongGlassCount, relevantEvents, relevantFixtures };
  });

  const eliminations = resolutions.filter((r) => r.eliminated).map((r) => ({ eurocode: r.eurocode, varenr: r.varenr, reason: r.eliminateReason! }));
  const remaining = resolutions.filter((r) => !r.eliminated);

  // 3. EXACT-beslutning (konservativ — én kandidat ≠ bevis).
  let fitmentStatus: GraphTraversalResult['fitmentStatus'] = 'UNKNOWN';
  let selectedGlass: string | null = null;
  let selectedVarenr: string | null = null;
  let qualityScore: number | null = null;

  if (remaining.length === 1) {
    const only = remaining[0];
    const hasAuthoritativeEvidence =
      only.installedCount >= 3 ||                                          // korroberte installasjoner
      (only.oeMatch && only.quality.score >= 50);                          // OE-bekreftelse (bilde → +50)
    if (hasAuthoritativeEvidence) {
      fitmentStatus = 'EXACT';
      selectedGlass = only.eurocode;
      selectedVarenr = only.varenr;
      qualityScore = only.quality.score;
    }
    // else: én kandidat uten autoritativ evidens → UNKNOWN (aldri auto-EXACT).
  } else if (remaining.length > 1) {
    fitmentStatus = 'AMBIGUOUS';
  }

  // 4. Forklaring (audit-trail).
  const explanation = buildExplanation({ vehicle, oe, resolutions, remaining, fitmentStatus, selectedGlass, selectedVarenr, qualityScore });

  return {
    vehicle,
    fitmentStatus,
    selectedGlass,
    selectedVarenr,
    qualityScore,
    qualityMax: 150,
    candidates: resolutions,
    eliminations,
    explanation,
  };
}

function buildExplanation(input: {
  vehicle: GraphVehicle;
  oe: { value: string; sourceType: string } | null;
  resolutions: CandidateResolution[];
  remaining: CandidateResolution[];
  fitmentStatus: GraphTraversalResult['fitmentStatus'];
  selectedGlass: string | null;
  selectedVarenr: string | null;
  qualityScore: number | null;
}): string {
  const { vehicle, oe, resolutions, remaining, fitmentStatus, selectedGlass, selectedVarenr, qualityScore } = input;
  const lines: string[] = [];

  lines.push(`Kjøretøy: ${vehicle.make} ${vehicle.model}${vehicle.generation ? ' ' + vehicle.generation : ''}${vehicle.modelYear ? ' ' + vehicle.modelYear : ''} (${vehicle.registrationNumber})`);

  if (oe) {
    lines.push(`OE-observasjon: ${oe.value} (${oe.sourceType === 'OE_IMAGE' ? 'bilde' : 'kunde-lesning'})`);
  } else {
    lines.push('OE-observasjon: ingen');
  }

  const selected = resolutions.find((r) => r.eurocode === selectedGlass);

  if (fitmentStatus === 'EXACT' && selected) {
    lines.push('');
    lines.push(`Resultat: EXACT — ${selected.eurocode}${selected.varenr ? ` (${selected.varenr})` : ''}`);
    lines.push('');
    lines.push(explainQualityScore(selected.quality).tekst);
    if (selected.installedCount > 0) {
      lines.push(`Installasjonshistorikk: ${selected.installedCount} vellykkede installasjon(er)${selected.wrongGlassCount > 0 ? `, ${selected.wrongGlassCount} feil` : ''}`);
    }
  } else if (fitmentStatus === 'AMBIGUOUS') {
    lines.push(`Resultat: AMBIGUOUS — ${remaining.length} kandidater gjenstår uten autoritativ evidens`);
  } else {
    lines.push('Resultat: UNKNOWN — ingen kandidat har autoritativ evidens (jeg vet ikke er bedre enn feil)');
  }

  if (input.resolutions.some((r) => r.eliminated)) {
    lines.push('');
    lines.push('Eliminerte kandidater:');
    for (const r of input.resolutions.filter((x) => x.eliminated)) {
      lines.push(`  ✗ ${r.eurocode}${r.varenr ? ' (' + r.varenr + ')' : ''} — ${r.eliminateReason}`);
    }
  }

  return lines.join('\n');
}

// ── Materialisering: ledger → glass_*-projeksjoner (krav #4) ──

export interface GlassProjections {
  /** evidence_events (bekreftet) → glass_evidence-noder. */
  glassEvidence: { glassId: string | null; evidenceType: string; value: string; confidence: number; direction: 'supports' | 'excludes' }[];
  /** feature-evidens → glass_features-noder. */
  glassFeatures: { feature: string; value: string; confidence: number }[];
  /** installation_fixtures → glass_vehicle_links (korroborasjon hever confidence). */
  glassVehicleLinks: { eurocode: string; installations: number; wrongGlass: number; confidence: number }[];
}

/**
 * materializeProjections — deterministisk projeksjon av ledgeren inn i glass_*-skjemaet.
 * glass_*-tabellene er KUN projeksjon av append-only-kilden; de skrives aldri som sannhet her.
 * Recomputing fra ledgeren gir alltid samme eller høyere kvalitet (monotonicity).
 */
export function materializeProjections(events: LedgerEvent[], fixtures: FixtureRecord[]): GlassProjections {
  const glassEvidence: GlassProjections['glassEvidence'] = [];
  const glassFeatures: GlassProjections['glassFeatures'] = [];

  for (const e of events) {
    if (e.createdBy === 'ai' || (e.status !== 'CONFIRMED' && e.status !== 'VERIFIED')) continue;
    glassEvidence.push({
      glassId: e.candidateVarenr,
      evidenceType: e.evidenceType,
      value: e.value,
      confidence: e.confidence,
      direction: 'supports',
    });
    if (e.evidenceType !== 'OE') {
      glassFeatures.push({ feature: e.evidenceType, value: e.value, confidence: e.confidence });
    }
  }

  const byEurocode = new Map<string, { installations: number; wrongGlass: number }>();
  const eurocodeByVarenr = new Map<string, string | null>();
  for (const f of fixtures) {
    if (!eurocodeByVarenr.has(f.candidateVarenr)) eurocodeByVarenr.set(f.candidateVarenr, f.eurokode);
    const euro = f.eurokode ?? f.candidateVarenr;
    const r = byEurocode.get(euro) ?? { installations: 0, wrongGlass: 0 };
    if (f.outcome === 'INSTALLED_SUCCESSFULLY' && f.status !== 'REJECTED') r.installations++;
    else if (f.outcome === 'WRONG_GLASS' && f.status !== 'REJECTED') r.wrongGlass++;
    byEurocode.set(euro, r);
  }

  const glassVehicleLinks: GlassProjections['glassVehicleLinks'] = [...byEurocode.entries()].map(([eurocode, r]) => ({
    eurocode,
    installations: r.installations,
    wrongGlass: r.wrongGlass,
    // confidence: 0 (katalog) → 90 ved ≥3 korroberte installasjoner (VERIFIED_REAL_WORLD_INSTALLATION).
    confidence: r.installations >= 3 ? 90 : r.installations >= 1 ? 55 : 0,
  }));

  return { glassEvidence, glassFeatures, glassVehicleLinks };
}
