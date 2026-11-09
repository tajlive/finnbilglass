import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../src/extract.js', import.meta.url), 'utf8');
test('accessory rows read from explicitly marked section', () => {
    assert.match(code, /querySelectorAll\('\.accessory-products'\)/);
    assert.match(code, /querySelectorAll\('\.product-row'\)/);
    assert.match(code, /querySelector\('\.accessory-sku'\)/);
    assert.match(code, /querySelector\('\.accessory-price'\)/);
});
test('accessory metadata never asserts fitment or price verification', () => {
    assert.match(code, /verifiedFitment: false/);
    assert.match(code, /priceVerified: false/);
    assert.match(code, /vatBasis: 'UNKNOWN'/);
});
test('accessories deduplicate by SKU, even when link absent', () => {
    assert.match(code, /a\.sku \? 'sku:' \+ a\.sku : 'url:' \+ a\.sourceUrl/);
});
