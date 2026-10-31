/**
 * Apify-katalog-adapter: pris- og identitetspolicy.
 *
 * Reglene som testes er de som lettest blir brutt av en "hjelpsom" refaktorering:
 *  1. En EUR-pris skal ALDRI havne i `pris` (som er NOK-feltet).
 *  2. `vin_hash` skal være tom for katalogprodukter — aldri en fabrikkert "VIN".
 *  3. Dedupe på (probe_id, vin_hash, eurocode, ktype) — siste rad vinner.
 *  4. JSON-kolonner skal alltid være gyldig JSON, også når kilden er tom/søppel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ApifyCatalogAdapter } from '../scripts/apify-catalog-adapter.ts';

const adapter = new ApifyCatalogAdapter({}, 'token', 'dataset', 'probe-test');

function item(overrides = {}) {
    return {
        varenr: '8409AGABZ',
        varenavn: 'TOYOTA AURIS',
        eurokode: '8409AGABZ',
        pris: null,
        pris_eur: 486.25,
        pris_valuta: 'EUR',
        pris_kilde: 'glavista_suggested_retail',
        brand_title: 'TOYOTA',
        category_string: 'Windscreen',
        url: 'https://www.glavista.com/en/windscreen/8409agabz-toyota-auris',
        alias_av: '',
        glavistaNr: '102306',
        oe_numre: '5610102B50',
        features: { Brand: 'TOYOTA' },
        properties: { Tinting: 'Green' },
        cert: '43R-DOT',
        koder: '8409AGABZ, 8409AGAACZ',
        tilbehor: '',
        ...overrides,
    };
}

test('EUR-pris havner i pris_eur, aldri i pris (NOK)', () => {
    const p = adapter.normalizeProduct(item());
    assert.equal(p.pris, null, 'pris skal være NULL når kilden er EUR');
    assert.equal(p.pris_eur, 486.25);
    assert.equal(p.pris_valuta, 'EUR');
    assert.equal(p.pris_kilde, 'glavista_suggested_retail');
});

test('NOK-pris havner i pris og ikke i pris_eur', () => {
    const p = adapter.normalizeProduct(
        item({ pris: 4990, pris_eur: null, pris_valuta: 'NOK', pris_kilde: 'prisliste' })
    );
    assert.equal(p.pris, 4990);
    assert.equal(p.pris_eur, null);
});

test('manglende pris gir null i alle prisfelt', () => {
    const p = adapter.normalizeProduct(
        item({ pris: null, pris_eur: null, pris_valuta: null, pris_kilde: '' })
    );
    assert.equal(p.pris, null);
    assert.equal(p.pris_eur, null);
    assert.equal(p.pris_valuta, null);
    assert.equal(p.pris_kilde, null, 'ingen kilde når det ikke finnes en pris');
});

test('vin_hash er tom — katalogprodukter har ingen kjøretøyidentitet', () => {
    const p = adapter.normalizeProduct(item());
    assert.equal(p.vin_hash, '');
    assert.ok(!p.vin_hash.includes(p.eurocode), 'eurokode skal ikke forkles som VIN-hash');
});

test('dedupe på nøkkel — siste rad vinner', () => {
    const a = adapter.normalizeProduct(item({ varenavn: 'gammel' }));
    const b = adapter.normalizeProduct(item({ varenavn: 'ny' }));
    const out = adapter.dedupe([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0].varenavn, 'ny');
});

test('dedupe skiller like eurokoder med ulik ktype', () => {
    const a = adapter.normalizeProduct(item({ category_string: 'Windscreen' }));
    const b = adapter.normalizeProduct(item({ category_string: 'Backglass' }));
    assert.equal(adapter.dedupe([a, b]).length, 2);
});

test('JSON-kolonner er alltid gyldig JSON', () => {
    const p = adapter.normalizeProduct(item({ oe_numre: '', cert: '', koder: '', tilbehor: '', features: '', properties: null }));
    for (const field of ['oe_numbers', 'cert', 'koder', 'tilbehor', 'features', 'properties']) {
        assert.doesNotThrow(() => JSON.parse(p[field]), `${field} skal være gyldig JSON`);
    }
    assert.deepEqual(JSON.parse(p.oe_numbers), []);
    assert.deepEqual(JSON.parse(p.features), {});
});

test('liste-felter splittes og trimmes', () => {
    const p = adapter.normalizeProduct(item({ oe_numre: 'A1, B2 ,C3', cert: '43R-DOT' }));
    assert.deepEqual(JSON.parse(p.oe_numbers), ['A1', 'B2', 'C3']);
    assert.deepEqual(JSON.parse(p.cert), ['43R-DOT']);
});
