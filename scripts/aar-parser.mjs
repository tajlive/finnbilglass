#!/usr/bin/env node
// Årstall-parser — trekker ut årsmodell-intervall fra Autoglass-varenavn.
// Formater som forekommer: "2003-", "03", "03-", "16-", "2022-", "79-86", "50-59"
// Returnerer { start, slutt } (slutt = Infinity for åpen "X-").

function norm(a) {
  return a < 30 ? 2000 + a : a < 100 ? 1900 + a : a;
}

export function parseAar(navn) {
  if (!navn) return null;
  const s = navn.toUpperCase();

  // 4-siffer intervall: 1979-1986
  const m4 = s.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (m4) return { start: +m4[1], slutt: +m4[2], raa: m4[0] };

  // 4-siffer åpen: 2003-  (bindestrek, men ingen slutt-år)
  const m4o = s.match(/(\d{4})\s*[-–]/);
  if (m4o) return { start: +m4o[1], slutt: Infinity, raa: m4o[0] };

  // 2-siffer intervall: 79-86
  const m2 = s.match(/(?:^|[^0-9])(\d{2})\s*[-–]\s*(\d{2})(?:[^0-9]|$)/);
  if (m2) return { start: norm(+m2[1]), slutt: norm(+m2[2]), raa: m2[0] };

  // 2-siffer åpen: 03-, 16-
  const m2o = s.match(/(?:^|[^0-9])(\d{2})\s*[-–](?:[^0-9]|$)/);
  if (m2o) return { start: norm(+m2o[1]), slutt: Infinity, raa: m2o[0] };

  // 2-siffer punkt: "03 T5+T6" (modell-kontekst) — tolkes som [år, år]
  const m2p = s.match(/(?:^|[^0-9])(\d{2})(?:[^0-9]|$)/);
  if (m2p) return { start: norm(+m2p[1]), slutt: norm(+m2p[1]), raa: m2p[0] };

  return null;
}

/** Inneholder intervallet bilens år? */
export function matcherAar(intervall, bilAar) {
  if (!intervall || bilAar == null) return true; // ukjent → ikke ekskluder
  return bilAar >= intervall.start && bilAar <= intervall.slutt;
}

// --- CLI: node aar-parser.mjs "VW TRANSP+CARAVELLE T5 2003-" ... ---
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const navn of process.argv.slice(2)) {
    console.log(`${JSON.stringify(parseAar(navn))}  ←  ${navn}`);
  }
}
