// P0.3+P0.4-regresjonstester: fjerning av «Ikke min bil», personlig beta-invitasjon
// og språkregelen «vi» er hovedspråket («jeg» kun i beta-invitasjonen, kundens egne
// valg/spørsmål og Tom Arne-presentasjonen).
// Verifiserer: (1) «Ikke min bil» fjernet, (2) P0.2-fotoopplevelse beholdt,
// (3) beta-invitasjon, (4) «vi» i aktiv kundereise, (5) «jeg» kun i godkjente
// unntak, (6) ingen endring i API-er, feature-flags, resolver eller decisionAuthority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8');
const omoss = readFileSync(join(ROOT, 'public', 'om-oss.html'), 'utf8');
const buf = readFileSync(join(ROOT, 'public', 'bilglass-uten-forsikring.html'), 'utf8');
const personvern = readFileSync(join(ROOT, 'public', 'personvern.html'), 'utf8');
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
  assert.match(html, /Vil du at vi skal dobbeltsjekke\?/);
  assert.match(html, /Bildene endrer aldri glassvalget automatisk\./);
  assert.match(html, /Send bilder til Finnbilglass/);
  assert.match(js, /Takk – vi har fått bildene og dobbeltsjekker glasset før vi sender tilbud\./);
  assert.match(js, /Bildene ble ikke sendt\. Prøv igjen, eller send oss en forespørsel så hjelper vi deg\./);
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

test('4. beta-invitasjon beskriver avgrenset testing og manuell kontroll', () => {
  assert.match(html, /Beta for inviterte testere/);
  assert.match(html, /Du er invitert til å teste Finnbilglass/);
  assert.match(html, /Vi dobbeltsjekker glassvalg og pris før et eventuelt tilbud sendes\./);
  assert.match(html, /beta-invitasjon/);
  assert.match(css, /\.beta-invitasjon\s*\{/);
});

test('5. språkregel: aktiv kundereise bruker «vi»', () => {
  assert.match(html, /Vil du at vi skal dobbeltsjekke\?/);
  assert.match(html, /Det hjelper oss å kontrollere riktig glass før vi sender tilbud\./);
  assert.match(html, /Vi hjelper deg med å finne riktig glass/);
  assert.match(html, /Vi avklarer eventuelt nødvendig tilbehør før vi sender tilbudet\./);
  assert.match(html, /Send oss forespørselen, så dobbeltsjekker vi riktig glass og tilbehør/);
  assert.match(html, /Vi fant ikke et trygt treff i katalogen\. Send oss en forespørsel/);
  assert.match(html, /Vi dobbeltsjekker alle glassvalg og priser før bestilling\./);
  assert.match(js, /Vi har funnet en mulig kandidat ut fra bildataene dine\. Vi dobbeltsjekker valget manuelt før vi sender tilbud\./);
  assert.match(js, /Takk! Vi har mottatt forespørselen.*dobbeltsjekker glasset/);
  assert.match(personvern, /Hvilke opplysninger behandler vi\?/);
  assert.match(personvern, /foreløpig ikke satt opp en automatisk slettedato/);
});

test('6. språkregel: «jeg/meg» finnes kun i godkjente unntak', () => {
  // Godkjente unntak
  assert.match(html, /Vi dobbeltsjekker glassvalg og pris før et eventuelt tilbud sendes\./);
  assert.match(html, /Til meg/); // kundens leveringsvalg
  assert.match(buf, /når jeg betaler selv\?/); // kundens FAQ-spørsmål
  assert.match(omoss, /Hei, jeg heter Tom Arne og står bak Finnbilglass\./); // Tom-presentasjon

  // Forbudt «jeg/meg»-kommunikasjon fra Finnbilglass i app.js
  const forbudtJs = [
    /hjelper meg å kontrollere/, /før jeg sender tilbud/, /send meg en forespørsel/,
    /undersøker jeg bilen/, /Jeg har funnet et mulig glass/, /Jeg avklarer/,
    /Jeg dobbeltsjekker glasset manuelt/, /Jeg har funnet en mulig kandidat/,
    /Jeg har mottatt forespørselen/, /hjelper jeg deg/, /jeg henter bilopplysningene/,
    /jeg finner et mulig glass/, /jeg dobbeltsjekker glasset og sender/, /Jeg vil dobbeltsjekke/
  ];
  for (const re of forbudtJs) {
    assert.doesNotMatch(js, re, `app.js inneholder forbudt «jeg»: ${re}`);
  }

  // Forbudt i index.html (utenfor beta-invitasjonen og kundens valg)
  const forbudtHtml = [
    /Vil du at jeg skal dobbeltsjekke/, /Det hjelper meg å kontrollere/, /Send bilder til Tom Arne/,
    /Jeg har funnet et mulig glass/, /Jeg avklarer/, /Send meg forespørselen/,
    /Jeg fant ikke et trygt treff/, /Jeg dobbeltsjekker alle glassvalg/
  ];
  for (const re of forbudtHtml) {
    assert.doesNotMatch(html, re, `index.html inneholder forbudt «jeg»: ${re}`);
  }
});

test('7. ingen endring i API-er og evidence decisionAuthority', () => {
  assert.match(src, /\/api\/evidence-capture/);
  assert.match(src, /\/api\/accessories/);
  assert.match(src, /decisionAuthority:\s*'NONE'/);
});

test('8. feature-flags: review av, status-endring på i prod (08b75a6), av i staging', () => {
  assert.match(wrangler, /EVIDENCE_REVIEW_ENABLED\s*=\s*"false"/);
  assert.match(wrangler, /EVIDENCE_STATUS_CHANGE_ENABLED\s*=\s*"true"/);
  if (typeof wranglerStaging === 'string' && wranglerStaging.length > 0) {
    assert.match(wranglerStaging, /EVIDENCE_REVIEW_ENABLED\s*=\s*"false"/);
  }
});

test('9. resolver uendret (skillendeSporsmaal fortsatt intakt)', () => {
  assert.match(resolver, /skillendeSporsmaal/);
});
