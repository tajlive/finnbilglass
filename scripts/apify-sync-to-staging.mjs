#!/usr/bin/env node
/**
 * Sender et Apify-datasett til staging-Workerens import-endepunkt.
 *
 * Hvorfor lokalt: Apify-legitimasjonen (OAuth) holdes utenfor Cloudflare, så
 * Worker-en trenger ingen Apify-nøkkel. Klienten henter items og POSTer dem.
 *
 * Bruk:
 *   npx apify datasets get-items <DATASET_ID> --format json > /tmp/items.json
 *   APIFY_SYNC_TOKEN=... node scripts/apify-sync-to-staging.mjs /tmp/items.json
 *
 * Miljø:
 *   APIFY_SYNC_TOKEN   (påkrevd) — Bearer-token for import-endepunktet
 *   STAGING_URL        (valgfri) — default https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev
 *   APIFY_PROBE_ID     (valgfri) — default apify-catalog-50
 *   CHUNK_SIZE         (valgfri) — default 20
 */

import { readFileSync } from 'node:fs';

const STAGING_URL =
    process.env.STAGING_URL || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const TOKEN = process.env.APIFY_SYNC_TOKEN;
const PROBE_ID = process.env.APIFY_PROBE_ID || 'apify-catalog-50';
const CHUNK_SIZE = Number.parseInt(process.env.CHUNK_SIZE || '20', 10);

const file = process.argv[2];
if (!file) {
    console.error('Bruk: node scripts/apify-sync-to-staging.mjs <items.json>');
    process.exit(2);
}
if (!TOKEN) {
    console.error('APIFY_SYNC_TOKEN mangler');
    process.exit(2);
}

const parsed = JSON.parse(readFileSync(file, 'utf8'));
const items = Array.isArray(parsed) ? parsed : parsed?.items;
if (!Array.isArray(items) || items.length === 0) {
    console.error('Fant ingen items i', file);
    process.exit(2);
}

const totals = { mottatt: 0, unike: 0, inserted: 0, updated: 0, errors: [] };

for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const res = await fetch(`${STAGING_URL}/api/admin/apify-catalog/sync`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'FinnBilGlass-Sync/1.0',
        },
        body: JSON.stringify({ probeId: PROBE_ID, datasetId: 'local-fetch', items: chunk }),
    });
    const text = await res.text();
    if (!res.ok) {
        console.error(`Chunk ${i / CHUNK_SIZE + 1} feilet: HTTP ${res.status} ${text.slice(0, 400)}`);
        process.exit(1);
    }
    const json = JSON.parse(text);
    totals.mottatt += json.mottatt ?? chunk.length;
    totals.unike += json.unike ?? 0;
    totals.inserted += json.inserted ?? 0;
    totals.updated += json.updated ?? 0;
    totals.errors.push(...(json.errors ?? []));
    console.log(
        `Chunk ${i / CHUNK_SIZE + 1}: mottatt=${json.mottatt} unike=${json.unike} ` +
            `inserted=${json.inserted} updated=${json.updated} errors=${(json.errors ?? []).length}`
    );
}

console.log('TOTAL', JSON.stringify(totals));
if (totals.errors.length) process.exit(1);
