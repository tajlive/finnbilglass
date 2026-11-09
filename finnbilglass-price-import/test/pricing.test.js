import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyGlassType, parseNorwegianPrice, pricePolicy, safeCustomerPrice
} from '../src/pricing.js';
import { allowedUrl } from '../src/extract.js';

test('Norske prisformater', () => {
    assert.equal(parseNorwegianPrice('kr 1 234,50'), 1234.50);
    assert.equal(parseNorwegianPrice('2.499,00 kr'), 2499);
    assert.equal(parseNorwegianPrice('NOK 399'), 399);
    assert.equal(parseNorwegianPrice('1299'), 1299);
    assert.equal(parseNorwegianPrice('Ring for pris'), null);
});
test('Konservativ kategori: bare eksplisitte glasstyper', () => {
    assert.equal(classifyGlassType('FRONTRUTE VW GOLF'), 'FRONTRUTE');
    assert.equal(classifyGlassType('BAKRUTE MAZDA'), 'OVRIG_GLASS');
    assert.equal(classifyGlassType('VENTILRUTE SOTET'), 'OVRIG_GLASS');
    assert.equal(classifyGlassType('GLASS 2022 MOD'), 'UNKNOWN');
    assert.equal(classifyGlassType('LIMKIT'), 'MANUELL');
});
test('Rabatter fra kundens policy', () => {
    assert.deepEqual(pricePolicy('FRONTRUTE'), {discountPercent:75, multiplier:0.25});
    assert.deepEqual(pricePolicy('OVRIG_GLASS'), {discountPercent:50, multiplier:0.5});
    assert.equal(pricePolicy('MANUELL').multiplier, null);
});
test('Beregning er sperret uten MVA-/listeprisverifikasjon', () => {
    const base = {glassType:'FRONTRUTE',listPriceValue:4000};
    assert.equal(safeCustomerPrice({...base,vatBasis:'UNKNOWN',sourcePriceKind:'UNVERIFIED_DISPLAYED'}),null);
    assert.equal(safeCustomerPrice({...base,vatBasis:'GROSS',sourcePriceKind:'UNVERIFIED_DISPLAYED'}),null);
    assert.equal(safeCustomerPrice({...base,vatBasis:'GROSS',sourcePriceKind:'VERIFIED_REGULAR_LIST'}),1000);
    assert.equal(safeCustomerPrice({...base,vatBasis:'NET',sourcePriceKind:'VERIFIED_REGULAR_LIST'}),1250);
    assert.equal(safeCustomerPrice({glassType:'MANUELL',listPriceValue:4000,vatBasis:'GROSS',
        sourcePriceKind:'VERIFIED_REGULAR_LIST'}),null);
});
test('Kun https auto-glass.no', () => {
    assert.equal(allowedUrl('http://auto-glass.no'),null);
    assert.equal(allowedUrl('https://evil.example/produkt/x'),null);
    assert.equal(allowedUrl('https://auto-glass.no.evil.example/foo'),null);
    assert.equal(allowedUrl('https://auto-glass.no/produkt/foo#anchor'),
        'https://auto-glass.no/produkt/foo');
});

test('Glasskategorier i sammenkjedede Autoglass-navn', () => {
    assert.equal(classifyGlassType('suzuki-sj30-frontruteklar'), 'FRONTRUTE');
    assert.equal(classifyGlassType('fiat-panda-bakrute-elgronn'), 'OVRIG_GLASS');
    assert.equal(classifyGlassType('product_cat-vindusviskere frontrute'), 'EXCLUDED');
    assert.equal(classifyGlassType('Frontrute pyntelist tilbehør'), 'MANUELL');
});
