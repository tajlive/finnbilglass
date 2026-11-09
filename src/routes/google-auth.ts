/**
 * Google-innlogging for kunder (Google Identity Services).
 *
 * Klienten sender Googles ID-token (JWT) til POST /api/auth/google.
 * Her verifiseres signaturen mot Googles JWKS, og issuer, audience,
 * utløp og «email_verified» kontrolleres før en vanlig CUSTOMER-sesjon
 * opprettes med samme HttpOnly-cookie som OTP-innloggingen bruker.
 *
 * Sikkerhetsregler:
 *  - Google gir ALDRI ADMIN/OPERATOR. Sesjonen er alltid CUSTOMER.
 *  - Identitet er Googles «sub», ikke e-post.
 *  - Kobling til eksisterende bruker skjer kun på verifisert e-post lik
 *    eksisterende e-post — aldri på navn eller delvis treff.
 *  - Ingen tokens, secrets eller rå ID-tokens logges eller returneres.
 */
import type { Env } from '../types';
import { auth } from '../auth';

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

type Jwk = { kid?: string; n?: string; e?: string; kty?: string; alg?: string; use?: string };
type Jwks = { keys: Jwk[] };

// Enkel prosess-cache for Google-nøklene (roteres sjelden).
let jwksCache: { keys: Jwks; hentet: number } | null = null;

async function hentJwks(): Promise<Jwks> {
  const naa = Date.now();
  if (jwksCache && naa - jwksCache.hentet < 60 * 60 * 1000) return jwksCache.keys;
  const r = await fetch(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`JWKS_HTTP_${r.status}`);
  const keys = (await r.json()) as Jwks;
  if (!keys?.keys?.length) throw new Error('JWKS_TOM');
  jwksCache = { keys, hentet: naa };
  return keys;
}

function b64urlTilBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const ut = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) ut[i] = bin.charCodeAt(i);
  return ut;
}

function b64urlTilJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlTilBytes(s))) as T;
}

type IdTokenKrav = {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
};

/** Verifiserer Googles ID-token fullt ut. Returnerer krav eller feilkode. */
async function verifiserIdToken(token: string, clientId: string): Promise<{ ok: true; krav: IdTokenKrav } | { ok: false; feil: string }> {
  const deler = token.split('.');
  if (deler.length !== 3) return { ok: false, feil: 'UGYLDIG_TOKEN' };

  let header: { alg?: string; kid?: string };
  let krav: IdTokenKrav;
  try {
    header = b64urlTilJson<{ alg?: string; kid?: string }>(deler[0]);
    krav = b64urlTilJson<IdTokenKrav>(deler[1]);
  } catch {
    return { ok: false, feil: 'UGYLDIG_TOKEN' };
  }

  if (header.alg !== 'RS256' || !header.kid) return { ok: false, feil: 'UGYLDIG_ALGORITME' };

  const jwks = await hentJwks();
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk || !jwk.n || !jwk.e) return { ok: false, feil: 'UKJENT_NOKKEL' };

  let gyldig = false;
  try {
    const nøkkel = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty || 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    gyldig = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      nøkkel,
      b64urlTilBytes(deler[2]),
      new TextEncoder().encode(`${deler[0]}.${deler[1]}`),
    );
  } catch {
    return { ok: false, feil: 'SIGNATURFEIL' };
  }
  if (!gyldig) return { ok: false, feil: 'UGYLDIG_SIGNATUR' };

  if (!krav.iss || !GOOGLE_ISSUERS.has(krav.iss)) return { ok: false, feil: 'UGYLDIG_UTSTEDER' };
  if (krav.aud !== clientId) return { ok: false, feil: 'UGYLDIG_AUDIENCE' };
  const naa = Math.floor(Date.now() / 1000);
  if (typeof krav.exp !== 'number' || krav.exp <= naa) return { ok: false, feil: 'UTLOPT_TOKEN' };
  const epostVerifisert = krav.email_verified === true || krav.email_verified === 'true';
  if (!krav.email || !epostVerifisert) return { ok: false, feil: 'EPOST_IKKE_VERIFISERT' };
  if (!krav.sub) return { ok: false, feil: 'MANGLER_SUB' };

  return { ok: true, krav };
}

/** D1-basen der auth-tabellene ligger (samme regel som resten av auth-laget). */
function authDb(env: Env): D1Database | null {
  if (env.ENVIRONMENT === 'staging') return env.FINNBILGLASS_STAGING_AUTH ?? null;
  return env.FINNBILGLASS_DB ?? null;
}

/** Kundenavn fra kundens siste forespørsel (samme kilde som OTP-flyten). */
async function navnFraSaker(db: D1Database, email: string): Promise<string | null> {
  try {
    const rad = await db
      .prepare('SELECT navn FROM beta_inquiries WHERE lower(kontakt) LIKE ? ORDER BY created_at DESC LIMIT 1')
      .bind(`%${email.toLowerCase()}%`)
      .first<{ navn: string | null }>();
    const navn = (rad?.navn || '').trim();
    if (!navn || navn.includes('@') || navn.length > 80) return null;
    return navn;
  } catch {
    return null;
  }
}

/** GET /api/auth/google/config — returnerer kun offentlig client_id. */
export async function handleGoogleConfig(env: Env): Promise<Response> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID || '';
  return new Response(
    JSON.stringify({ ok: !!clientId, clientId }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } },
  );
}

/** POST /api/auth/google — verifiser ID-token og opprett CUSTOMER-sesjon. */
export async function handleGoogleLogin(request: Request, env: Env): Promise<Response> {
  const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...extra },
    });

  if (!env.GOOGLE_OAUTH_CLIENT_ID) return json({ ok: false, error: 'GOOGLE_IKKE_KONFIGURERT' }, 503);

  let body: { credential?: unknown };
  try {
    body = (await request.json()) as { credential?: unknown };
  } catch {
    return json({ ok: false, error: 'UGYLDIG_JSON' }, 400);
  }
  if (typeof body.credential !== 'string' || body.credential.length < 20 || body.credential.length > 8000) {
    return json({ ok: false, error: 'MANGLER_TOKEN' }, 400);
  }

  let verifisert;
  try {
    verifisert = await verifiserIdToken(body.credential, env.GOOGLE_OAUTH_CLIENT_ID);
  } catch (e) {
    console.error('Google token-verifisering feilet:', (e as Error).message);
    return json({ ok: false, error: 'VERIFISERING_FEILET' }, 502);
  }
  if (!verifisert.ok) return json({ ok: false, error: verifisert.feil }, 401);

  const { sub, email } = verifisert.krav as { sub: string; email: string };
  const db = authDb(env);
  if (!db) return json({ ok: false, error: 'INNLOGGING_IKKE_AKTIVERT' }, 503);

  const epost = email.toLowerCase();
  const naa = Date.now();

  let bruker: { user_id: string; email: string; name: string | null } | null = null;
  try {
    // 1) Allerede koblet Google-konto.
    bruker = await db
      .prepare('SELECT user_id, email, name FROM auth_users WHERE google_sub = ?')
      .bind(sub)
      .first<{ user_id: string; email: string; name: string | null }>();

    // 2) Ellers: koble til eksisterende bruker med samme verifiserte e-post.
    if (!bruker) {
      const eksisterende = await db
        .prepare('SELECT user_id, email, name, google_sub FROM auth_users WHERE lower(email) = ?')
        .bind(epost)
        .first<{ user_id: string; email: string; name: string | null; google_sub: string | null }>();
      if (eksisterende) {
        // Aldri overskriv en annen Google-kobling.
        if (!eksisterende.google_sub) {
          await db
            .prepare('UPDATE auth_users SET google_sub = ?, updated_at = ? WHERE user_id = ?')
            .bind(sub, naa, eksisterende.user_id)
            .run();
        }
        bruker = { user_id: eksisterende.user_id, email: eksisterende.email, name: eksisterende.name };
      }
    }

    // 3) Ny kunde.
    if (!bruker) {
      const userId = 'user_' + crypto.randomUUID().replace(/-/g, '');
      await db
        .prepare(
          "INSERT INTO auth_users (user_id, email, role, name, created_at, updated_at, google_sub) VALUES (?, ?, 'CUSTOMER', ?, ?, ?, ?)",
        )
        .bind(userId, epost, '', naa, naa, sub)
        .run();
      bruker = { user_id: userId, email: epost, name: '' };
    }
  } catch (e) {
    console.error('Google brukeroppslag feilet:', (e as Error).message);
    return json({ ok: false, error: 'DB_FEIL' }, 500);
  }

  // Visningsnavn: kundens eget navn fra saken først, deretter Googles navn.
  const fraSak = await navnFraSaker(db, epost);
  const googleNavn = (verifisert.krav.name || verifisert.krav.given_name || '').trim();
  const visningsnavn = fraSak || googleNavn || bruker.name || epost.split('@')[0];

  const sesjon = await auth.createSession({
    email: epost,
    // Fast CUSTOMER: Google-innlogging kan aldri gi ADMIN/OPERATOR.
    role: 'CUSTOMER',
    name: visningsnavn,
    userId: bruker.user_id,
  });

  return json(
    {
      ok: true,
      user: { userId: bruker.user_id, email: epost, role: 'CUSTOMER', name: visningsnavn },
      expiresAt: sesjon.expiresAt,
    },
    200,
    { 'Set-Cookie': `fb_session=${sesjon.sessionId}; ${auth.getCookieOptions()}` },
  );
}
