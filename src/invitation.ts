/**
 * Pilot-invitasjoner (P0) — sikker, tilfeldig adgangskontroll for begrenset pilot.
 *
 * Modell (Tom, 2026-10-31): IKKE bruk regnr/kontakt som nøkkel (kjent/gjettbar).
 * Bruk en sikker, tilfeldig invitasjonskode som kontrolleres av Worker + D1.
 *
 * Koden er 43 tegn (URL-safe base64 av 32 tilfeldige byte = 256 bit entropi),
 * én gang per invitasjon. Forbrukes atomisk ved første gyldige innsending, slik
 * at to parallelle kall aldri begge kan bruke samme kode.
 */

export interface InvitasjonDb {
  prepare(sql: string): {
    bind(...v: unknown[]): { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null> };
  };
}

/** Generer en sikker, tilfeldig, URL-safe invitasjonskode (43 tegn). */
export function genererInvitasjonskode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Normaliser + valider kodeformat (kun URL-trygge tegn, 43 tegn). */
export function gyldigInvitasjonskode(kode: string | null | undefined): string | null {
  if (!kode) return null;
  const k = kode.trim();
  if (k.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(k)) return null;
  return k;
}

export type InvitasjonsResultat =
  | { status: 'OK' }
  | { status: 'UGYLDIG' }
  | { status: 'BRUKT' }
  | { status: 'REVOKERT' };

/**
 * Forbruk en invitasjon atomisk. Returnerer:
 *   OK       — koden var unused og er nå atomisk markert used.
 *   UGYLDIG  — koden finnes ikke (eller har ugyldig format).
 *   BRUKT    — koden er allerede brukt.
 *   REVOKERT — koden er tilbakekalt.
 */
export async function brukInvitasjon(db: InvitasjonDb, kode: string, naa: number = Date.now()): Promise<InvitasjonsResultat> {
  const r = await db
    .prepare("UPDATE pilot_invitations SET status = 'used', used_at = ? WHERE invite_code = ? AND status = 'unused'")
    .bind(naa, kode)
    .run();
  if ((r.meta?.changes ?? 0) > 0) return { status: 'OK' };

  const rad = await db
    .prepare('SELECT status FROM pilot_invitations WHERE invite_code = ?')
    .bind(kode)
    .first<{ status: string }>();
  if (!rad) return { status: 'UGYLDIG' };
  return rad.status === 'revoked' ? { status: 'REVOKERT' } : { status: 'BRUKT' };
}

/** Opprett N invitasjoner (returnerer kodene). Brukes av /ops-admin. */
export async function opprettInvitasjoner(db: InvitasjonDb, antall: number, createdBy: string, note: string, naa: number = Date.now()): Promise<string[]> {
  const koder: string[] = [];
  for (let i = 0; i < antall; i++) {
    const kode = genererInvitasjonskode();
    await db
      .prepare('INSERT INTO pilot_invitations (invite_code, status, created_at, created_by, note) VALUES (?, ?, ?, ?, ?)')
      .bind(kode, 'unused', naa, createdBy, note)
      .run();
    koder.push(kode);
  }
  return koder;
}

/** Tilbakekall en invitasjon (unused → revoked). */
export async function tilbakekallInvitasjon(db: InvitasjonDb, kode: string, naa: number = Date.now()): Promise<boolean> {
  const r = await db
    .prepare("UPDATE pilot_invitations SET status = 'revoked', revoked_at = ? WHERE invite_code = ? AND status = 'unused'")
    .bind(naa, kode)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}
