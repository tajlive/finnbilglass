/**
 * learning-v1/analytics — C8.2: Evidence Analytics (rent domene).
 * Innsikt for Learning Flywheel: mest usikre biler · mest manglende features ·
 * mest vanlige feilglass · mest verdifulle fixtures. Output: TOPP-læringsmuligheter
 * — «da vet C9.5 hvor den skal hente data».
 */
import type { FixtureRecord } from './evidence-ledger.js';

export interface AnalyticsVehicle {
  make: string;
  model: string;
  year: number | null;
  familie: string;
  /** Hvor mange kandidater resolver/CLASS_D fant (0 = manuell behandling). */
  kandidater: number;
  /** Skillende features i kandidatgruppen (må kunne svares på / samles evidens for). */
  skillendeFeatures: string[];
}

export interface MarketVolume {
  [familie: string]: number; // finn.no-annonsevolum
}

export interface FixtureCount {
  [candidateVarenr: string]: { installed: number; wrong: number };
}

export interface LearningOpportunity {
  rang: number;
  familie: string;
  sok: number;              // SVV-korpus-volum
  manuell: number;          // uten kandidater → menneskelig behandling
  markedsVolum: number;     // finn.no-annonser
  manglendeFeatures: string[]; // skillende features uten lagret evidens
  feilglass: number;        // WRONG_GLASS-fixtures totalt (0 = ingen feilbestillinger ennå)
  verdifulleFixtures: number; // korroberte INSTALLED_SUCCESSFULLY (≥3 = EXACT-klar)
  installasjoner: number;   // totalt antall korroberte installasjoner (datasett-volum for confidence)
  læringsscore: number;     // markedsvolum × manuell-gap × evidence-mangel
  confidence: 'HØY' | 'MIDDELS' | 'LAV'; // C8.2: datasett-størrelse — aldri overreager på små datasett
  confidenceAarsak: string; // f.eks. «bare 78 observasjoner»
  anbefaling: string;
}

/** C8.2: Learning Opportunity Confidence — hindrer overreaksjon på små datasett. */
export function confidenceFor(sok: number, korroberteInstallasjoner: number): { confidence: LearningOpportunity['confidence']; aarsak: string } {
  if (sok >= 300 || korroberteInstallasjoner >= 10) return { confidence: 'HØY', aarsak: `${sok} observasjoner${korroberteInstallasjoner >= 10 ? ` + ${korroberteInstallasjoner} korroberte installasjoner` : ''}` };
  if (sok >= 100 || korroberteInstallasjoner >= 3) return { confidence: 'MIDDELS', aarsak: `${sok} observasjoner${korroberteInstallasjoner >= 3 ? ` + ${korroberteInstallasjoner} korroberte installasjoner` : ''}` };
  return { confidence: 'LAV', aarsak: `bare ${sok} observasjoner` };
}

/**
 * Læringsmuligheter: hvor skal C8 samle evidens og C9.5 lete etter data?
 * Score = markedsvolum (kommersiell verdi) × manuell-andel (gap) × (1 + manglende features + feilglass).
 * «Mangler X-evidens» = skillende feature i kandidatgruppen uten konfirmerte observasjoner.
 */
export function learningOpportunities(
  vehicles: AnalyticsVehicle[],
  market: MarketVolume,
  fixtures: FixtureCount,
  harEvidens: (familie: string, feature: string) => boolean = () => false,
): LearningOpportunity[] {
  const perFamilie = new Map<string, { sok: number; manuell: number; features: Set<string> }>();
  for (const v of vehicles) {
    const r = perFamilie.get(v.familie) ?? { sok: 0, manuell: 0, features: new Set<string>() };
    r.sok++;
    if (v.kandidater === 0) r.manuell++;
    for (const f of v.skillendeFeatures) r.features.add(f);
    perFamilie.set(v.familie, r);
  }
  const feilglass = new Map<string, number>();
  let verdifulle = 0;
  let installasjoner = 0;
  for (const [varenr, c] of Object.entries(fixtures)) {
    if (c.installed >= 3) verdifulle++;
    installasjoner += c.installed;
    feilglass.set(varenr, c.wrong);
  }

  const ut = [...perFamilie.entries()]
    .map(([familie, r]) => {
      const manglende = [...r.features].filter((f) => !harEvidens(familie, f));
      const markedsVolum = market[familie] ?? 0;
      const manuellGap = r.sok === 0 ? 0 : r.manuell / r.sok;
      const læringsscore = Math.round(markedsVolum * (0.5 + manuellGap) * (1 + manglende.length * 0.5) * 10) / 10;
      return {
        familie,
        sok: r.sok,
        manuell: r.manuell,
        markedsVolum,
        manglendeFeatures: manglende.sort(),
        feilglass: [...feilglass.values()].reduce((s, w) => s + w, 0),
        verdifulleFixtures: verdifulle,
        installasjoner,
        læringsscore,
      };
    })
    .sort((a, b) => b.læringsscore - a.læringsscore);

  return ut.slice(0, 10).map((o, i) => {
    const { confidence, aarsak } = confidenceFor(o.sok, o.installasjoner);
    return {
      ...o,
      rang: i + 1,
      confidence,
      confidenceAarsak: aarsak,
      anbefaling: o.manglendeFeatures.length
        ? `samle ${o.manglendeFeatures.join('/')}-evidens via kundesamtale + C8-fixtures (${o.sok - o.manuell}/${o.sok} har kandidater)`
        : o.manuell === o.sok
          ? 'kandidatgenerering mangler — C9.5 Finn Vehicle Intelligence kan bygge applikasjonskandidater'
          : 'kandidater finnes — samle installasjonsfixtures for å styrke EXACT-kjeden',
    };
  });
}
