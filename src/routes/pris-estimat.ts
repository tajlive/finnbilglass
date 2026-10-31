/**
 * Admin-endepunkt: vis NOK-prising for en eurokode med eksplisitt grunnlag.
 *
 * GET /api/admin/pris-estimat?eurocode=8409AGABZ
 * GET /api/admin/pris-estimat?listepris=9875          (test av prisliste-regelen)
 * GET /api/admin/pris-estimat?faktura=3000&paslag=1.5 (test av påslags-regelen)
 *
 * Grunnlaget er VÅRT eget: prislisten vår (BEKREFTET) eller en fakturakostnad med
 * påslag (BEKREFTET). Ingen eksterne katalogpriser brukes — Glavista-priser er
 * ikke i bruk.
 *
 * Auth: Bearer <APIFY_SYNC_TOKEN>. Leser kun. Skriver ingenting.
 */

import type { Env } from '../types';
import { beregnPris, type Prisresultat } from '../pricing/nok-prising';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

interface PrislisteRad {
    varenr: string;
    varenavn: string;
    pris: number | null;
    eurokode: string | null;
}

function tall(v: string | null): number | null {
    if (v === null || v.trim() === '') return null;
    const n = Number.parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

export async function handlePrisEstimat(request: Request, env: Env): Promise<Response> {
    const expected = env.APIFY_SYNC_TOKEN;
    if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    const p = new URL(request.url).searchParams;
    const eurocode = (p.get('eurocode') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const listeprisParam = tall(p.get('listepris'));
    const fakturaParam = tall(p.get('faktura'));
    const paslagParam = tall(p.get('paslag'));

    if (!eurocode && listeprisParam === null && fakturaParam === null) {
        return json(
            { ok: false, error: 'Oppgi eurocode, listepris eller faktura' },
            400
        );
    }

    // ── Direkte parameter-test (uten DB) ──
    if (listeprisParam !== null) {
        const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: listeprisParam });
        return json({
            ok: true,
            environment: env.ENVIRONMENT,
            modus: 'listepris-parameter',
            listepris: listeprisParam,
            beregning: r,
            kundePris: r.kundePris,
            timestamp: new Date().toISOString(),
        });
    }
    if (fakturaParam !== null) {
        const r = beregnPris({
            grunnlag: 'SUPPLIER_INVOICE',
            belop: fakturaParam,
            paslagFaktor: paslagParam ?? 1,
        });
        return json({
            ok: true,
            environment: env.ENVIRONMENT,
            modus: 'faktura-parameter',
            faktura: fakturaParam,
            paslag: paslagParam ?? 1,
            beregning: r,
            kundePris: r.kundePris,
            timestamp: new Date().toISOString(),
        });
    }

    // ── Oppslag i vår egen prisliste ──
    let prisliste: PrislisteRad | null = null;
    try {
        prisliste = await env.FINNBILGLASS_DB.prepare(
            `SELECT varenr, varenavn, pris, eurokode
               FROM glass_prisliste
              WHERE rad_type = 'glass'
                AND (UPPER(eurokode) = ? OR UPPER(varenr) = ?)
              ORDER BY CASE WHEN UPPER(eurokode) = ? THEN 0 ELSE 1 END
              LIMIT 1`
        )
            .bind(eurocode, eurocode, eurocode)
            .first<PrislisteRad>();
    } catch (err) {
        console.error('prisliste-oppslag feilet:', err);
        return json({ ok: false, error: 'Prisliste-oppslag feilet' }, 500);
    }

    if (!prisliste) {
        // Ikke funnet er et gyldig svar — men vi skal ikke finne på en pris.
        return json({
            ok: true,
            environment: env.ENVIRONMENT,
            eurocode,
            funnet: false,
            kundePris: null,
            melding: 'Eurokoden finnes ikke i prislisten. Pris må avklares manuelt.',
            timestamp: new Date().toISOString(),
        });
    }

    const beregning: Prisresultat | null =
        prisliste.pris && prisliste.pris > 0
            ? beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: prisliste.pris })
            : null;

    return json({
        ok: true,
        environment: env.ENVIRONMENT,
        modus: 'prisliste',
        eurocode,
        funnet: true,
        prisliste,
        beregning,
        kundePris: beregning?.kundePris ?? null,
        kundePrisGrunnlag: beregning ? 'PRISTLISTE_NOK' : null,
        timestamp: new Date().toISOString(),
    });
}
