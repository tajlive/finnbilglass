/**
 * Kill switch (G6) — per kilde, per modell, per resolver-modus.
 *
 * Flags leses fra D1-tabellen feature_flags (migrasjon 0005).
 * Regel: kill switch deaktiverer FEATURE → systemet degraderer trygt
 * (aldri PINPOINT → VERIFY/FALLBACK-veien), aldri omvendt.
 */
import type { ResolverUtfall } from './vin-resolver';

interface Env { FINNBILGLASS_DB: D1Database }

const FLAG_CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: boolean; at: number }>();

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
  if (!(await erAktiv(env, 'resolver_all'))) return 'FALLBACK';
  if (utfall === 'PINPOINT' && !(await erAktiv(env, 'resolver_pinpoint'))) return 'VERIFY';
  return utfall;
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
