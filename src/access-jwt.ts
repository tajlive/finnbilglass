/**
 * Verifisering av Cloudflare Access-identitet på serversiden.
 *
 * Access legger et signert JWT i headeren «Cf-Access-Jwt-Assertion» for hver
 * forespørsel som har en gyldig Access-sesjon. Vi verifiserer signaturen mot
 * Access' egne nøkler og kontrollerer issuer, audience og utløp — vi stoler
 * aldri på et e-postfelt fra klienten eller på en uverifisert header.
 *
 * Merk: headeren kan ikke forfalskes utenfra, fordi Access fjerner/overskriver
 * den før forespørselen når Workeren (forutsatt at appen er Access-beskyttet).
 * Signaturen kontrolleres likevel alltid.
 */
import type { Env } from './types';

type Jwk = { kid?: string; n?: string; e?: string; kty?: string };
type Cert = { keys: Jwk[] };

let certCache: { nokler: Cert; hentet: number } | null = null;

async function hentCerts(teamDomene: string): Promise<Cert> {
  const naa = Date.now();
  if (certCache && naa - certCache.hentet < 60 * 60 * 1000) return certCache.nokler;
  const r = await fetch(`https://${teamDomene}/cdn-cgi/access/certs`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`ACCESS_CERTS_${r.status}`);
  const j = (await r.json()) as Cert;
  if (!j?.keys?.length) throw new Error('ACCESS_CERTS_TOM');
  certCache = { nokler: j, hentet: naa };
  return j;
}

function b64urlTilBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const ut = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) ut[i] = bin.charCodeAt(i);
  return ut;
}

function b64urlTilJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlTilBytes(s))) as T;
}

export type AccessIdentitet = { epost: string; sub: string | null };

/** Verifiserer Access-JWT-en på forespørselen. Returnerer null når den ikke er gyldig. */
export async function verifiserAccess(request: Request, env: Env): Promise<AccessIdentitet | null> {
  const team = (env.ACCESS_TEAM_DOMAIN || '').trim();
  const aud = (env.ACCESS_AUD || '').trim();
  if (!team || !aud) return null; // ikke konfigurert → ingen Access-identitet

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;

  const deler = token.split('.');
  if (deler.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let krav: { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; email?: string; sub?: string };
  try {
    header = b64urlTilJson<{ alg?: string; kid?: string }>(deler[0]);
    krav = b64urlTilJson(deler[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let nokler: Cert;
  try {
    nokler = await hentCerts(team);
  } catch {
    return null; // fail-closed
  }
  const jwk = nokler.keys.find((k) => k.kid === header.kid);
  if (!jwk?.n || !jwk?.e) return null;

  let gyldig = false;
  try {
    const nokkel = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty || 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    gyldig = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      nokkel,
      b64urlTilBytes(deler[2]),
      new TextEncoder().encode(`${deler[0]}.${deler[1]}`),
    );
  } catch {
    return null;
  }
  if (!gyldig) return null;

  const naa = Math.floor(Date.now() / 1000);
  if (krav.iss !== `https://${team}`) return null;
  const audOk = Array.isArray(krav.aud) ? krav.aud.includes(aud) : krav.aud === aud;
  if (!audOk) return null;
  if (typeof krav.exp !== 'number' || krav.exp <= naa) return null;
  if (typeof krav.nbf === 'number' && krav.nbf > naa + 60) return null;
  if (!krav.email) return null;

  return { epost: krav.email.toLowerCase(), sub: krav.sub ?? null };
}
