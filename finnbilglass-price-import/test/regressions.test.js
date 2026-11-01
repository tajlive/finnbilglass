import test from 'node:test';
import assert from 'node:assert/strict';
import { statusFromRgb, normalizeStock } from '../src/stock.js';
import { titleFromProductUrl } from '../src/extract.js';

test('Autoglass gul indikator er mulig tilgjengelig, aldri rød', () => {
    assert.equal(statusFromRgb('rgb(245, 166, 35)'), 'POSSIBLY_AVAILABLE');
    assert.equal(normalizeStock('OUT_OF_STOCK', 'Indikatorfarge: rgb(245, 166, 35)'), 'POSSIBLY_AVAILABLE');
});
test('Autoglass rød, grønn og ukjent indikator', () => {
    assert.equal(statusFromRgb('rgb(209, 32, 42)'), 'OUT_OF_STOCK');
    assert.equal(statusFromRgb('rgb(28, 175, 62)'), 'IN_STOCK');
    assert.equal(statusFromRgb('transparent'), 'UNKNOWN');
    assert.equal(normalizeStock('IN_STOCK','Fargeklasse: stock-status stock-status-instock 7'), 'IN_STOCK');
});
test('URL-slug kan brukes kun som identifiserbar reserveetikett', () => {
    assert.equal(titleFromProductUrl('https://auto-glass.no/produkt/bmw-x5-5d-suv-g05-19-wsakucamsensorencgtn/'),
        'bmw x5 5d suv g05 19 wsakucamsensorencgtn');
    assert.equal(titleFromProductUrl('https://auto-glass.no/varer/nettbutikk/autoglass/'), null);
});
