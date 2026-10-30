import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');
const css = readFileSync('public/styles.css', 'utf8');
const html = readFileSync('public/index.html', 'utf8');

test('alle seks glasskategorier er synlige', () => {
  for (const kind of ['front','door','side','rear','roof','unknown']) {
    assert.ok(html.includes(`data-type="${kind}"`), kind);
  }
});

test('Fortsett er koblet til ruteposisjon og søk', () => {
  assert.match(app, /btn-glass-search'\)\.addEventListener/);
  assert.match(app, /selectionFromFields\(kind\)/);
  assert.match(app, /sokGlass\(selection\)/);
});

test('Release A åpner manuell kontroll uten ventende glass-API', () => {
  const start = app.indexOf('function sokGlass(selection)');
  const end = app.indexOf('// 4. Glasstype.', start);
  const functionBody = app.slice(start, end);
  assert.match(functionBody, /visGlassResultat\(request/);
  assert.doesNotMatch(functionBody, /fetch\(/);
  assert.doesNotMatch(app, /Vi undersøker glassvariantene/);
});

test('glassvalg har kontraststerke lyse kort', () => {
  assert.match(css, /\/\* FBG glassvalg v4 \*\//);
  assert.match(css, /background:\s*#ffffff/);
  assert.match(css, /color:\s*#102a43/);
});

test('nye versjonerte filer brukes', () => {
  assert.match(html, /app\.js\?v=20261030-customer-flow-v4/);
  assert.match(html, /styles\.css\?v=20261030-customer-flow-v4/);
});
