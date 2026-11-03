/**
 * Loggepolicy for /api/regnr.
 *
 * Bakgrunn: ruta skrev tidligere regnr_logg + sok_logg for HVERT kall — også
 * rene identifikasjonskall som bare skal finne bilen. Frontend sender
 * `lookupOnly: true` nettopp for slike kall, men backend ignorerte flagget.
 * Konsekvensen var at test- og diagnoseoppslag (curl, QA) etterlot
 * regnskapspliktige loggrader uten at noen kunde hadde søkt (INC-2026-10-31,
 * regnr_logg id 4585 / sok_logg id 4469).
 *
 * Regelen er fail-safe: bare et eksplisitt `lookupOnly: true` slår logging av.
 * Alt annet — manglende eller ugyldig body inkludert — logger som før, slik at
 * ekte kundesøk aldri mister læringsdata.
 */
export function skalLoggeSok(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  return (body as Record<string, unknown>).lookupOnly !== true;
}
