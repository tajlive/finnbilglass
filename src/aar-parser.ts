/** Årstall-parser — trekker ut årsmodell-intervall fra Autoglass-varenavn.
 *  Formater: "2003-", "03", "03-", "16-", "2022-", "79-86", "50-59", "11/94-97"
 */

export interface AarIntervall {
  start: number;
  slutt: number; // Infinity for åpen "X-"
}

function norm(a: number): number {
  return a < 30 ? 2000 + a : a < 100 ? 1900 + a : a;
}

export function parseAar(navn: string | null | undefined): AarIntervall | null {
  if (!navn) return null;
  const s = navn.toUpperCase();

  const m4 = s.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (m4) return { start: +m4[1], slutt: +m4[2] };

  const m4o = s.match(/(\d{4})\s*[-–]/);
  if (m4o) return { start: +m4o[1], slutt: Infinity };

  const m2 = s.match(/(?:^|[^0-9])(\d{2})\s*[-–]\s*(\d{2})(?:[^0-9]|$)/);
  if (m2) return { start: norm(+m2[1]), slutt: norm(+m2[2]) };

  const m2o = s.match(/(?:^|[^0-9])(\d{2})\s*[-–](?:[^0-9]|$)/);
  if (m2o) return { start: norm(+m2o[1]), slutt: Infinity };

  const m2p = s.match(/(?:^|[^0-9])(\d{2})(?:[^0-9]|$)/);
  if (m2p) return { start: norm(+m2p[1]), slutt: norm(+m2p[1]) };

  return null;
}

/** Inneholder intervallet bilens år? */
export function matcherAar(intervall: AarIntervall | null, bilAar: number | null | undefined): boolean {
  if (!intervall || bilAar == null) return true; // ukjent → ikke ekskluder
  return bilAar >= intervall.start && bilAar <= intervall.slutt;
}
