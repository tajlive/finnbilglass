import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKustomOrder } from '../src/payments/kustom-gateway.ts';

const example = () => ({
  purchase_country: 'NO', purchase_currency: 'NOK', locale: 'nb-NO',
  merchant_reference1: 'KUSTOM-SYNTHETIC-LOCAL',
  merchant_urls: {
    terms: 'https://example.org/terms', checkout: 'https://example.org/checkout',
    confirmation: 'https://example.org/done', push: 'https://example.org/push'
  },
  order_amount: 187375, order_tax_amount: 37475,
  order_lines: [
    {type:'physical',reference:'glass-test',name:'Syntetisk glass',quantity:1,unit_price:100000,tax_rate:2500,total_amount:100000,total_tax_amount:20000},
    {type:'shipping_fee',reference:'fast-frakt',name:'Frakt',quantity:1,unit_price:87375,tax_rate:2500,total_amount:87375,total_tax_amount:17475}
  ]
});
test('Kustom: 1000 kr glass + 699 eks. mva. frakt', () => assert.doesNotThrow(() => validateKustomOrder(example())));
test('Kustom: avviser manipulert total', () => {const x=example();x.order_amount++;assert.throws(() => validateKustomOrder(x),/totalsummer/)});
test('Kustom: krever HTTPS-callback', () => {const x=example();x.merchant_urls.push='http://localhost/push';assert.throws(() => validateKustomOrder(x),/HTTPS/)});
