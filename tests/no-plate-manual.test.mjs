import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const app = readFileSync('public/app.js', 'utf8');
const css = readFileSync('public/styles.css', 'utf8');
const api = readFileSync('src/index.ts', 'utf8');
const start = api.indexOf("path === '/api/inquiry'");
const end = api.indexOf("path === '/api/regnr'", start);
const route = api.slice(start, end);

test('P1.1B: skilt- og VIN-søk beholdes', () => {
  assert.match(html, /id="form-regnr"/);
  assert.match(html, /id="form-vin"/);
  assert.match(app, /fetch\('\/api\/regnr'/);
  assert.match(app, /fetch\('\/api\/vin'/);
});

test('P1.1B: manuell flyt har bil- og kontaktfelter', () => {
  for (const id of [
    'form-manual', 'manual-make', 'manual-model',
    'manual-year', 'manual-name', 'manual-contact',
    'manual-notes', 'manual-result',
  ]) assert.ok(html.includes(`id="${id}"`), `${id} mangler`);
  assert.match(html, /Har du heller ikke VIN/);
});

test('P1.1B: kontrollert synlighet og tilgjengelighet', () => {
  assert.match(html, /id="btn-manual"[^>]*aria-controls="form-manual"/);
  assert.match(html, /id="manual-result"[^>]*role="status"/);
  assert.match(app, /\$\('form-manual'\)\.classList\.add\('hidden'\)/);
});

test('P1.1B: sender bare en forespørsel uten registreringsnummer', () => {
  const section = app.split('// P1.1B: manuell henvendelse')[1]?.split('// 1b. Foto av skiltnummeret')[0];
  assert.ok(section, 'manuell håndtering mangler');
  assert.match(section, /fetch\('\/api\/inquiry'/);
  assert.match(section, /regnr:\s*''/);
  assert.match(section, /melding:\s*message/);
  assert.match(section, /manualVehicle:\s*\{\s*make:\s*make,\s*model:\s*model,\s*year:\s*year\s*\}/);
  assert.match(section, /form\.dataset\.sent === 'true'/);
  assert.doesNotMatch(section, /resolveFrontrute|fitmentStatus:\s*'EXACT'|ORDER_CONFIRMED/);
});

test('P1.1B: manuell forespørsel krever menneskelig glasskontroll', () => {
  assert.match(html, /Vi kontrollerer glassvariant, pris og levering før bestilling/);
  assert.match(app, /Ingen bestilling er gjennomført/);
});

test('P1.1B: CSS-kommentaren og synlighetsregelen er gyldige', () => {
  assert.match(css, /\/\* P1\.1B: Manuell forespørsel uten skilt eller VIN\. \*\//);
  assert.match(css, /\.no-plate-manual\.hidden \{ display: none; \}/);
  assert.doesNotMatch(css, /\*\(P1\.1B/);
});

test('P1.1B: backend støtter forespørsler uten regnr i inngangsvalideringen', () => {
  assert.ok(start >= 0 && end > start, 'Fant ikke inquiry-ruten');
  assert.match(route, /const regnr = typeof b\.regnr === 'string'/);
  assert.doesNotMatch(route, /if\s*\(\s*!regnr\s*(?:\)|\|\|)/);
});
