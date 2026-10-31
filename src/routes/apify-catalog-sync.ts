/**
 * Admin-endepunkt: Apify-katalog → staging D1.
 *
 * POST /api/admin/apify-catalog/sync   { datasetId?: string, probeId?: string }
 * GET  /api/admin/apify-catalog/status
 *
 * Auth: Bearer <APIFY_SYNC_TOKEN>. Endepunktet skriver KUN til tabellen
 * apify_catalog_products (staging) — aldri til produksjonskatalog-tabeller.
 */

import type { Env } from '../types';
import { createApifyCatalogAdapter } from '../../scripts/apify-catalog-adapter';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

function authorized(request: Request, env: Env): boolean {
    const expected = env.APIFY_SYNC_TOKEN;
    if (!expected) return false;
    const header = request.headers.get('Authorization') || '';
    return header === `Bearer ${expected}`;
}

export async function handleApifyCatalogSync(request: Request, env: Env): Promise<Response> {
    if (!authorized(request, env)) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
        const raw = await request.text();
        if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
    }

    const probeId =
        (typeof body.probeId === 'string' && body.probeId.trim()) || env.APIFY_PROBE_ID || 'apify-catalog';

    // Foretrukket flyt: klienten henter datasettet (Apify-legitimasjonen holdes
    // utenfor Cloudflare) og POSTer items hit.
    if (Array.isArray(body.items)) {
        try {
            const adapter = createApifyCatalogAdapter(env.FINNBILGLASS_DB, {
                APIFY_TOKEN: '',
                APIFY_DATASET_ID: typeof body.datasetId === 'string' ? body.datasetId : 'inline',
                PROBE_ID: probeId,
            });
            const normalized = adapter.dedupe(
                (body.items as Parameters<typeof adapter.normalizeProduct>[0][]).map((p) =>
                    adapter.normalizeProduct(p)
                )
            );
            const result = await adapter.upsertProducts(normalized);
            return json({
                ok: true,
                modus: 'items',
                probeId,
                environment: env.ENVIRONMENT,
                mottatt: body.items.length,
                unike: normalized.length,
                inserted: result.inserted,
                updated: result.updated,
                errors: result.errors,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('apify-catalog sync (items) feilet:', err);
            return json({ ok: false, error: err instanceof Error ? err.message : 'Sync feilet' }, 500);
        }
    }

    // Alternativ flyt: Worker henter datasettet selv. Krever APIFY_TOKEN i miljøet.
    if (!env.APIFY_TOKEN) {
        return json(
            { ok: false, error: 'APIFY_TOKEN mangler — send items i body i stedet' },
            503
        );
    }

    const datasetId =
        (typeof body.datasetId === 'string' && body.datasetId.trim()) || env.APIFY_DATASET_ID || '';
    if (!datasetId) {
        return json({ ok: false, error: 'datasetId mangler (body eller APIFY_DATASET_ID)' }, 400);
    }

    try {
        const adapter = createApifyCatalogAdapter(env.FINNBILGLASS_DB, {
            APIFY_TOKEN: env.APIFY_TOKEN,
            APIFY_DATASET_ID: datasetId,
            PROBE_ID: probeId,
        });
        const result = await adapter.sync();
        return json({
            ok: true,
            modus: 'dataset',
            datasetId,
            probeId,
            environment: env.ENVIRONMENT,
            ...result,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('apify-catalog sync feilet:', err);
        return json(
            { ok: false, error: err instanceof Error ? err.message : 'Sync feilet' },
            500
        );
    }
}

export async function handleApifyCatalogStatus(request: Request, env: Env): Promise<Response> {
    if (!authorized(request, env)) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    try {
        const { results } = await env.FINNBILGLASS_DB
            .prepare(
                `SELECT probe_id,
                        COUNT(*) AS antall,
                        SUM(CASE WHEN pris_eur IS NOT NULL THEN 1 ELSE 0 END) AS med_eur_pris,
                        SUM(CASE WHEN url IS NOT NULL AND url != '' THEN 1 ELSE 0 END) AS med_url,
                        MAX(updated_at) AS sist_oppdatert
                   FROM apify_catalog_products
                  GROUP BY probe_id`
            )
            .all();
        return json({
            ok: true,
            environment: env.ENVIRONMENT,
            probes: results ?? [],
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('apify-catalog status feilet:', err);
        return json(
            { ok: false, error: err instanceof Error ? err.message : 'Status feilet' },
            500
        );
    }
}
