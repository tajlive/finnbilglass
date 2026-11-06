/**
 * Offentlig API-kontrakt for glassøk (Tom-beslutning 2026-10-31).
 *
 * Prinsipp: kunden skal se nok til å velge og bestille, men ikke
 * leverandørens eller katalogens interne data.
 *
 * KUNDEVENDT:
 *   varenr, varenavn, canonicalUrl, bekreftet NOK-pris med mva,
 *   kompatibilitetsstatus og behov for manuell avklaring.
 *
 * ALDRI OFFENTLIG:
 *   eurokode, skuFingerprint, typeCode, side, alias_av, rad_type,
 *   leverandørnavn, innkjøpspris, kilde-metadata, diagnostikk.
 *
 * Ved usikker matching eller manglende prisgrunnlag skal kunden få
 * MANUAL_REVIEW og en tilbudsforespørsel — aldri en automatisk bekreftet
 * kompatibilitet eller pris.
 */

import { estimertFrontruteKundeprisInklMva, mvaFraInkl } from './pricing/nok-prising';
import type { Kandidat, DiscoveryResult } from './discovery';

/** Felt som aldri skal ut i et offentlig svar. */
export const INTERNE_FELT = [
  'eurokode',
  'skuFingerprint',
  'typeCode',
  'side',
  'alias_av',
  'rad_type',
  'leverandor',
  'innkjopspris',
  'kilde',
] as const;

export interface OffentligPris {
  kundePris: number;
  mva: number;
  prisEksMva: number;
  /** ESTIMERT = beregnet fra veiledende XLS-pris (75 % rabatt + mva), kontrolleres
   *  manuelt før tilbud. BEKREFTET = bygger på fakturakostnad. */
  sikkerhet: 'BEKREFTET' | 'ESTIMERT';
}

export interface OffentligKandidat {
  varenr: string;
  varenavn: string;
  canonicalUrl?: string;
  /** Bekreftet NOK-pris inkl. mva. null når grunnlaget ikke er sikkert. */
  pris: OffentligPris | null;
}

export interface OffentligGlassSvar {
  /** OK kun når kompatibilitet er bekreftet OG pris finnes. Katalogtreff alene
   *  er alltid MANUAL_REVIEW — pris skal aldri gi OK på egen hånd. */
  status: 'OK' | 'MANUAL_REVIEW';
  /** Hva prisen i kandidatene faktisk er. Uavhengig av kompatibilitet.
   *  ESTIMERT = alle kandidater har en beregnet XLS-pris (75 % rabatt + mva),
   *  BEKREFTET = alle har fakturabasert pris, DELVIS = blandet, INGEN = ingen pris. */
  prisStatus: 'BEKREFTET' | 'ESTIMERT' | 'DELVIS' | 'INGEN';
  candidates: OffentligKandidat[];
  totalAvailable: number;
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Beregner kundepris fra listepris. Returnerer null når prisen ikke er
 * bekreftet — da skal kunden få tilbudsforespørsel i stedet for et tall.
 */
export function offentligPris(listepris: number | null | undefined): OffentligPris | null {
  if (typeof listepris !== 'number' || !Number.isFinite(listepris) || listepris <= 0) return null;
  try {
    const kundePris = estimertFrontruteKundeprisInklMva(listepris);
    // XLS-prisen gir et ESTIMAT (Tom 2026-10-29). Estimatet kan vises, men alltid
    // merket som estimat — aldri som bekreftet pris.
    if (kundePris == null) return null;
    const { mva, eksMva } = mvaFraInkl(kundePris);
    return { kundePris, mva, prisEksMva: eksMva, sikkerhet: 'ESTIMERT' };
  } catch {
    return null;
  }
}

/** Mapper én intern kandidat til offentlig form. Kun kjente felt slipper ut. */
export function tilOffentligKandidat(k: Kandidat & { pris?: number | null }): OffentligKandidat {
  const ut: OffentligKandidat = {
    varenr: k.varenr,
    varenavn: k.varenavn,
    pris: offentligPris(k.pris),
  };
  if (k.canonicalUrl) ut.canonicalUrl = k.canonicalUrl;
  return ut;
}

/**
 * Mapper et helt discovery-svar. Status er OK bare når minst én kandidat har
 * bekreftet pris; ellers MANUAL_REVIEW slik at kunden sendes til manuell
 * avklaring i stedet for å se et ufullstendig svar.
 */
export function tilOffentligSvar(r: DiscoveryResult): OffentligGlassSvar {
  const candidates = r.candidates.map((k) => tilOffentligKandidat(k));
  const medPris = candidates.filter((k) => k.pris !== null).length;
  // Estimat er ikke «bekreftet pris»: statusen skiller derfor på om tallet er
  // beregnet fra XLS (ESTIMERT) eller bygger på faktura (BEKREFTET).
  const alleEstimert = candidates.filter((k) => k.pris).every((k) => k.pris!.sikkerhet === 'ESTIMERT');
  const prisStatus: OffentligGlassSvar['prisStatus'] =
    medPris === 0 ? 'INGEN'
      : medPris < candidates.length ? 'DELVIS'
        : alleEstimert ? 'ESTIMERT' : 'BEKREFTET';

  // Kompatibilitet har høyere prioritet enn pris: et katalogtreff bekrefter
  // ikke at glasset passer bilen. Uten fitment-evidens er svaret MANUAL_REVIEW
  // selv om prisen er bekreftet — ellers ville prisen alene gitt falsk trygghet.
  const kompatibilitetBekreftet = r.candidates.some((k) => k.kompatibilitet === 'BEKREFTET');
  const ut: OffentligGlassSvar = {
    status: candidates.length > 0 && kompatibilitetBekreftet && medPris > 0 ? 'OK' : 'MANUAL_REVIEW',
    prisStatus,
    candidates,
    totalAvailable: r.totalAvailable,
    hasMore: r.hasMore,
  };
  if (r.nextCursor) ut.nextCursor = r.nextCursor;
  return ut;
}

/** Sjekker at et objekt ikke lekker interne felt. Brukes av kontrakttester. */
export function lekkerInterneFelt(obj: unknown): string[] {
  const funnet: string[] = [];
  const gaa = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(gaa); return; }
    if (v && typeof v === 'object') {
      for (const [nokkel, verdi] of Object.entries(v as Record<string, unknown>)) {
        if ((INTERNE_FELT as readonly string[]).includes(nokkel)) funnet.push(nokkel);
        gaa(verdi);
      }
    }
  };
  gaa(obj);
  return funnet;
}


/**
 * Offentlig projeksjon av et resolver-svar (/api/frontrute).
 *
 * Resolveren returnerer interne felt (eurokode, listepris, confidence, grunn)
 * fordi den også brukes server-side. Kunden skal se kandidatene og prisen,
 * men aldri eurokoden eller listeprisen — samme kontrakt som /api/glass
 * (Tom-beslutning 2026-10-31).
 */
export interface OffentligResolverKandidat {
  varenr: string | null;
  varenavn: string | null;
  pris: number | null;
  /** «varenr:FULL-EUROKODE» — identitet for valgt variant, ikke visningstekst.
   *  Kunden skal aldri se eurokoden (Tom 2026-10-31), men valget må kunne
   *  spores tilbake til nøyaktig samme variant i saken og i /ops. */
  variantId: string | null;
  attributter: Record<string, boolean | null>;
}

export function tilOffentligResolverKandidat(k: Record<string, unknown> | null | undefined): OffentligResolverKandidat {
  const kilde = k ?? {};
  const attributter: Record<string, boolean | null> = {};
  const råAttr = (kilde.attributter ?? {}) as Record<string, unknown>;
  for (const [nøkkel, verdi] of Object.entries(råAttr)) {
    if (typeof verdi === 'boolean' || verdi === null) attributter[nøkkel] = verdi as boolean | null;
  }
  const pris = typeof kilde.pris === 'number' && Number.isFinite(kilde.pris) && kilde.pris > 0 ? kilde.pris : null;
  // variantId = «varenr:FULL-EUROKODE». Den er nødvendig for at kundens valg skal
  // peke på samme produktvariant gjennom hele flyten (ett varenr kan ha flere
  // eurokoder med ulikt utstyr og pris). Koden er produktets egen betegnelse,
  // ikke internpris — listepris og andre interne felt projiseres fortsatt bort.
  const variantId = typeof kilde.variantId === 'string' && kilde.variantId.length <= 90 ? kilde.variantId : null;
  return {
    varenr: typeof kilde.varenr === 'string' ? kilde.varenr : null,
    varenavn: typeof kilde.varenavn === 'string' ? kilde.varenavn : null,
    pris,
    variantId,
    attributter,
  };
}

export function tilOffentligResolverSvar(resolver: Record<string, unknown> | null | undefined) {
  const r = resolver ?? {};
  const kandidater = Array.isArray(r.kandidater) ? r.kandidater.map((k) => tilOffentligResolverKandidat(k as Record<string, unknown>)) : [];
  const topp = kandidater[0] ?? null;
  const utfall = typeof r.utfall === 'string' ? r.utfall : null;
  return {
    utfall,
    totalAntall: typeof r.totalAntall === 'number' ? r.totalAntall : kandidater.length,
    kandidater,
    sporsmaal: Array.isArray(r.sporsmaal) ? r.sporsmaal.filter((s): s is string => typeof s === 'string') : [],
    pinpoint: utfall === 'PINPOINT',
    anbefaling: topp ? { varenr: topp.varenr, varenavn: topp.varenavn, pris: topp.pris } : null,
  };
}
