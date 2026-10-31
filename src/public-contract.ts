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

import { beregnPris } from './pricing/nok-prising';
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
}

export interface OffentligKandidat {
  varenr: string;
  varenavn: string;
  canonicalUrl?: string;
  /** Bekreftet NOK-pris inkl. mva. null når grunnlaget ikke er sikkert. */
  pris: OffentligPris | null;
}

export interface OffentligGlassSvar {
  status: 'OK' | 'MANUAL_REVIEW';
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
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: listepris });
    if (r.sikkerhet !== 'BEKREFTET' || r.kundePris == null || r.mva == null || r.prisEksMva == null) {
      return null;
    }
    return { kundePris: r.kundePris, mva: r.mva, prisEksMva: r.prisEksMva };
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
  const harPris = candidates.some((k) => k.pris !== null);
  const ut: OffentligGlassSvar = {
    status: candidates.length > 0 && harPris ? 'OK' : 'MANUAL_REVIEW',
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
