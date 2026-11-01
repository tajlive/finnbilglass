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
 */
import type { Env } from '../types';

const MAKS_KROPP = 16 * 1024; // 16 kB — rapporter er små; større avvises

function vert(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.slice(0, 100);
  } catch {
    return url.startsWith("'") || url.startsWith('data:') ? url.slice(0, 40) : '';
  }
}

function sti(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).pathname.slice(0, 200); // query bevisst fjernet
  } catch {
    return '';
  }
}

export async function handleCspReport(request: Request, env: Env): Promise<Response> {
  const tom = new Response(null, { status: 204 });

  const tekst = await request.text().catch(() => '');
  if (!tekst || tekst.length > MAKS_KROPP) return tom;

  let kropp: unknown;
  try {
    kropp = JSON.parse(tekst);
  } catch {
    return tom;
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

  for (const r of rapporter.slice(0, 20)) {
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

/** Bygger CSP-header. Report-Only i denne fasen — bryter ingenting. */
export function cspReportOnly(): string {
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    // Inline-skript/stiler finnes i dag; hashing/flytting er egen oppgave.
    // cloudflareinsights.com er Cloudflares egen Web Analytics (fanget via report-only).
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.googletagmanager.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://accounts.google.com https://cloudflareinsights.com",
    "frame-src https://accounts.google.com",
    "report-uri /api/csp-report",
  ].join('; ');
  return policy;
}
