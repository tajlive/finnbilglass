/**
 * Strict, signature-verified Cloudflare Access identity for NEW manual order routes.
 * Legacy SUPPORT_EVIDENCE_TOKEN must never authorize order creation.
 *
 * Cloudflare's Static Assets router does not propagate ctx.access, so this
 * verifies Cf-Access-Jwt-Assertion independently using the configured team JWKS.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */
export interface ManualOpsAccessEnv {
  OPS_ACCESS_TEAM_DOMAIN?: string;
  OPS_ACCESS_AUD?: string;
  OPS_MANUAL_STAFF_EMAILS?: string;
}
export interface VerifiedStaff {
  email: string;
  subject: string;
  audience: string;
}

function parseBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 18000) throw new Error('INVALID_JWT_ENCODING');
  const base = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base.padEnd(Math.ceil(base.length / 4) * 4, '='));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> {
  const raw = new TextDecoder().decode(parseBase64Url(part));
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JWT_PART');
  return parsed as Record<string, unknown>;
}

function normaliseTeam(team: string | undefined): string | null {
  if (!team) return null;
  const value = team.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9.-]{2,120}\.cloudflareaccess\.com$/.test(value) || value.includes('..')) return null;
  return 'https://' + value;
}

interface AccessJwk extends JsonWebKey { kid?: string; alg?: string; use?: string }
async function accessKey(team: string, kid: string): Promise<AccessJwk | null> {
  // The only network destination is a validated Cloudflare Access team domain.
  const response = await fetch(team + '/cdn-cgi/access/certs',
    {headers:{'Accept':'application/json'}, signal: AbortSignal.timeout(3500)});
  if (!response.ok) return null;
  const keys = await response.json() as { keys?: AccessJwk[] };
  if (!Array.isArray(keys.keys) || keys.keys.length > 16) return null;
  return keys.keys.find(k => k.kid === kid && k.kty === 'RSA' &&
    k.alg !== 'none' && (!k.use || k.use === 'sig') && typeof k.n === 'string' &&
    typeof k.e === 'string') ?? null;
}

/** Returns null on ANY missing config, forged signature, expired token or disallowed staff. */
export async function verifyManualOpsStaff(
  request: Request,
  env: ManualOpsAccessEnv,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<VerifiedStaff | null> {
  const team = normaliseTeam(env.OPS_ACCESS_TEAM_DOMAIN);
  const audience = env.OPS_ACCESS_AUD?.trim();
  const allow = new Set((env.OPS_MANUAL_STAFF_EMAILS ?? '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean));
  if (!team || !audience || audience.length < 20 || !allow.size) return null;
  const bearer = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!bearer || bearer.length > 12000) return null;
  const parts = bearer.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        header.kid.length > 180) return null;
    const issued = claims.iat, expires = claims.exp, notBefore = claims.nbf;
    if (claims.iss !== team || !Array.isArray(claims.aud) ||
        !claims.aud.includes(audience) ||
        typeof issued !== 'number' || issued > nowSeconds + 60 ||
        typeof expires !== 'number' || expires <= nowSeconds ||
        (notBefore !== undefined && (typeof notBefore !== 'number' || notBefore > nowSeconds))) return null;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase().trim() : '';
    if (!email || !allow.has(email) || typeof claims.sub !== 'string' || !claims.sub) return null;

    const jwk = await accessKey(team, header.kid);
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey('jwk', jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const signature = parseBase64Url(parts[2]);
    const signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey,
      signature, signingInput);
    return valid ? {email,subject:claims.sub,audience} : null;
  } catch {
    // Do not fall back to unverified identity headers or legacy support tokens.
    return null;
  }
}

/** CSRF defense: write requests are same-origin JSON with an intent header. */
export function validManualWriteOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || request.headers.get('X-FBG-Manual-Intent') !== '1') return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin &&
      request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') === true;
  } catch { return false; }
}
