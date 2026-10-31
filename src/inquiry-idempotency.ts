/**
 * Idempotens for kundehenvendelser.
 *
 * Kontrakt (Tom, 2026-10-31):
 *   1. Første innsending med ny nøkkel      → 201, én henvendelse
 *   2. Retry med samme nøkkel + likt innhold → samme inquiryId
 *   3. Samme nøkkel med endret innhold       → 409 Conflict
 *   4. To samtidige identiske forsøk         → maksimalt én ny henvendelse
 *   5. Ny nøkkel ved bevisst ny innsending   → ny henvendelse
 *
 * Håndhevelsen er atomisk: nøkkelen INSERT-es med PRIMARY KEY FØR
 * henvendelsen opprettes. To parallelle kall kan ikke begge lykkes, fordi
 * den andre får UNIQUE-brudd. Ingen transaksjon er nødvendig — D1 garanterer
 * unikheten på primærnøkkelen.
 *
 * Personvern: vi lagrer aldri navn, telefon eller e-post her. Bare en
 * klient-generert nøkkel og et sha256-fingeravtrykk av den kanoniske bodyn.
 */

export interface IdempotensDb {
  prepare(sql: string): {
    bind(...v: unknown[]): { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null> };
  };
}

export type Reservasjon =
  | { status: 'NY' }
  | { status: 'REPLAY'; inquiryId: number }
  | { status: 'KONFLIKT' }
  | { status: 'PAGAR' };

/** Feltene som inngår i fingeravtrykket. Endres rekkefølgen/innholdet her,
 *  endres kontrakten — derfor eksplisitt liste og ikke hele bodyn. */
const FINGERAVTRYKK_FELT = ['regnr', 'navn', 'kontakt', 'melding', 'varenr', 'eurokode'] as const;

/** Normaliserer enkeltfelter slik at « Su18018 » og «su18018» gir samme hash. */
function normaliser(verdi: unknown): string {
  if (typeof verdi !== 'string') return '';
  return verdi.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Kanonisk JSON av de feltene som definerer en innsending.
 * Nøkler sorteres slik at feltrekkefølge i bodyen ikke påvirker hashen.
 */
export function kanoniskBody(body: Record<string, unknown>): string {
  const valgt: Record<string, string> = {};
  for (const felt of FINGERAVTRYKK_FELT) valgt[felt] = normaliser(body[felt]);
  return JSON.stringify(
    Object.keys(valgt)
      .sort()
      .reduce<Record<string, string>>((acc, k) => { acc[k] = valgt[k]; return acc; }, {})
  );
}

/** sha256 som hex. Samme innhold gir samme hash på tvers av kjøringer. */
export async function requestHash(body: Record<string, unknown>): Promise<string> {
  const data = new TextEncoder().encode(kanoniskBody(body));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Gyldig nøkkel: 8–128 tegn, kun URL-trygge tegn. Avviser søppel og PII-forsøk. */
export function gyldigNokkel(nokkel: string | null): string | null {
  if (!nokkel) return null;
  const n = nokkel.trim();
  if (n.length < 8 || n.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(n)) return null;
  return n;
}

/**
 * Reserverer nøkkelen. Returnerer:
 *   NY       — nøkkelen er nå låst til denne innsendingen; opprett henvendelsen
 *   REPLAY   — identisk innhold er allerede behandlet; returner lagret id
 *   KONFLIKT — nøkkelen er brukt med annet innhold (409)
 *   PAGAR    — en parallell forespørsel holder nøkkelen (409/425)
 */
export async function reserver(
  db: IdempotensDb,
  nokkel: string,
  hash: string,
  naa: number = Date.now()
): Promise<Reservasjon> {
  const innsatt = await db
    .prepare(
      "INSERT INTO inquiry_idempotency (idem_key, request_hash, inquiry_id, state, created_at) VALUES (?, ?, NULL, 'PENDING', ?) ON CONFLICT(idem_key) DO NOTHING"
    )
    .bind(nokkel, hash, naa)
    .run();

  if ((innsatt.meta?.changes ?? 0) > 0) return { status: 'NY' };

  const rad = await db
    .prepare('SELECT request_hash, inquiry_id, state FROM inquiry_idempotency WHERE idem_key = ?')
    .bind(nokkel)
    .first<{ request_hash: string; inquiry_id: number | null; state: string }>();

  // Nøkkelen forsvant mellom INSERT og SELECT (frigjort av en feilende
  // parallell forespørsel). La kalleren prøve på nytt som ny.
  if (!rad) return { status: 'NY' };

  if (rad.request_hash !== hash) return { status: 'KONFLIKT' };
  if (rad.state === 'DONE' && rad.inquiry_id != null) return { status: 'REPLAY', inquiryId: rad.inquiry_id };
  return { status: 'PAGAR' };
}

/** Merker nøkkelen som fullført og kobler den til henvendelsen. */
export async function fullfor(db: IdempotensDb, nokkel: string, inquiryId: number): Promise<void> {
  await db
    .prepare("UPDATE inquiry_idempotency SET inquiry_id = ?, state = 'DONE' WHERE idem_key = ?")
    .bind(inquiryId, nokkel)
    .run();
}

/** Frigjør en reservasjon når innsendingen feilet, slik at retry kan lykkes. */
export async function frigjor(db: IdempotensDb, nokkel: string): Promise<void> {
  await db
    .prepare("DELETE FROM inquiry_idempotency WHERE idem_key = ? AND state = 'PENDING'")
    .bind(nokkel)
    .run();
}
