/**
 * learning-v1/quality-score — C8.4: Evidence Quality Score (ren deterministisk funksjon).
 * «Gjør sannhetslaget målbart» — grafen trenger en måte å rangere sannhet på.
 *
 * Evidence Ledger er ENESTE sannhetskilde. glass_*-tabellene er kun projeksjon og er
 * aldri input her. Katalog (CLASS_D) gir 0 poeng. AI-antakelse (createdBy='ai') gir 0 poeng.
 * WRONG_GLASS eliminerer kandidaten (negativ evidens er absolutt, ikke additiv).
 *
 * Poengmodell (Tom, 2026-08-18 — låst):
 *   OE-bilde bekreftet          +50
 *   Montørinstallasjon (≥1)     +40
 *   5+ vellykkede installasjoner +30
 *   Kunde bekreftet             +10
 *   Ekspert fysisk kontroll      +20   → maks 150
 *   Katalog                     0
 *   AI-gjetning                 0
 *
 * Monotonicity: poengsummen er en ren sum av oppfylte, bekreftede kilder — den kan aldri
 * reduseres når ny evidens legges til (append-only ledger). REJECTED teller ikke som kilde.
 */
import type { LedgerEvent, FixtureRecord } from './evidence-ledger.js';

export type QualityConfidence = 'HØY' | 'MIDDELS' | 'LAV' | 'INGEN';

export interface QualityReason {
  /** Kildenavn, f.eks. «OE-bilde bekreftet». */
  kilde: string;
  /** Konkret detalj, f.eks. «OE 7H0845101H (bilde)» eller «kun 2 av 5 påkrevd». */
  detalj: string;
  /** Faste poeng kilden kan gi. */
  poeng: number;
  /** true = kilden er bekreftet og inngår i score. */
  oppfylt: boolean;
}

export interface EvidenceQualityResult {
  /** 0–150. Summen av oppfylte poengkilder. */
  score: number;
  /** Fastsatt maks (150). */
  maxScore: number;
  /** Tillitsnivå fra score: HØY ≥130 · MIDDELS ≥50 · LAV >0 · INGEN 0. */
  confidence: QualityConfidence;
  /** Én rad per poengkilde (oppfylt + manglende), i fast rekkefølge. */
  reasons: QualityReason[];
  /** Antall poenggivende, bekreftede evidenskilder (ikke rå event-tall). */
  evidenceCount: number;
  /** true = WRONG_GLASS eliminerer kandidaten. */
  eliminated: boolean;
  /** Årsak ved eliminering, ellers null. */
  eliminateReason: string | null;
}

export interface QualityExplanation {
  score: number;
  maxScore: number;
  confidence: QualityConfidence;
  /** «✓ …»-linjer for oppfylte kilder. */
  bekreftet: string[];
  /** «✗ …»-linjer for manglende poengkilder (ikke eliminering). */
  manglende: string[];
  /** Full norsk forklaring i klartekst. */
  tekst: string;
}

/** Poengmodell (låst). Maks = 50+40+30+10+20 = 150. */
const POINTS = {
  OE_IMAGE: 50,
  INSTALLER: 40,
  FIVE_INSTALLS: 30,
  CUSTOMER: 10,
  EXPERT_PHYSICAL: 20,
} as const;

export const MAX_QUALITY_SCORE = POINTS.OE_IMAGE + POINTS.INSTALLER + POINTS.FIVE_INSTALLS + POINTS.CUSTOMER + POINTS.EXPERT_PHYSICAL; // 150

/** Bekreftet, ikke-AI, ikke-REJECTED = poenggivende kilde. */
function isActive(ev: LedgerEvent): boolean {
  return ev.createdBy !== 'ai' && (ev.status === 'CONFIRMED' || ev.status === 'VERIFIED');
}

/**
 * evidenceQualityScore — ren, deterministisk: evidens inn → poeng + grunnlag + tillit ut.
 *
 * @param events   LedgerEvent[] fra evidence_events (allerede avgrenset til kandidat/kjøretøy).
 * @param fixtures FixtureRecord[] fra installation_fixtures (samme avgrensning).
 * @param opts     Valgfri ekspertkanal — ekspert fysisk kontroll (+20) finnes ikke som
 *                 egen source_type i ledgeren ennå, og leveres derfor eksplisitt.
 */
export function evidenceQualityScore(
  events: LedgerEvent[],
  fixtures: FixtureRecord[],
  opts: { expertPhysicalVerification?: boolean } = {},
): EvidenceQualityResult {
  const reasons: QualityReason[] = [];

  // 1. WRONG_GLASS eliminerer kandidaten — negativ evidens er absolutt, ikke additiv.
  const wrong = fixtures.filter((f) => f.outcome === 'WRONG_GLASS' && f.status !== 'REJECTED');
  if (wrong.length > 0) {
    return {
      score: 0,
      maxScore: MAX_QUALITY_SCORE,
      confidence: 'INGEN',
      reasons: [{ kilde: 'WRONG_GLASS', detalj: `${wrong.length} feilbestilling eliminerer kandidaten`, poeng: 0, oppfylt: false }],
      evidenceCount: 0,
      eliminated: true,
      eliminateReason: `${wrong.length} WRONG_GLASS-installasjon(er) — negativ evidens eliminerer kandidaten`,
    };
  }

  const successful = fixtures.filter((f) => f.outcome === 'INSTALLED_SUCCESSFULLY' && f.status !== 'REJECTED');

  let score = 0;
  let evidenceCount = 0;

  // +50 — OE-bekreftelse MED bilde (sourceType=OE_IMAGE). OE lest av kunde teller som kunde (+10), ikke +50.
  const oe = events.find((e) => e.evidenceType === 'OE' && e.sourceType === 'OE_IMAGE' && isActive(e));
  if (oe) {
    score += POINTS.OE_IMAGE;
    evidenceCount++;
    reasons.push({ kilde: 'OE-bilde bekreftet', detalj: `OE ${oe.value} bekreftet (bilde)`, poeng: POINTS.OE_IMAGE, oppfylt: true });
  } else {
    reasons.push({ kilde: 'OE-bilde bekreftet', detalj: 'ingen OE-bekreftelse med bilde', poeng: POINTS.OE_IMAGE, oppfylt: false });
  }

  // +40 — minst én vellykket montørinstallasjon.
  if (successful.length >= 1) {
    score += POINTS.INSTALLER;
    evidenceCount++;
    reasons.push({ kilde: 'Montørinstallasjon', detalj: `${successful.length} vellykket installasjon`, poeng: POINTS.INSTALLER, oppfylt: true });
  } else {
    reasons.push({ kilde: 'Montørinstallasjon', detalj: 'ingen vellykket installasjon', poeng: POINTS.INSTALLER, oppfylt: false });
  }

  // +30 — fem eller flere uavhengige vellykkede installasjoner (korroborasjon).
  if (successful.length >= 5) {
    score += POINTS.FIVE_INSTALLS;
    evidenceCount++;
    reasons.push({ kilde: '5+ vellykkede installasjoner', detalj: `${successful.length} uavhengige montasjer`, poeng: POINTS.FIVE_INSTALLS, oppfylt: true });
  } else {
    reasons.push({ kilde: '5+ vellykkede installasjoner', detalj: `${successful.length} av 5 påkrevd`, poeng: POINTS.FIVE_INSTALLS, oppfylt: false });
  }

  // +10 — kunde-bekreftelse (enhver feature, inkl. OE lest av kunde).
  const customer = events.find((e) => e.sourceType === 'CUSTOMER' && isActive(e));
  if (customer) {
    score += POINTS.CUSTOMER;
    evidenceCount++;
    reasons.push({ kilde: 'Kunde bekreftet', detalj: `${customer.evidenceType} bekreftet av kunde`, poeng: POINTS.CUSTOMER, oppfylt: true });
  } else {
    reasons.push({ kilde: 'Kunde bekreftet', detalj: 'ingen kunde-bekreftelse', poeng: POINTS.CUSTOMER, oppfylt: false });
  }

  // +20 — ekspert fysisk kontroll (egen kanal, ennå ikke i ledgeren).
  if (opts.expertPhysicalVerification) {
    score += POINTS.EXPERT_PHYSICAL;
    evidenceCount++;
    reasons.push({ kilde: 'Ekspert fysisk kontroll', detalj: 'glass fysisk inspisert av ekspert', poeng: POINTS.EXPERT_PHYSICAL, oppfylt: true });
  } else {
    reasons.push({ kilde: 'Ekspert fysisk kontroll', detalj: 'ingen fysisk verifisering', poeng: POINTS.EXPERT_PHYSICAL, oppfylt: false });
  }

  // Katalog (CLASS_D) og AI (createdBy='ai') gir 0 poeng — de er aldri poenggivende kilder og
  // inngår ikke i input. score er dermed utelukkende summen av uavhengig, bekreftet evidens.

  const confidence: QualityConfidence = score >= 130 ? 'HØY' : score >= 50 ? 'MIDDELS' : score > 0 ? 'LAV' : 'INGEN';

  return { score, maxScore: MAX_QUALITY_SCORE, confidence, reasons, evidenceCount, eliminated: false, eliminateReason: null };
}

/**
 * explainQualityScore — «hvorfor denne scoren?» → strukturert norsk forklaring.
 * Returnerer oppfylte («✓») og manglende («✗») kilder pluss en klartekst-sum.
 */
export function explainQualityScore(result: EvidenceQualityResult): QualityExplanation {
  if (result.eliminated) {
    return {
      score: 0,
      maxScore: result.maxScore,
      confidence: 'INGEN',
      bekreftet: [],
      manglende: [],
      tekst: `Kandidaten er eliminert: ${result.eliminateReason ?? 'WRONG_GLASS'} (score 0/${result.maxScore}).`,
    };
  }

  const bekreftet = result.reasons.filter((r) => r.oppfylt).map((r) => `✓ ${r.kilde} — ${r.detalj} (+${r.poeng})`);
  const manglende = result.reasons.filter((r) => !r.oppfylt).map((r) => `✗ ${r.kilde} — ${r.detalj} (+0)`);

  const tekst = [
    `Evidence Quality Score: ${result.score}/${result.maxScore} (${result.confidence})`,
    '',
    'Bekreftet:',
    ...(bekreftet.length ? bekreftet : ['(ingen bekreftet evidens)']),
    '',
    'Manglende:',
    ...(manglende.length ? manglende : ['(alle kilder bekreftet)']),
  ].join('\n');

  return { score: result.score, maxScore: result.maxScore, confidence: result.confidence, bekreftet, manglende, tekst };
}
