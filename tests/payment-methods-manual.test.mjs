import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const home = read('public/index.html');
const page = read('public/betaling.html');
const css = read('public/styles.css');
const names=['vipps','klarna','visa','mastercard'];

test('homepage displays four accepted payment logos near vehicle search, not an online checkout', () => {
  const start=home.indexOf('id="screen-start"');
  const search=home.indexOf('id="form-regnr"',start);
  const methods=home.indexOf('class="payment-methods"',start);
  const nextScreen=home.indexOf('id="screen-glass"',start);
  assert.ok(start>=0 && search>start && methods>search && methods<nextScreen,
    'Payment methods must appear on the home search screen');
  for (const name of names) {
    assert.match(home,new RegExp('src="/assets/betaling/'+name+'\\.svg"[^>]*alt="'
      +name[0].toUpperCase()+name.slice(1)+'"','i'),name+' image and accessible name');
    assert.match(page,new RegExp('/assets/betaling/'+name+'\\.svg"'),name+' also on payment info page');
  }
  assert.equal((home.match(/id="payment-methods-title"/g)||[]).length,1);
  assert.match(home,/Når du har akseptert, oppretter vi ordren og sender en sikker betalingslenke/);
  assert.match(page,/Når du har akseptert/);
  assert.match(page,/sender betalingslenke via Kustom/);
});

test('homepage has no dynamic Kustom Elements, checkout button or payment request', () => {
  assert.doesNotMatch(home,/kustom-payment-method-display/i);
  assert.doesNotMatch(home,/kustom-elements-script|js\.live\.kustom\.co|data-public-api-key/i);
  assert.doesNotMatch(home,/<script[^>]+https?:\/\/[^>]+>/i);
  assert.doesNotMatch(home,/href=["']https?:\/\/(?:api|pay)\.kustom\.co/i);
  assert.doesNotMatch(page,/Nettbetaling kommer senere/i);
  assert.doesNotMatch(page,/<kustom-payment-method-display/i);
});

test('unmodified payment logo files are locally hosted, safe SVGs, equally sized', () => {
  for (const name of names) {
    const svg=read('public/assets/betaling/'+name+'.svg').trim();
    assert.match(svg,/^<svg /);
    assert.match(svg,/<\/svg>$/);
    assert.match(svg,/width="120" height="80" viewBox="0 0 120 80"/);
    assert.doesNotMatch(svg,/<script|<foreignObject|onload=|https?:\/\/(?!www.w3.org\/2000\/svg)/i);
  }
  assert.match(css,/\.payment-method-logos\s*\{/);
  assert.match(css,/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(css,/kustom-payment-method-display/i);
});

test('payment and manual order claims do not change existing product search or pricing', () => {
  assert.match(home,/id="form-regnr"/);
  assert.match(home,/id="form-vin"/);
  assert.match(home,/id="inquiry-form"/);
  assert.match(home,/Vi kontrollerer glass, pris og levering før tilbud/);
  assert.match(page,/Du søker etter glass og sender en uforpliktende forespørsel/);
});
