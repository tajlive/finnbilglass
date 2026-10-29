import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync('public/index.html','utf8');
const app = readFileSync('public/app.js','utf8');
const api = readFileSync('src/index.ts','utf8');
const route = api.split("path === '/api/vin'")[1]?.split("path === '/api/les-skilt'")[0];

test('P1.1A: eksisterende regnr-søk beholdes', () => {
  assert.match(html, /id="form-regnr"/);
  assert.match(app, /fetch\('\/api\/regnr'/);
});
test('P1.1A: VIN-søk har etikett og tydelig knapp', () => {
  assert.match(html, /id="btn-uten-skilt"/);
  assert.match(html, /id="form-vin"/);
  assert.match(html, /for="input-vin"/);
});
test('P1.1A: VIN-oppslag krever kun kjøretøyidentitet', () => {
  assert.match(app, /fetch\('\/api\/vin'/);
  assert.match(app, /lookupOnly: true/);
  assert.match(app, /settBilFraSvv\(d\.bil, null, ''\)/);
  assert.ok(route?.includes('if (bil && !lookupOnly) {'));
});
test('P1.1A: VIN-endepunkt har validert format og lookupOnly', () => {
  assert.ok(route?.includes('lookupOnly må være true eller false'));
  assert.ok(route?.includes('[A-HJ-NPR-Z0-9]{11,17}'));
});
test('P1.1A: manuell kontaktvei uten VIN', () => {
  assert.match(html, /Mangler du også VIN/);
  assert.match(html, /Oppgi bilmerke, modell og anslått årsmodell/);
});
