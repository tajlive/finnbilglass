/**
 * CSP-bruddrapporter (report-only-fasen).
 *
 * Mottar rapporter fra nettleseren, minimerer dem og lagrer aggregert statistikk.
 * Bevisst lagring:
 *   - direktiv (f.eks. script-src)
 *   - vert for blokkert ressurs (uten sti eller query)
 *   - sidesti (uten query — kan inneholde sesong-/søkeparametre)
 *   - antall
 * Aldri full URL, aldri tokens, aldri e-post eller kundedata.
 *
 * Forsvar mot misbruk:
 *   - avviser for store forespørsler FØR kroppen leses (Content-Length)
 *   - leser aldri mer enn MAKS_KROPP tegn
 *   - rate limit per IP + beskyttelse av minnebruk
 *   - maks ANTALL_PER_KALL databaseoperasjoner per forespørsel
 */
import type { Env } from '../types';

const MAKS_KROPP = 8 * 1024;      // 8 kB — rapporter er små
const ANTALL_PER_KALL = 5;        // maks DB-skrivinger per forespørsel
const RATE_VINDU_MS = 60_000;     // 1 minutt
const RATE_MAKS = 20;             // maks 20 rapporter per IP per minutt

// Prosess-lokal rate limit (per isolat). Stopper løkker og enkelthendelser uten
// å koste en D1-skriving per forespørsel. Ikke en global garanti — derfor også
// tak på antall DB-operasjoner per kall.
const rateTreff = new Map<string, { antall: number; start: number }>();

function innenforRate(ip: string): boolean {
  const naa = Date.now();
  const treff = rateTreff.get(ip);
  if (!treff || naa - treff.start > RATE_VINDU_MS) {
    if (rateTreff.size > 5000) rateTreff.clear(); // beskytt minnebruk
    rateTreff.set(ip, { antall: 1, start: naa });
    return true;
  }
  treff.antall += 1;
  return treff.antall <= RATE_MAKS;
}

function vert(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.slice(0, 100);
  } catch {
    return url.startsWith("'") || url.startsWith('data:') ? url.slice(0, 40) : '';
  }
}

/** Kun sti — query fjernes bevisst, og bare trygg sti-syntaks beholdes. */
function sti(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    const p = new URL(url).pathname.slice(0, 200);
    return p.replace(/[^a-zA-Z0-9/_\-.]/g, '');
  } catch {
    return '';
  }
}

/** Leser kroppen med hard byte-grense via strøm — uten å bufre mer enn taket. */
async function lesBegrenset(request: Request, maks: number): Promise<string | null> {
  const kropp = request.body;
  if (!kropp) return '';
  const leser = kropp.getReader();
  const biter: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maks) {
        await leser.cancel(); // avbryt strømmen umiddelbart
        return null;
      }
      biter.push(value);
    }
  } catch {
    return null;
  }
  const samlet = new Uint8Array(total);
  let p = 0;
  for (const b of biter) {
    samlet.set(b, p);
    p += b.length;
  }
  return new TextDecoder().decode(samlet);
}

export async function handleCspReport(request: Request, env: Env): Promise<Response> {
  const tom = new Response(null, { status: 204 });

  // 1) Avvis for store forespørsler uten å lese kroppen i minnet.
  const lengde = Number(request.headers.get('content-length') || 0);
  if (lengde > MAKS_KROPP) return new Response(null, { status: 413 });

  // 2) Rate limit per IP.
  const ip = request.headers.get('cf-connecting-ip') || 'ukjent';
  if (!innenforRate(ip)) return new Response(null, { status: 429 });

  // 3) Strømlesing med hard grense — gjelder også når Content-Length mangler.
  const tekst = await lesBegrenset(request, MAKS_KROPP);
  if (tekst === null) return new Response(null, { status: 413 });
  if (!tekst) return tom;

  let kropp: unknown;
  try {
    kropp = JSON.parse(tekst);
  } catch {
    return tom; // ugyldig JSON ignoreres stille
  }

  // Både legacy («csp-report») og Reporting API (array) godtas.
  const rapporter: Record<string, unknown>[] = [];
  if (Array.isArray(kropp)) {
    for (const r of kropp) {
      const b = (r as { body?: Record<string, unknown> })?.body;
      if (b) rapporter.push(b);
    }
  } else {
    const csp = (kropp as { 'csp-report'?: Record<string, unknown> })['csp-report'];
    if (csp) rapporter.push(csp);
  }
  if (!rapporter.length) return tom;

  const db = env.ENVIRONMENT === 'staging' ? env.FINNBILGLASS_STAGING_AUTH : env.FINNBILGLASS_DB;
  if (!db) return tom;

  const naa = Date.now();
  const sett = new Set<string>();

  for (const r of rapporter.slice(0, ANTALL_PER_KALL)) {
    const direktiv = String(
      (r['effective-directive'] as string) || (r['effectiveDirective'] as string) || (r['violated-directive'] as string) || 'ukjent',
    ).slice(0, 60);
    const blokkert = vert(r['blocked-uri'] ?? r['blockedURI']);
    const side = sti(r['document-uri'] ?? r['documentURI']);
    const nokkel = `${direktiv}|${blokkert}|${side}`;
    if (sett.has(nokkel)) continue;
    sett.add(nokkel);
    try {
      await db
        .prepare(
          `INSERT INTO csp_reports (direktiv, blokkert_vert, side_sti, antall, forst_sett, sist_sett)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(direktiv, blokkert_vert, side_sti)
           DO UPDATE SET antall = antall + 1, sist_sett = excluded.sist_sett`,
        )
        .bind(direktiv, blokkert, side, naa, naa)
        .run();
    } catch {
      // Rapportering skal aldri påvirke brukeren.
    }
  }

  return tom;
}

/**
 * Streng CSP. Report-Only inntil rapportene viser at alt fungerer.
 *
 * - script-src har INGEN 'unsafe-inline': alle skript er flyttet til egne filer.
 * - style-src-elem er 'self': alle <style>-blokker er flyttet til CSS-filer.
 * - style-src-attr tillater inline style="…"-attributter (CSP3). Det er snevrere
 *   enn et generelt 'unsafe-inline' og kan fjernes når attributtene er byttet ut
 *   med klasser.
 */
export function cspReportOnly(): string {
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' https://accounts.google.com https://www.googletagmanager.com https://static.cloudflareinsights.com",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://accounts.google.com https://cloudflareinsights.com",
    "frame-src https://accounts.google.com",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ');
  return policy;
}

/** Reporting-Endpoints-header (moderne report-to-navn). */
export function reportingEndpoints(): string {
  return 'csp-endpoint="/api/csp-report"';
}
