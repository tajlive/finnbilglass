/**
 * Cloudflare Access-identitetsverifisering for Operations Center (P0, Spor A).
 *
 * Verifiserer Cf-Access-Jwt-Assertion (RS256) med Cloudflare Access' JWKS:
 * signatur, issuer, audience og utløp. Fail-closed: manglende/ugyldig
 * konfigurasjon eller ugyldig JWT → null (ingen adgang). Stoler ALDRI på
 * e-postheader alene (den kan forfalskes utenfor Cloudflare-nettet).
 *
 * Konfigurasjon (env): ACCESS_TEAM_DOMAIN (f.eks. 'finnbilglass'),
 * ACCESS_AUD (Access-applikasjonens AUD, 32 hex). Uten disse er Access
 * «ikke konfigurert» og adminautentisering faller tilbake til delt token.
 */

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

export function accessKonfigurert(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): AccessConfig | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  return { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD };
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson<T>(s: string): T {
  const bytes = b64urlDecode(s);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Valider JWT-claims: exp (obligatorisk og frem i tid), iss, aud og e-post.
 * Fail-closed: manglende/utløpt exp, feil iss/aud eller manglende e-post → null.
 */
export function validerClaims(
  payload: { exp?: number; nbf?: number; iss?: string; aud?: string | string[]; email?: string },
  cfg: AccessConfig,
  now: number,
): string | null {
  if (payload.exp == null || payload.exp < now) return null; // exp må finnes og være frem i tid
  if (payload.nbf != null && payload.nbf > now) return null; // ikke gyldig før nbf
  if (payload.iss !== `https://${cfg.teamDomain}.cloudflareaccess.com`) return null; // feil issuer
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(cfg.aud) : payload.aud === cfg.aud;
  if (!audOk) return null; // feil audience
  return payload.email ?? null;
}

/**
 * Verifiser Cloudflare Access-JWT. Returnerer verifisert e-post eller null.
 * Fail-closed: enhver feil (signatur, iss, aud, exp, ukjent kid) → null.
 */
export async function verifiserAccessJwt(request: Request, cfg: AccessConfig | null): Promise<string | null> {
  if (!cfg) return null;
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;
  const deler = jwt.split('.');
  if (deler.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = deler;
  try {
    const header = b64urlJson<{ alg?: string; kid?: string }>(headerB64);
    if (header.alg !== 'RS256' || !header.kid) return null;

    const jwksRes = await fetch(`https://${cfg.teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!jwksRes.ok) return null;
    const { keys } = await jwksRes.json() as { keys: Array<JsonWebKey & { kid?: string }> };
    const key = keys.find((k) => k.kid === header.kid);
    if (!key) return null;

    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = b64urlDecode(sigB64);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!ok) return null;

    const payload = b64urlJson<{ exp?: number; nbf?: number; iss?: string; aud?: string | string[]; email?: string }>(payloadB64);
    return validerClaims(payload, cfg, Math.floor(Date.now() / 1000));
  } catch {
    return null; // fail-closed på enhver parse-/kryptofeil
  }
}

/** Verifisert admin-e-post fra Access-JWT, eller null. */
export async function accessAdminEmail(request: Request, env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): Promise<string | null> {
  return verifiserAccessJwt(request, accessKonfigurert(env));
}
