/**
 * Pilot-invitasjoner (P0) — sikker, tilfeldig adgangskontroll for begrenset pilot.
 *
 * Modell (Tom, 2026-10-31, revidert):
 *   - IKKE regnr/kontakt som nøkkel. Sikker, tilfeldig kode (43 tegn, 256 bit).
 *   - KUN SHA-256-hash av koden lagres i D1. Rå kode returneres kun ved
 *     opprettelse — aldri i lister, logger eller analyse.
 *   - Maks 20 autoriserte pilotdeltakere, håndhevet atomisk (én INSERT med
 *     COUNT-guard), ikke som policy.
 *   - Utløpsdato (expires_at) og tilbakekalling (status=revoked).
 *   - Forbruk skjer ved innlogging (binding til verifisert e-post), ikke ved
 *     henvendelse — en feil i sakopprettelsen forbruker aldri koden permanent.
 */

export interface InvitasjonDb {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
    all<T>(): Promise<{ results: T[] }>;
  };
}

export const MAX_PILOT_DELTAKERE = 20;

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

/** SHA-256 av rå kode (hex) — det eneste som lagres. */
export async function hashInvitasjonskode(kode: string): Promise<string> {
  const data = new TextEncoder().encode(kode);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type InvitasjonsStatus = 'OK' | 'UGYLDIG' | 'BRUKT' | 'REVOKERT' | 'UTLOPT';

/** Tell aktive (unused, uutløpt) invitasjoner — for den atomiske grensen. */
async function aktiveAntall(db: InvitasjonDb, naa: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM pilot_invitations WHERE status = 'unused' AND (expires_at IS NULL OR expires_at > ?)")
    .bind(naa)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Opprett inntil N invitasjoner. Håndhever maks 20 aktive atomisk: én INSERT
 * med COUNT-guard per kode. Returnerer rå kodene (kun dette kallet viser dem).
 */
export async function opprettInvitasjoner(
  db: InvitasjonDb,
  antall: number,
  createdBy: string,
  note: string,
  naa: number = Date.now(),
  expiresAt: number | null = null,
): Promise<{ ok: boolean; koder: string[]; error?: string; opprettet: number }> {
  const koder: string[] = [];
  const onsket = Math.max(1, Math.min(antall, 20));
  for (let i = 0; i < onsket; i++) {
    const kode = genererInvitasjonskode();
    const hash = await hashInvitasjonskode(kode);
    // Atomisk: bare INSERT hvis aktive < MAX (ett SQL-uttrykk = én atomisk operasjon).
    const r = await db
      .prepare(
        `INSERT INTO pilot_invitations (invite_hash, status, created_at, created_by, note, expires_at)
         SELECT ?, 'unused', ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM pilot_invitations WHERE status = 'unused' AND (expires_at IS NULL OR expires_at > ?)) < ?`,
      )
      .bind(hash, naa, createdBy, note, expiresAt, naa, MAX_PILOT_DELTAKERE)
      .run();
    if ((r.meta?.changes ?? 0) > 0) koder.push(kode);
    else break; // grensen nådd — stopp, ikke kast bort flere koder.
  }
  const ok = koder.length === onsket;
  return { ok, koder, opprettet: koder.length, error: ok ? undefined : `Grensen på ${MAX_PILOT_DELTAKERE} aktive invitasjoner er nådd (${koder.length} av ${onsket} opprettet).` };
}

/** Forbruk en invitasjon atomisk (binding til identitet ved innlogging). */
export async function forbrukInvitasjon(db: InvitasjonDb, kode: string, email: string, naa: number = Date.now()): Promise<InvitasjonsStatus> {
  const hash = await hashInvitasjonskode(kode);
  const r = await db
    .prepare("UPDATE pilot_invitations SET status = 'used', used_at = ?, used_by_email = ? WHERE invite_hash = ? AND status = 'unused' AND (expires_at IS NULL OR expires_at > ?)")
    .bind(naa, email, hash, naa)
    .run();
  if ((r.meta?.changes ?? 0) > 0) return 'OK';

  const rad = await db.prepare('SELECT status, expires_at FROM pilot_invitations WHERE invite_hash = ?').bind(hash).first<{ status: string; expires_at: number | null }>();
  if (!rad) return 'UGYLDIG';
  if (rad.status === 'revoked') return 'REVOKERT';
  if (rad.status === 'used') return 'BRUKT';
  if (rad.expires_at != null && rad.expires_at <= naa) return 'UTLOPT';
  return 'UGYLDIG';
}

/** Sjekk om en kode er gyldig og ubrukt (uten å forbruke). For /api/auth/request. */
export async function kodeErTilgjengelig(db: InvitasjonDb, kode: string, naa: number = Date.now()): Promise<boolean> {
  const hash = await hashInvitasjonskode(kode);
  const rad = await db
    .prepare("SELECT status, expires_at FROM pilot_invitations WHERE invite_hash = ? AND status = 'unused' AND (expires_at IS NULL OR expires_at > ?)")
    .bind(hash, naa)
    .first<{ status: string }>();
  return !!rad;
}

/** Tilbakekall en invitasjon (unused → revoked). */
export async function tilbakekallInvitasjon(db: InvitasjonDb, kode: string, naa: number = Date.now()): Promise<boolean> {
  const hash = await hashInvitasjonskode(kode);
  const r = await db
    .prepare("UPDATE pilot_invitations SET status = 'revoked', revoked_at = ? WHERE invite_hash = ? AND status = 'unused'")
    .bind(naa, hash)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Admin-liste: ingen rå koder, kun hash-prefiks + status + metadata. */
export async function listeInvitasjoner(db: InvitasjonDb): Promise<Array<{ hash_prefix: string; status: string; created_at: number; used_at: number | null; revoked_at: number | null; expires_at: number | null; note: string | null; used_by_email: string | null }>> {
  const r = await db
    .prepare("SELECT invite_hash, status, created_at, used_at, revoked_at, expires_at, note, used_by_email FROM pilot_invitations ORDER BY created_at DESC")
    .all<{ invite_hash: string; status: string; created_at: number; used_at: number | null; revoked_at: number | null; expires_at: number | null; note: string | null; used_by_email: string | null }>();
  return r.results.map((rad) => ({ ...rad, hash_prefix: rad.invite_hash.slice(0, 8) }));
}
