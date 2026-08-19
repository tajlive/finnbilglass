// P0.3-regresjonstester: fjerning av «Ikke min bil» + personlig beta-tekst.
// Verifiserer: (1) «Ikke min bil»/btn-ikke-min-bil fjernet fra aktiv frontend,
// (2) P0.2-fotoopplevelsen beholdt, (3) personlig beta-invitasjon på forsiden,
// (4) ingen endring i API-er, feature-flags, resolver eller evidence decisionAuthority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8');
const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const resolver = readFileSync(join(ROOT, 'src', 'vin-resolver.ts'), 'utf8');
const wrangler = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const wranglerStaging = readFileSync(join(ROOT, 'wrangler.staging.toml'), 'utf8');

test('1. «Ikke min bil» og btn-ikke-min-bil er fjernet fra aktiv frontend', () => {
  assert.doesNotMatch(html, /Ikke min bil/);
  assert.doesNotMatch(html, /btn-ikke-min-bil/);
  assert.doesNotMatch(js, /btn-ikke-min-bil/);
  assert.doesNotMatch(js, /ikke_min_bil/);
});

test('2. P0.2-fotoopplevelse beholdt (tekster)', () => {
  assert.match(html, /Vil du at jeg skal dobbeltsjekke\?/);
  assert.match(html, /Bildene endrer aldri glassvalget automatisk\./);
  assert.match(html, /Send bilder til Tom Arne/);
  assert.match(js, /Takk – jeg har fått bildene og dobbeltsjekker glasset før jeg sender tilbud\./);
  assert.match(js, /Bildene ble ikke sendt\. Prøv igjen, eller send meg en forespørsel så hjelper jeg deg\./);
});

test('3. P0.2-fotoopplevelse beholdt (kamera + bildebibliotek)', () => {
  const keys = ['plate', 'windshield', 'mirror_sensor', 'interior_optional'];
  for (const k of keys) {
    assert.match(html, new RegExp(`id="evidence-${k}"[^>]*capture="environment"`));
    assert.match(html, new RegExp(`id="evidence-${k}-bib"`));
  }
  const captureCount = (html.match(/id="evidence-[a-z_]+"[^>]*capture="environment"/g) || []).length;
  assert.equal(captureCount, 4, 'nøyaktig 4 kamera-inputs med capture');
  const bibMedCapture = (html.match(/id="evidence-[a-z_]+-bib"[^>]*capture=/g) || []);
  assert.equal(bibMedCapture.length, 0, 'bildebibliotek-input skal ikke ha capture');
});

test('4. personlig beta-invitasjon finnes på forsiden', () => {
  assert.match(html, /Kjenner du Tom Arne\?/);
  assert.match(html, /beta-invitasjon/);
  assert.match(css, /\.beta-invitasjon\s*\{/);
  assert.match(html, /Du er invitert til å teste Finnbilglass/);
  assert.match(html, /Jeg dobbeltsjekker alltid glassvalg og pris før bestilling\./);
});

test('5. ingen endring i API-er og evidence decisionAuthority', () => {
  assert.match(src, /\/api\/evidence-capture/);
  assert.match(src, /\/api\/accessories/);
  assert.match(src, /decisionAuthority:\s*'NONE'/);
});

test('6. feature-flags uendret (review/status forblir av)', () => {
  for (const f of [wrangler, wranglerStaging]) {
    assert.match(f, /EVIDENCE_REVIEW_ENABLED\s*=\s*"false"/);
    assert.match(f, /EVIDENCE_STATUS_CHANGE_ENABLED\s*=\s*"false"/);
  }
});

test('7. resolver uendret (skillendeSporsmaal fortsatt intakt)', () => {
  assert.match(resolver, /skillendeSporsmaal/);
});
