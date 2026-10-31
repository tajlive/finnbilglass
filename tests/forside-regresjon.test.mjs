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

test('forside: alle interne lenker peker på en rute som faktisk finnes', () => {
  // Fanget reell feil: hotfix-branchen lenket til /logg-inn og /min-side, som
  // bare finnes i auth-branchen. På main ville de gitt 404 for kunden.
  const ruter = new Set();
  for (const m of src.matchAll(/path === '([^']+)'/g)) ruter.add(m[1]);
  for (const m of src.matchAll(/STATISKE_SIDER\s*=\s*\[([^\]]+)\]/g)) {
    for (const s of m[1].matchAll(/'([^']+)'/g)) ruter.add(s[1]);
  }
  const dode = [];
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const lenke = m[1];
    if (ruter.has(lenke) || ruter.has(lenke.replace(/\/$/, ''))) continue;
    const sti = join(ROOT, 'public', lenke.replace(/^\//, ''));
    if (existsSync(sti) || existsSync(sti + '.html')) continue;
    if (lenke === '/') continue;
    dode.push(lenke);
  }
  assert.deepEqual([...new Set(dode)], [], `døde lenker i index.html: ${[...new Set(dode)].join(', ')}`);
});

test('forside: styles.css er kundedesignet, ikke det gamle', () => {
  assert.match(css, /\.customer-site\s*\{/);
  assert.match(css, /\.start-layout\s*\{/);
  assert.match(css, /\.plate-field\s*\{/);
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

test('frontend-kontrakt: alle API-kall finnes som ruter i backend (main)', () => {
  // Hindrer at frontend kaller endepunkter som bare finnes i auth-branchen.
  const ruter = new Set();
  for (const m of src.matchAll(/path === '([^']+)'/g)) ruter.add(m[1]);
  const kall = new Set();
  for (const m of js.matchAll(/fetch\('(\/api\/[^']+)'/g)) kall.add(m[1].split('?')[0]);
  const mangler = [...kall].filter((k) => !ruter.has(k));
  assert.deepEqual(mangler, [], `frontend kaller ruter som ikke finnes: ${mangler.join(', ')}`);
});

test('frontend-kontrakt: 503 (pilotstopp) får kundetekst', () => {
  assert.match(js, /function fortolkInquiryFeil\(/);
  assert.match(js, /status === 503/);
});

test('deploy-artefakt: Worker serverer public/ med run_worker_first', () => {
  // Sjekker at mappen testen leste faktisk er den som deployes som assets,
  // og at forsiden går gjennom Workeren (så /-ruten kan sette no-store).
  assert.match(wrangler, /\[assets\][\s\S]*?directory\s*=\s*"\.\/public"/);
  assert.match(wrangler, /run_worker_first\s*=\s*\[[^\]]*"\/"/);
});

test('forside: mobil-bruddpunkt finnes i CSS', () => {
  // Mobil-først: minst ett max-width-bruddpunkt under 600px.
  const bp = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
  assert.ok(bp.some((b) => b < 600), `fant ingen mobil-brytpunkt, kun: ${bp.join(', ')}`);
});

test('forside: ingen horisontal overflyt i kritiske containere (regel sjekket i CSS)', () => {
  // Mobil-først: brede fixed-grids på toppnivå er en vanlig årsak til scroll.
  assert.doesNotMatch(css, /\.start-layout[^{]*\{[^}]*grid-template-columns:\s*\d{3,}px/);
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
