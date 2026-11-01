/**
 * Felles sosial innlogging: Google, Microsoft og Facebook.
 *
 * Flyt: authorization code med PKCE, state og (for OIDC) nonce.
 *   GET /api/auth/oauth/:provider/start    → sett state+verifier, redirect til leverandør
 *   GET /api/auth/oauth/:provider/callback → verifiser state, veksle kode, valider identitet
 *
 * Sikkerhetsregler:
 *  - Roller: sosial innlogging gir ALLTID CUSTOMER. Aldri ADMIN/OPERATOR.
 *  - Identitet er leverandørens stabile subject, ikke e-post.
 *  - Ingen automatisk kontokobling på lik e-post: kunden må bekrefte med
 *    engangskode (eksisterende OTP-flyt) før koblingen fullføres.
 *  - Facebook uten bekreftet e-post krever e-postbekreftelse på samme måte.
 *  - Ingen tokens, secrets eller rå ID-tokens logges eller returneres.
 */
import type { Env } from '../types';
import { auth } from '../auth';

type Provider = 'google' | 'microsoft' | 'facebook';

type ProviderKonfig = {
  authUrl: string;
  tokenUrl: string;
  jwksUrl?: string;
  issuer?: string[];
  scope: string;
  brukerInfo?: string;
  clientId?: string;
  clientSecret?: string;
};

const PROVIDERS: Record<Provider, (env: Env) => ProviderKonfig> = {
  google: (env) => ({
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  }),
  microsoft: (env) => ({
    // «common» gir både jobb-/skolekontoer og personlige kontoer (hotmail/outlook/live).
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    // Personlige kontoer har fast tenant-id 9188040d-…, jobbkontoer sin egen.
    issuer: undefined,
    scope: 'openid profile email',
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  }),
  facebook: (env) => ({
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scope: 'email public_profile',
    brukerInfo: 'https://graph.facebook.com/v21.0/me?fields=id,name,email',
    clientId: env.FACEBOOK_APP_ID,
    clientSecret: env.FACEBOOK_APP_SECRET,
  }),
};

const GYLDIGE: Provider[] = ['google', 'microsoft', 'facebook'];

function db(env: Env): D1Database | null {
  if (env.ENVIRONMENT === 'staging') return env.FINNBILGLASS_STAGING_AUTH ?? null;
  return env.FINNBILGLASS_DB ?? null;
}

function baseUrl(request: Request): string {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

function callbackUrl(request: Request, p: Provider): string {
  return `${baseUrl(request)}/api/auth/oauth/${p}/callback`;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tilfeldig(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

// ── ID-token (OIDC) ────────────────────────────────────────────────────────
type Jwk = { kid?: string; n?: string; e?: string; kty?: string };
let jwksCache: Record<string, { keys: Jwk[]; hentet: number }> = {};

async function hentJwks(url: string): Promise<Jwk[]> {
  const naa = Date.now();
  const cachet = jwksCache[url];
  if (cachet && naa - cachet.hentet < 60 * 60 * 1000) return cachet.keys;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`JWKS_HTTP_${r.status}`);
  const j = (await r.json()) as { keys?: Jwk[] };
  if (!j.keys?.length) throw new Error('JWKS_TOM');
  jwksCache[url] = { keys: j.keys, hentet: naa };
  return j.keys;
}

function b64urlTilJson<T>(s: string): T {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const ut = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) ut[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(ut)) as T;
}

type Krav = {
  iss?: string; aud?: string; exp?: number; sub?: string; nonce?: string;
  email?: string; email_verified?: boolean | string; name?: string;
  preferred_username?: string; tid?: string;
};

async function verifiserIdToken(
  token: string, cfg: ProviderKonfig, clientId: string, nonce: string | null,
): Promise<{ ok: true; krav: Krav } | { ok: false; feil: string }> {
  const d = token.split('.');
  if (d.length !== 3 || !cfg.jwksUrl) return { ok: false, feil: 'UGYLDIG_TOKEN' };
  let header: { alg?: string; kid?: string };
  let krav: Krav;
  try {
    header = b64urlTilJson<{ alg?: string; kid?: string }>(d[0]);
    krav = b64urlTilJson<Krav>(d[1]);
  } catch { return { ok: false, feil: 'UGYLDIG_TOKEN' }; }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, feil: 'UGYLDIG_ALGORITME' };

  const keys = await hentJwks(cfg.jwksUrl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk?.n || !jwk?.e) return { ok: false, feil: 'UKJENT_NOKKEL' };

  let gyldig = false;
  try {
    const nokkel = await crypto.subtle.importKey(
      'jwk', { kty: jwk.kty || 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    const sig = (() => {
      const pad = d[2].length % 4 === 0 ? '' : '='.repeat(4 - (d[2].length % 4));
      const bin = atob((d[2] + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    })();
    gyldig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', nokkel, sig, new TextEncoder().encode(`${d[0]}.${d[1]}`));
  } catch { return { ok: false, feil: 'SIGNATURFEIL' }; }
  if (!gyldig) return { ok: false, feil: 'UGYLDIG_SIGNATUR' };

  // Microsoft «common»: issuer inneholder tenant-id. Godta kun microsoftonline.com-formen
  // og aldri andre utstedere.
  if (cfg.issuer) {
    if (!krav.iss || !cfg.issuer.includes(krav.iss)) return { ok: false, feil: 'UGYLDIG_UTSTEDER' };
  } else if (!krav.iss || !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(krav.iss)) {
    return { ok: false, feil: 'UGYLDIG_UTSTEDER' };
  }

  if (krav.aud !== clientId) return { ok: false, feil: 'UGYLDIG_AUDIENCE' };
  const naa = Math.floor(Date.now() / 1000);
  if (typeof krav.exp !== 'number' || krav.exp <= naa) return { ok: false, feil: 'UTLOPT_TOKEN' };
  if (nonce && krav.nonce !== nonce) return { ok: false, feil: 'UGYLDIG_NONCE' };
  return { ok: true, krav };
}

// ── Ruter ──────────────────────────────────────────────────────────────────
export async function handleOAuthStart(request: Request, env: Env, provider: string): Promise<Response> {
  if (!GYLDIGE.includes(provider as Provider)) return new Response('Ukjent leverandør', { status: 404 });
  const p = provider as Provider;
  const cfg = PROVIDERS[p](env);
  if (!cfg.clientId || !cfg.clientSecret) {
    return Response.redirect(`${baseUrl(request)}/innlogging?feil=ikke_konfigurert&leverandor=${p}`, 302);
  }

  const database = db(env);
  if (!database) return Response.redirect(`${baseUrl(request)}/innlogging?feil=innlogging_av`, 302);

  const state = tilfeldig(24);
  const verifier = tilfeldig(48);
  const nonce = p === 'facebook' ? null : tilfeldig(24);
  const naa = Date.now();

  await database.prepare(
    'INSERT INTO oauth_states (state, provider, code_verifier, nonce, opprettet, utloper) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(state, p, verifier, nonce, naa, naa + 10 * 60 * 1000).run();

  const challenge = b64url(await sha256(verifier));
  const u = new URL(cfg.authUrl);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', callbackUrl(request, p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (nonce) u.searchParams.set('nonce', nonce);
  if (p === 'google') { u.searchParams.set('access_type', 'online'); u.searchParams.set('prompt', 'select_account'); }
  if (p === 'microsoft') u.searchParams.set('response_mode', 'query');
  if (p === 'facebook') u.searchParams.set('auth_type', 'rerequest');

  return Response.redirect(u.toString(), 302);
}

type TokenSvar = { id_token?: string; access_token?: string; error?: string; error_description?: string };

export async function handleOAuthCallback(request: Request, env: Env, provider: string): Promise<Response> {
  const fail = (kode: string) => Response.redirect(`${baseUrl(request)}/innlogging?feil=${kode}&leverandor=${provider}`, 302);
  if (!GYLDIGE.includes(provider as Provider)) return new Response('Ukjent leverandør', { status: 404 });
  const p = provider as Provider;
  const cfg = PROVIDERS[p](env);
  const database = db(env);
  if (!database || !cfg.clientId || !cfg.clientSecret) return fail('ikke_konfigurert');

  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (url.searchParams.get('error')) return fail('avbrutt');
  if (!state || !code) return fail('ugyldig_callback');

  const rad = await database.prepare(
    'SELECT provider, code_verifier, nonce, utloper FROM oauth_states WHERE state = ?',
  ).bind(state).first<{ provider: string; code_verifier: string; nonce: string | null; utloper: number }>();
  // Engangsbruk: state slettes uansett utfall.
  await database.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!rad || rad.provider !== p || rad.utloper < Date.now()) return fail('utlopt_state');

  // Veksle kode → tokens (PKCE).
  const kropp = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(request, p),
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: rad.code_verifier,
  });
  let tokens: TokenSvar = {};
  try {
    const r = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: kropp.toString(),
    });
    tokens = (await r.json()) as TokenSvar;
    if (!r.ok || tokens.error) return fail('token_feilet');
  } catch {
    return fail('token_feilet');
  }

  // Identitet
  let subject = '';
  let epost: string | null = null;
  let navn = '';
  let epostVerifisert = false;

  if (p === 'facebook') {
    if (!tokens.access_token) return fail('mangler_token');
    try {
      const proof = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cfg.clientSecret)));
      const r = await fetch(`${cfg.brukerInfo}&appsecret_proof=${encodeURIComponent(proof)}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
      });
      if (!r.ok) return fail('profil_feilet');
      const prof = (await r.json()) as { id?: string; name?: string; email?: string };
      subject = String(prof.id || '');
      navn = String(prof.name || '');
      epost = prof.email ? String(prof.email).toLowerCase() : null;
      // Facebook bekrefter ikke e-post i Graph API på samme måte som OIDC.
      epostVerifisert = false;
    } catch {
      return fail('profil_feilet');
    }
  } else {
    if (!tokens.id_token) return fail('mangler_id_token');
    let v;
    try {
      v = await verifiserIdToken(tokens.id_token, cfg, cfg.clientId, rad.nonce);
    } catch {
      return fail('verifisering_feilet');
    }
    if (!v.ok) return fail(v.feil.toLowerCase());
    const k = v.krav;
    subject = String(k.sub || '');
    epost = (k.email || k.preferred_username || '').toLowerCase() || null;
    navn = String(k.name || '');
    epostVerifisert = k.email_verified === true || k.email_verified === 'true' || p === 'microsoft';
  }

  if (!subject) return fail('mangler_subject');

  const kolonne = p === 'google' ? 'google_sub' : p === 'microsoft' ? 'microsoft_sub' : 'facebook_sub';
  const naa = Date.now();

  // 1) Allerede koblet.
  let bruker = await database.prepare(
    `SELECT user_id, email, name FROM auth_users WHERE ${kolonne} = ?`,
  ).bind(subject).first<{ user_id: string; email: string; name: string | null }>();

  // 2) Eksisterende konto med samme e-post → KREV bekreftelse (ingen automatisk kobling).
  if (!bruker && epost && epostVerifisert) {
    const finnes = await database.prepare(
      'SELECT user_id FROM auth_users WHERE lower(email) = ?',
    ).bind(epost).first<{ user_id: string }>();
    if (finnes) {
      const token = tilfeldig(24);
      await database.prepare(
        'INSERT INTO oauth_pending_links (token, provider, subject, epost, navn, opprettet, utloper) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(token, p, subject, epost, navn, naa, naa + 15 * 60 * 1000).run();
      return Response.redirect(`${baseUrl(request)}/innlogging?koble=${token}`, 302);
    }
  }

  // 3) Uten verifisert e-post (typisk Facebook): krev e-postbekreftelse.
  if (!bruker && (!epost || !epostVerifisert)) {
    const token = tilfeldig(24);
    await database.prepare(
      'INSERT INTO oauth_pending_links (token, provider, subject, epost, navn, opprettet, utloper) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(token, p, subject, epost, navn, naa, naa + 15 * 60 * 1000).run();
    return Response.redirect(`${baseUrl(request)}/innlogging?epost_kreves=${token}`, 302);
  }

  // 4) Ny kunde.
  if (!bruker) {
    const userId = 'user_' + crypto.randomUUID().replace(/-/g, '');
    await database.prepare(
      `INSERT INTO auth_users (user_id, email, role, name, created_at, updated_at, ${kolonne}) VALUES (?, ?, 'CUSTOMER', ?, ?, ?, ?)`,
    ).bind(userId, epost, navn, naa, naa, subject).run();
    bruker = { user_id: userId, email: epost as string, name: navn };
  }

  return opprettSesjon(request, env, database, bruker.user_id, bruker.email, bruker.name, navn);
}

/** Oppretter CUSTOMER-sesjon og sender kunden til Min side. */
async function opprettSesjon(
  request: Request, env: Env, database: D1Database,
  userId: string, epost: string, lagretNavn: string | null, leverandorNavn: string,
): Promise<Response> {
  let navn = '';
  try {
    const rad = await database.prepare('SELECT navn FROM beta_inquiries WHERE lower(kontakt) LIKE ? ORDER BY created_at DESC LIMIT 1')
      .bind(`%${epost.toLowerCase()}%`).first<{ navn: string | null }>();
    const n = (rad?.navn || '').trim();
    if (n && !n.includes('@') && n.length <= 80) navn = n;
  } catch { /* navn er valgfritt */ }
  if (!navn) navn = lagretNavn || leverandorNavn || epost.split('@')[0];

  const sesjon = await auth.createSession({ email: epost, role: 'CUSTOMER', name: navn, userId });
  const svar = new Response(null, {
    status: 302,
    headers: {
      Location: `${baseUrl(request)}/min-side`,
      'Set-Cookie': `fb_session=${sesjon.sessionId}; ${auth.getCookieOptions()}`,
      'Cache-Control': 'no-store',
    },
  });
  return svar;
}

/** GET /api/auth/oauth/providers — hvilke innloggingsmetoder er faktisk konfigurert. */
export async function handleProviders(env: Env): Promise<Response> {
  const klar = (p: Provider) => {
    const c = PROVIDERS[p](env);
    return !!(c.clientId && c.clientSecret);
  };
  return new Response(
    JSON.stringify({ ok: true, providers: { google: klar('google'), microsoft: klar('microsoft'), facebook: klar('facebook') } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}

/** GET /api/auth/oauth/link-info?token=… — maskert e-post for en ventende kobling. */
export async function handleLinkInfo(request: Request, env: Env): Promise<Response> {
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return json({ ok: false }, 400);
  const database = db(env);
  if (!database) return json({ ok: false }, 503);
  try {
    const rad = await database.prepare('SELECT epost, provider, utloper FROM oauth_pending_links WHERE token = ?')
      .bind(token).first<{ epost: string | null; provider: string; utloper: number }>();
    if (!rad || rad.utloper < Date.now()) return json({ ok: false }, 404);
    let maskert = '';
    if (rad.epost) {
      const [bruker, domene] = rad.epost.split('@');
      maskert = `${bruker.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, bruker.length - 1)))}@${domene}`;
    }
    return json({ ok: true, provider: rad.provider, epostMaskert: maskert });
  } catch {
    return json({ ok: false }, 500);
  }
}

/** Fullfører en ventende kobling etter bekreftet engangskode. Kalles fra OTP-verifiseringen. */
export async function fullforKobling(env: Env, token: string, epost: string): Promise<{ ok: boolean }> {
  const database = db(env);
  if (!database) return { ok: false };
  const rad = await database.prepare(
    'SELECT provider, subject, epost, navn, utloper FROM oauth_pending_links WHERE token = ?',
  ).bind(token).first<{ provider: string; subject: string; epost: string | null; navn: string | null; utloper: number }>();
  await database.prepare('DELETE FROM oauth_pending_links WHERE token = ?').bind(token).run();
  if (!rad || rad.utloper < Date.now()) return { ok: false };
  // Kunden har bevist kontroll over e-posten via engangskoden.
  if (rad.epost && rad.epost.toLowerCase() !== epost.toLowerCase()) return { ok: false };
  const kolonne = rad.provider === 'google' ? 'google_sub' : rad.provider === 'microsoft' ? 'microsoft_sub' : 'facebook_sub';
  await database.prepare(
    `UPDATE auth_users SET ${kolonne} = COALESCE(${kolonne}, ?), updated_at = ? WHERE lower(email) = ?`,
  ).bind(rad.subject, Date.now(), epost.toLowerCase()).run();
  return { ok: true };
}
