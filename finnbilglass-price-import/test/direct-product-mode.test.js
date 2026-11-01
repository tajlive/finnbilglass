import test from 'node:test';
import assert from 'node:assert/strict';
import {directProductMode, isProductPageUrl, shouldFollowLink, shouldKeepProduct, startQueue} from '../src/crawl-plan.js';

const ford = 'https://auto-glass.no/produkt/ford-focus-5d-hbk-4d-sal-5d-est-18-frontrute/';
const mainCatalog = 'https://auto-glass.no/varer/nettbutikk/';
const bmw = 'https://auto-glass.no/produkt/bmw-x5-5d-suv-g05-19-wsakucamsensorencgtn/';

test('Varekort-URL skal starte i PRODUCT-modus uten katalogkø', () => {
    assert.equal(isProductPageUrl(ford), true);
    assert.equal(isProductPageUrl(mainCatalog), false);
    assert.equal(directProductMode([ford]), true);
    assert.equal(directProductMode([ford,bmw]), true);
    assert.equal(directProductMode([ford,mainCatalog]), false);
    assert.deepEqual(startQueue([ford]), [{url:ford,kind:'PRODUCT'}]);
});

test('Direkte varekorttest følger verken breadcrumbs, katalog eller relaterte produkter', () => {
    const direct = {directProductRun:true, includeProductPages:true};
    for (const kind of ['CATEGORY','PAGINATION','PRODUCT']) {
        assert.equal(shouldFollowLink({url:mainCatalog,kind},direct),false);
    }
    assert.equal(shouldFollowLink({url:bmw,kind:'PRODUCT'},
        {directProductRun:false,includeProductPages:true}),true);
});

test('Direkte varekort lagrer kun eksplisitt forespurt DETAIL-hovedprodukt', () => {
    const request = {directProductRun:true,requestedProductUrls:new Set([ford])};
    assert.equal(shouldKeepProduct({scope:'DETAIL',sourceUrl:ford},request),true);
    assert.equal(shouldKeepProduct({scope:'CARD',sourceUrl:ford},request),false);
    assert.equal(shouldKeepProduct({scope:'DETAIL',sourceUrl:bmw},request),false);
    assert.equal(shouldKeepProduct({scope:'DETAIL',sourceUrl:mainCatalog},request),false);
    assert.equal(shouldKeepProduct({scope:'DETAIL',sourceUrl:ford+'?ref=x'},request),true);
});
