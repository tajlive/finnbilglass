/**
 * ApifyCatalogAdapter - Integrates Apify Actor dataset with FinnBilGlass staging D1
 *
 * Fetches scraped products from an Apify dataset, normalizes them against
 * migrations/staging/0002_apify_catalog_products.sql, and upserts into D1 with
 * idempotency guarantees.
 *
 * PRICE POLICY: Glavista publishes a suggested retail price in EUR. A EUR figure
 * is never written into `pris` (which is NOK-only). Source figures are kept in
 * pris_eur + pris_valuta + pris_kilde so nothing is invented.
 *
 * IDENTITY POLICY: a catalog row is not tied to a vehicle, so vin_hash is '' for
 * every catalog product. A hash that only encodes the eurocode would look like a
 * VIN hash without being one.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface ApifyProduct {
    varenr: string;
    varenavn: string;
    eurokode: string;
    pris?: number | null;
    pris_eur?: number | null;
    pris_valuta?: string | null;
    pris_kilde?: string | null;
    brand_title: string;
    category_string: string;
    url: string;
    alias_av: string;
    glavistaNr: string;
    oe_numre: string;
    features: Record<string, unknown> | string;
    properties: Record<string, unknown> | string;
    cert: string;
    koder: string;
    tilbehor: string;
}

export interface StagingProduct {
    probe_id: string;
    vin_hash: string;
    eurocode: string;
    ktype: string;
    varenr: string;
    varenavn: string;
    eurokode: string;
    pris: number | null;
    pris_eur: number | null;
    pris_valuta: string | null;
    pris_kilde: string | null;
    brand_title: string;
    category: string;
    url: string;
    alias_av: string;
    glavista_nr: string;
    oe_numbers: string;   // JSON stringified
    features: string;     // JSON stringified
    properties: string;   // JSON stringified
    cert: string;         // JSON stringified
    koder: string;        // JSON stringified
    tilbehor: string;     // JSON stringified
    source: 'apify-glavista';
    created_at: string;
    updated_at: string;
}

function toJson(value: unknown, fallback: '{}' | '[]'): string {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            return fallback;
        }
    }
    return JSON.stringify(value);
}

function splitList(value: string | null | undefined): string {
    return JSON.stringify(
        (value || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

function num(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : null;
}

/**
 * ApifyCatalogAdapter - Handles Apify dataset → D1 integration
 */
export class ApifyCatalogAdapter {
    private db: D1Database;
    private apifyToken: string;
    private datasetId: string;
    private probeId: string;

    constructor(db: D1Database, apifyToken: string, datasetId: string, probeId: string = 'apify-catalog') {
        this.db = db;
        this.apifyToken = apifyToken;
        this.datasetId = datasetId;
        this.probeId = probeId;
    }

    /**
     * Fetch all items from the Apify dataset.
     */
    async fetchDatasetItems(): Promise<ApifyProduct[]> {
        const url = `https://api.apify.com/v2/datasets/${this.datasetId}/items?clean=true&format=json`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.apifyToken}`,
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch dataset: ${response.status} ${response.statusText}`);
        }

        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) {
            throw new Error('Dataset response was not an array');
        }
        return body as ApifyProduct[];
    }

    /**
     * Normalize an Apify product to the staging schema.
     */
    normalizeProduct(product: ApifyProduct): StagingProduct {
        const now = new Date().toISOString();
        const eurocode = (product.eurokode || product.varenr || '').toUpperCase().trim();

        const prisValuta = (product.pris_valuta || '').toUpperCase() || null;
        const prisNok = prisValuta === 'NOK' ? num(product.pris) : null;
        const prisEur = num(product.pris_eur);

        return {
            probe_id: this.probeId,
            // Catalog rows have no vehicle identity: never fabricate a VIN hash.
            vin_hash: '',
            eurocode,
            ktype: product.category_string || 'Windscreen',
            varenr: product.varenr || eurocode,
            varenavn: product.varenavn || eurocode,
            eurokode: eurocode,
            pris: prisNok,
            pris_eur: prisEur,
            pris_valuta: prisValuta,
            pris_kilde: prisEur !== null || prisNok !== null ? (product.pris_kilde || 'glavista_suggested_retail') : null,
            brand_title: product.brand_title || '',
            category: product.category_string || 'Windscreen',
            url: product.url || '',
            alias_av: product.alias_av || '',
            glavista_nr: product.glavistaNr || '',
            oe_numbers: splitList(product.oe_numre),
            features: toJson(product.features, '{}'),
            properties: toJson(product.properties, '{}'),
            cert: splitList(product.cert),
            koder: splitList(product.koder),
            tilbehor: splitList(product.tilbehor),
            source: 'apify-glavista',
            created_at: now,
            updated_at: now,
        };
    }

    /**
     * Deduplicate by (probe_id, vin_hash, eurocode, ktype); last row wins.
     */
    dedupe(products: StagingProduct[]): StagingProduct[] {
        const byKey = new Map<string, StagingProduct>();
        for (const p of products) {
            byKey.set(`${p.probe_id}|${p.vin_hash}|${p.eurocode}|${p.ktype}`, p);
        }
        return [...byKey.values()];
    }

    /**
     * Upsert products into D1 with idempotency.
     * Insert/update counts are derived from a pre-check so the numbers are real.
     */
    async upsertProducts(
        products: StagingProduct[]
    ): Promise<{ inserted: number; updated: number; errors: string[] }> {
        const errors: string[] = [];
        if (products.length === 0) return { inserted: 0, updated: 0, errors };

        // Which keys already exist?
        const existing = new Set<string>();
        const CHUNK = 40;
        for (let i = 0; i < products.length; i += CHUNK) {
            const chunk = products.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '?').join(', ');
            try {
                const { results } = await this.db
                    .prepare(
                        `SELECT eurocode, ktype FROM apify_catalog_products
                          WHERE probe_id = ? AND vin_hash = ? AND eurocode IN (${placeholders})`
                    )
                    .bind(this.probeId, '', ...chunk.map((p) => p.eurocode))
                    .all<{ eurocode: string; ktype: string }>();
                for (const row of results || []) {
                    existing.add(`${row.eurocode}|${row.ktype}`);
                }
            } catch (err) {
                errors.push(`Pre-check failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        const statements = products.map((p) =>
            this.db
                .prepare(
                    `INSERT INTO apify_catalog_products (
                        probe_id, vin_hash, eurocode, ktype,
                        varenr, varenavn, eurokode,
                        pris, pris_eur, pris_valuta, pris_kilde,
                        brand_title, category, url, alias_av,
                        glavista_nr, oe_numbers, features, properties,
                        cert, koder, tilbehor, source,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(probe_id, vin_hash, eurocode, ktype) DO UPDATE SET
                        varenr = excluded.varenr,
                        varenavn = excluded.varenavn,
                        eurokode = excluded.eurokode,
                        pris = excluded.pris,
                        pris_eur = excluded.pris_eur,
                        pris_valuta = excluded.pris_valuta,
                        pris_kilde = excluded.pris_kilde,
                        brand_title = excluded.brand_title,
                        category = excluded.category,
                        url = excluded.url,
                        alias_av = excluded.alias_av,
                        glavista_nr = excluded.glavista_nr,
                        oe_numbers = excluded.oe_numbers,
                        features = excluded.features,
                        properties = excluded.properties,
                        cert = excluded.cert,
                        koder = excluded.koder,
                        tilbehor = excluded.tilbehor,
                        source = excluded.source,
                        updated_at = excluded.updated_at`
                )
                .bind(
                    p.probe_id, p.vin_hash, p.eurocode, p.ktype,
                    p.varenr, p.varenavn, p.eurokode,
                    p.pris, p.pris_eur, p.pris_valuta, p.pris_kilde,
                    p.brand_title, p.category, p.url, p.alias_av,
                    p.glavista_nr, p.oe_numbers, p.features, p.properties,
                    p.cert, p.koder, p.tilbehor, p.source,
                    p.created_at, p.updated_at
                )
        );

        let inserted = 0;
        let updated = 0;
        try {
            const results = await this.db.batch(statements);
            results.forEach((result, index) => {
                const row = products[index];
                const key = `${row.eurocode}|${row.ktype}`;
                if (!result.success) {
                    errors.push(`${row.varenr}: ${result.error || 'unknown D1 error'}`);
                    return;
                }
                if (existing.has(key)) updated++;
                else inserted++;
            });
        } catch (err) {
            errors.push(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
        }

        return { inserted, updated, errors };
    }

    /**
     * Full pipeline: fetch from Apify → normalize → dedupe → upsert to D1.
     */
    async sync(): Promise<{
        fetched: number;
        unique: number;
        inserted: number;
        updated: number;
        errors: string[];
    }> {
        const raw = await this.fetchDatasetItems();
        const normalized = this.dedupe(raw.map((p) => this.normalizeProduct(p)));
        const result = await this.upsertProducts(normalized);

        return {
            fetched: raw.length,
            unique: normalized.length,
            inserted: result.inserted,
            updated: result.updated,
            errors: result.errors,
        };
    }
}

/**
 * Factory function for easy instantiation in Workers.
 */
export function createApifyCatalogAdapter(
    db: D1Database,
    env: { APIFY_TOKEN: string; APIFY_DATASET_ID: string; PROBE_ID?: string }
): ApifyCatalogAdapter {
    return new ApifyCatalogAdapter(
        db,
        env.APIFY_TOKEN,
        env.APIFY_DATASET_ID,
        env.PROBE_ID || 'apify-catalog'
    );
}
