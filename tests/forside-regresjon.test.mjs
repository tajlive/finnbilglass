// P0-regresjonsvakt: godkjent kundeforside skal være det som faktisk shippes.
//
// Bakgrunn: produksjonen serverte gammel forside («Bilglass til riktig pris» /
// «Kjenner du Tom Arne?») på både apex og www, fordi release-grenen mistet
// public/-endringene i merge-sekvensen. Denne testen feiler hvis den gamle
// forsiden kommer tilbake i release-artefaktene.
//
// Tekst sammenlignes NORMALISERT (tags → mellomrom, whitespace kollapset) slik at
// <br>, <span> eller innrykk ikke gir falskt resultat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const les = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const html = les('public', 'index.html');
const css = les('public', 'styles.css');
const js = les('public', 'app.js');
const wrangler = les('wrangler.toml');
const src = les('src', 'index.ts');

/** DOM-tekst normalisert: fjerner script/style/svg, tags → mellomrom. */
function normalisertTekst(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const tekst = normalisertTekst(html);

test('forside: godkjent hero-tekst finnes i normalisert DOM', () => {
  assert.match(tekst, /Riktig bilglass\. En pris du forstår\./);
});

test('forside: gammel forside er ikke tilbake', () => {
  assert.doesNotMatch(tekst, /Bilglass til riktig pris/);
  assert.doesNotMatch(tekst, /Kjenner du Tom Arne/);
  assert.doesNotMatch(tekst, /Da vil jeg gjerne ha din hjelp/);
});

test('forside: registreringsnummer- og VIN-søk er med', () => {
  assert.match(html, /id="form-regnr"/);
  assert.match(html, /id="input-regnr"/);
  assert.match(html, /id="form-vin"/);
  assert.match(html, /id="input-vin"/);
});

test('forside: kundetilgang (innlogging + min side) er koblet på', () => {
  assert.match(html, /href="\/logg-inn"/);
  assert.match(html, /href="\/min-side"/);
  assert.match(src, /path === '\/logg-inn'/);
  assert.match(src, /path === '\/min-side'/);
});

test('forside: styles.css er kundedesignet, ikke det gamle', () => {
  assert.match(css, /\.customer-site\s*\{/);
  assert.match(css, /\.start-layout\s*\{/);
  assert.match(css, /\.plate-field\s*\{/);
  assert.match(css, /\.top-lenke\s*\{/);
});

test('frontend-kontrakt: /api/inquiry sender Idempotency-Key', () => {
  // Backend reserverer Idempotency-Key før rate limit. Uten headeren mister
  // kunden replay-vernet og dobbeltklikk kan lage to saker i /ops.
  assert.match(js, /Idempotency-Key/);
  assert.match(js, /function inquiryHeaders\(/);
  const antallInquiry = (js.match(/'\/api\/inquiry'/g) || []).length;
  const antallHeaders = (js.match(/headers: inquiryHeaders\(\)/g) || []).length;
  assert.equal(antallInquiry, 2, 'to innsendingspunkter forventet');
  assert.equal(antallHeaders, 2, 'begge innsendingspunkter må bruke inquiryHeaders()');
});

test('frontend-kontrakt: 401/403 fra tilgangsstyring får kundetekst', () => {
  assert.match(js, /function fortolkInquiryFeil\(/);
  assert.match(js, /status === 401/);
  assert.match(js, /status === 403/);
});

test('deploy-artefakt: Worker serverer public/ med run_worker_first', () => {
  // Sjekker at mappen testen leste faktisk er den som deployes som assets,
  // og at kunderutene går til Workeren (ikke til en tilfeldig statisk fil).
  assert.match(wrangler, /\[assets\][\s\S]*?directory\s*=\s*"\.\/public"/);
  assert.match(wrangler, /run_worker_first\s*=\s*\[/);
  assert.match(wrangler, /"\/logg-inn"/);
  assert.match(wrangler, /"\/min-side"/);
  assert.match(wrangler, /workers_dev\s*=\s*false/);
});

test('forside: ingen horisontal overflyt i kritiske containere (regel sjekket i CSS)', () => {
  // Mobil-først: brede fixed-grids på toppnivå er en vanlig årsak til scroll.
  assert.doesNotMatch(css, /\.start-layout[^{]*\{[^}]*grid-template-columns:\s*\d{3,}px/);
  assert.match(css, /@media \(max-width: 480px\)/);
});

test('forside: alle lokale assets som refereres finnes på disk', () => {
  // Fanget en reell feil: logo-mark PNG manglet etter restore, så headeren
  // viste ødelagt bilde. Testen krever at hver lokal referanse har en fil.
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)=["'](\/[^"'#?]+)/g)) refs.add(m[1]);
  for (const m of css.matchAll(/url\(["']?(\/[^)"']+)/g)) refs.add(m[1]);
  const mangler = [];
  for (const r of refs) {
    if (ignorer(r)) continue;
    const sti = join(ROOT, 'public', r.replace(/^\//, ''));
    if (!existsSync(sti) || statSync(sti).size === 0) mangler.push(r);
  }
  assert.deepEqual(mangler, [], `manglende assets: ${mangler.join(', ')}`);
});

function ignorer(r) {
  return /^\/(api\/|logg-inn|min-side|ops$|bilglass-uten-forsikring$|om-oss$|personvern$)/.test(r);
}
