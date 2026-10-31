/**
 * Kill switch (G6) — per kilde, per modell, per resolver-modus.
 *
 * Flags leses fra D1-tabellen feature_flags (migrasjon 0005).
 * Regel: kill switch deaktiverer FEATURE → systemet degraderer trygt
 * (aldri PINPOINT → VERIFY/FALLBACK-veien), aldri omvendt.
 */
import type { ResolverUtfall } from './vin-resolver';

interface Env { FINNBILGLASS_DB: D1Database }

/**
 * Cache-TTL for flagg. Worst case tid fra et flagg endres i D1 til ALLE
 * Worker-isolater har sett det er denne verdien — hver isolate cacher sitt eget
 * svar. Kort TTL gjør nødstoppet forutsigbart; prisen er ett D1-oppslag per
 * isolat per TTL.
 */
const FLAG_CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: boolean; at: number }>();

/**
 * Konservativ lesing for resolver-flagg: manglende rad eller lesefeil gir FALSE.
 *
 * Vanlig erAktiv er fail-open (manglende flagg = aktivt), som er riktig for nye
 * funksjonsflagg. For resolveren er det motsatt: et manglende eller uleselig
 * flagg skal ALDRI gi et automatisk godkjent PINPOINT. Vi feiler derfor lukket.
 */
async function erAktivKonservativ(env: Env, flag: string): Promise<boolean> {
  const c = cache.get(flag);
  if (c && Date.now() - c.at < FLAG_CACHE_TTL_MS) return c.value;
  try {
    const r = await env.FINNBILGLASS_DB.prepare(
      'SELECT enabled FROM feature_flags WHERE flag = ?'
    ).bind(flag).first<{ enabled: number }>();
    const value = r ? r.enabled === 1 : false; // manglende rad = AV
    cache.set(flag, { value, at: Date.now() });
    return value;
  } catch {
    return false; // uleselig = AV, og vi cacher ikke en feil
  }
}

async function erAktiv(env: Env, flag: string): Promise<boolean> {
  const c = cache.get(flag);
  if (c && Date.now() - c.at < FLAG_CACHE_TTL_MS) return c.value;
  const r = await env.FINNBILGLASS_DB.prepare(
    'SELECT enabled FROM feature_flags WHERE flag = ?'
  ).bind(flag).first<{ enabled: number }>();
  const value = r ? r.enabled === 1 : true; // fraværende flagg = aktivt (fail-open for ny flagg, fail-safe for kjente)
  cache.set(flag, { value, at: Date.now() });
  return value;
}

/** Resolver-modus kill switch: 'resolver_all' av → alltid FALLBACK.
 *  'resolver_pinpoint' av → PINPOINT degraderes til VERIFY (kandidatene beholdes). */
export async function resolverModus(env: Env, utfall: ResolverUtfall): Promise<ResolverUtfall> {
  if (!(await erAktivKonservativ(env, 'resolver_all'))) return 'FALLBACK';
  if (utfall === 'PINPOINT' && !(await erAktivKonservativ(env, 'resolver_pinpoint'))) return 'VERIFY';
  return utfall;
}

/**
 * Én inngang for resolver-policy på ALLE ruter som returnerer resolver-svar.
 *
 * Bakgrunn: /api/frontrute brukte resolverModus(), men /api/regnr, /api/vin og
 * skiltlesing returnerte resolveren rå. Dermed slapp et automatisk godkjent
 * PINPOINT ut selv med resolver_all av — stoppsignalet virket ikke.
 *
 * Returnerer en kopi med degradert utfall og en grunn som navngir flagget.
 * Kandidatlisten røres ikke: matchmotoren er uendret, bare sikkerhetsstatusen.
 */
export async function anvendResolverPolicy<T extends { utfall: ResolverUtfall; grunn?: string | undefined }>(
  env: Env,
  resolver: T | null
): Promise<T | null> {
  if (!resolver) return resolver;
  const ny = await resolverModus(env, resolver.utfall);
  if (ny === resolver.utfall) return resolver;
  return {
    ...resolver,
    utfall: ny,
    grunn: `kill switch: ${resolver.utfall}→${ny}${resolver.grunn ? ` (${resolver.grunn})` : ''}`,
  };
}

/**
 * Separat nødstopp for nye kundehenvendelser.
 *
 * Uavhengig av resolver-cachen: dette stopper innsendingen før noe annet skjer,
 * så en pilot kan stenges umiddelbart uten å vente på at resolver-flagget
 * propagerer. Manglende flagg = tillatt (fail-open), slik at et miljø uten
 * flagget ikke mister salg ved en feilkonfigurasjon.
 */
export async function henvendelserTillatt(env: Env): Promise<boolean> {
  return erAktiv(env, 'inquiries_enabled');
}

/** Brukes av ruter som vil vite om PINPOINT er tillatt før de bygger svaret. */
export async function pinpointTillatt(env: Env): Promise<boolean> {
  return (await erAktivKonservativ(env, 'resolver_all')) && (await erAktivKonservativ(env, 'resolver_pinpoint'));
}

/** Kilde-kill switch: L1 ground_truth / L2 glass_catalog / L3 ktype. */
export async function kildeAktiv(env: Env, lag: 'l1_ground_truth' | 'l2_glass_catalog' | 'l3_ktype'): Promise<boolean> {
  return erAktiv(env, lag);
}

/** Modell-kill switch (CV/AI): 'cv_model_<version>'. */
export async function modellAktiv(env: Env, modellVersjon: string): Promise<boolean> {
  return erAktiv(env, `cv_model_${modellVersjon}`);
}

/** Testhjelper: fjerner cache (brukes i tester). */
export function _resetCache(): void {
  cache.clear();
}
