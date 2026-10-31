/**
 * Migrasjonsvakt.
 *
 * Tre ting som ikke skal kunne skje ved et uhell:
 *  1. En GitHub-workflow skal ALDRI kunne kjøre `wrangler d1 migrations apply`.
 *     Produksjonsledgeren er ikke rekonsilert (14 migrasjoner er anvendt uten
 *     ledger-rad), så en automatisk apply ville feile eller gjøre skade.
 *  2. `0034_glass_catalog_multi.sql` er PENDING — ikke anvendt i produksjon.
 *     Den skal ikke kunne kjøres uten at noen bevisst endrer statusen.
 *  3. De rekonstruerte filene skal være byte-identiske med det som ble hentet.
 *     SHA256 i migrations/_status.json er låsen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');
const STATUS_FIL = join(ROOT, 'migrations', '_status.json');

const status = JSON.parse(readFileSync(STATUS_FIL, 'utf8'));

function workflowFiler() {
    if (!existsSync(WORKFLOW_DIR)) return [];
    return readdirSync(WORKFLOW_DIR)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map((f) => ({ navn: f, innhold: readFileSync(join(WORKFLOW_DIR, f), 'utf8') }));
}

test('ingen workflow kan kjøre wrangler d1 migrations apply', () => {
    const forbudt = [
        /d1\s+migrations\s+apply/i,
        /migrations\s+apply[^\n]*--remote/i,
        /wrangler\s+d1\s+migrations/i,
    ];
    for (const { navn, innhold } of workflowFiler()) {
        // Kommentarlinjer er greit (dokumentasjon), kommandoer er ikke.
        const kode = innhold
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');
        for (const re of forbudt) {
            assert.doesNotMatch(
                kode,
                re,
                `Workflow "${navn}" inneholder en D1-migreringskommando (${re}). ` +
                    'Produksjonsledgeren er ikke rekonsilert — dette må ikke automatiseres.'
            );
        }
    }
});

test('ingen workflow kjører wrangler d1 execute mot produksjonsdatabasen', () => {
    for (const { navn, innhold } of workflowFiler()) {
        const kode = innhold
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');
        assert.doesNotMatch(
            kode,
            /d1\s+execute[^\n]*finnbilglass-db(?!-)/,
            `Workflow "${navn}" kjører d1 execute mot produksjonsdatabasen.`
        );
    }
});

test('0034_glass_catalog_multi.sql er merket PENDING, ikke anvendt', () => {
    const rad = status.migrasjoner.find((m) => m.fil === '0034_glass_catalog_multi.sql');
    assert.ok(rad, '0034 mangler i migrations/_status.json');
    assert.equal(
        rad.status,
        'PENDING',
        '0034 skal stå som PENDING — den er ikke anvendt i produksjon'
    );
});

test('PENDING-migrasjoner ligger UTENFOR migrations/ — ellers plukker wrangler dem', () => {
    // Dette er selve håndhevelsen. `wrangler d1 migrations apply` skanner
    // migrations/ på toppnivå og ville kjørt enhver *.sql der. En JSON-status
    // stopper ingenting — plasseringen gjør det.
    const toppnivå = new Set(readdirSync(join(ROOT, 'migrations')));
    for (const m of status.migrasjoner) {
        if (m.status !== 'PENDING') continue;
        assert.ok(
            !toppnivå.has(m.fil),
            `${m.fil} er PENDING men ligger i migrations/ — wrangler ville kjørt den`
        );
    }
});

test('ingen migrasjon er feilaktig merket som anvendt uten bevis', () => {
    for (const m of status.migrasjoner) {
        assert.ok(m.bevis && m.bevis.length > 20, `${m.fil} mangler bevis for status`);
        assert.ok(
            Object.keys(status.statuser).includes(m.status),
            `${m.fil} har ukjent status "${m.status}"`
        );
    }
});

test('0019_oem_probe_queue er DELVIS, ikke fullt anvendt', () => {
    const rad = status.migrasjoner.find((m) => m.fil === '0019_oem_probe_queue.sql');
    assert.ok(rad, '0019_oem_probe_queue mangler i statusfilen');
    assert.equal(rad.status, 'DELVIS');
});

test('SHA256 på alle oppførte migrasjoner stemmer med filene', () => {
    for (const m of status.migrasjoner) {
        const sti = join(ROOT, m.mappe ?? 'migrations', m.fil);
        assert.ok(existsSync(sti), `${m.fil} finnes ikke på ${m.mappe ?? 'migrations'}/`);
        const faktisk = createHash('sha256').update(readFileSync(sti)).digest('hex');
        assert.equal(
            faktisk,
            m.sha256,
            `${m.fil} er endret siden den ble hentet — SHA256 stemmer ikke`
        );
    }
});

test('alle 11 rekonstruerte migrasjoner er oppført i statusfilen', () => {
    // Vakten dekker de filene som ble hentet tilbake 2026-10-31. Eldre
    // migrasjoner (0001–0014, 0016–0018, 0019_inquiry_rate_limit, 0021–0027)
    // er dokumentert i d1_migrations og i rekonsilieringsrapporten.
    const rekonstruert = [
        '0019_oem_probe_queue.sql',
        '0020_oem_probe_queue_fix.sql',
        '0028_inquiry_commercial.sql',
        '0029_voice_lab.sql',
        '0030_voice_lab_tuning.sql',
        '0031_glass_reference.sql',
        '0032_glass_prisliste_lookup_indexes.sql',
        '0033_inquiry_reply_history.sql',
        '0034_glass_catalog_multi.sql',
        '0035_inquiry_glass_request.sql',
        '0036_glass_search_snapshots.sql',
    ];
    const kjent = new Set(status.migrasjoner.map((m) => m.fil));
    const mangler = rekonstruert.filter((f) => !kjent.has(f));
    assert.deepEqual(mangler, [], `Rekonstruerte migrasjoner uten status: ${mangler.join(', ')}`);

    for (const m of status.migrasjoner) {
        const sti = join(ROOT, m.mappe ?? 'migrations', m.fil);
        assert.ok(existsSync(sti), `${m.fil} mangler på disk (${m.mappe ?? 'migrations'}/)`);
    }
    assert.equal(status.migrasjoner.length, rekonstruert.length, 'Statusfilen har flere/ færre rader enn de 11');
});
