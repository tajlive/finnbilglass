// P0.2-regresjonstester: mobil-først fotoopplevelse for evidence capture.
// Verifiserer: kamera primær (capture=environment), bildebibliotek sekundær
// (uten capture), skjulte inputs, thumbnail + erstatt/fjern, menneskelige
// feilmeldinger, og at glassresolver/decisionAuthority aldri berøres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

const KEYS = ['plate', 'windshield', 'mirror_sensor', 'interior_optional'];

test('1. kamera-knapp har capture=environment (skjult input)', () => {
  for (const key of KEYS) {
    const re = new RegExp(`id="evidence-${key}"[^>]*capture="environment"`);
    assert.match(html, re, `evidence-${key} mangler capture="environment"`);
  }
  // nøyaktig 4 evidence-inputs med capture (regnr-fil har sitt eget capture)
  const captureCount = (html.match(/id="evidence-[a-z_]+"[^>]*capture="environment"/g) || []).length;
  assert.equal(captureCount, 4, 'skal være nøyaktig 4 evidence-kamera-inputs med capture');
});

test('2. bildebibliotek-knapp har IKKE capture', () => {
  for (const key of KEYS) {
    const re = new RegExp(`id="evidence-${key}-bib"`);
    assert.match(html, re);
  }
  // bibliotek-inputene skal ikke ha capture
  const bibMedCapture = (html.match(/id="evidence-[a-z_]+-bib"[^>]*capture=/g) || []);
  assert.equal(bibMedCapture.length, 0, 'bildebibliotek-input skal ikke ha capture');
});

test('3. valgt bilde viser thumbnail + erstatt/fjern', () => {
  assert.match(js, /visEvidenceMiniatyr/);
  assert.match(js, /fjernEvidence/);
  assert.match(html, /evidence-thumb/);
  assert.match(html, /evidence-ta-paa-nytt/);
  assert.match(html, /evidence-fjern/);
  // Ta på nytt åpner kamera-input (samme som primær)
  assert.match(js, /evidence-ta-paa-nytt[\s\S]*?evidence-' \+ evidenceNokkel/);
});

test('4. ingen filinput synlig i UI', () => {
  // Alle .evidence-input har hidden-attributt
  for (const key of KEYS) {
    assert.match(html, new RegExp(`id="evidence-${key}"[^>]*hidden`));
    assert.match(html, new RegExp(`id="evidence-${key}-bib"[^>]*hidden`));
  }
  // CSS skjuler .evidence-input uansett
  assert.match(readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8'), /\.evidence-input\s*\{\s*display:\s*none/);
});

test('5. send forklarer hva som mangler uten bilde/regnr', () => {
  assert.match(js, /Ta minst ett bilde først\./);
  assert.match(js, /Søk opp bilen først/);
  // Send bruker evidenceBilder (ikke rå file-inputs)
  assert.match(js, /Object\.keys\(evidenceBilder\)/);
});

test('6. evidence API-feil gir forståelig feilmelding', () => {
  // Menneskelig feilmelding uten teknisk årsak til kunde
  assert.match(js, /Bildene ble ikke sendt\. Prøv igjen, eller send meg en forespørsel så hjelper jeg deg\./);
  // Suksess-tekst
  assert.match(js, /Takk – jeg har fått bildene og dobbeltsjekker glasset før jeg sender tilbud\./);
  // Tittel + forklaring + send-knapp (Tom-tekster)
  assert.match(html, /Vil du at jeg skal dobbeltsjekke\?/);
  assert.match(html, /Send bilder til Tom Arne/);
});

test('7. ingen endring i decisionAuthority eller glassresolver', () => {
  // Evidence-handleren endrer aldri state.resolver/state.profil (glassvalg)
  // — den kun leser state.regnr og sender bilder.
  const evidenceBlokk = js.slice(js.indexOf('P0.2: mobil-først'), js.indexOf('P2 (Beta1-funn)'));
  assert.equal(/state\.resolver\s*=/.test(evidenceBlokk), false, 'evidence-koden endrer ikke state.resolver');
  assert.equal(/state\.profil\s*=/.test(evidenceBlokk), false, 'evidence-koden endrer ikke state.profil');
  // Backend: decisionAuthority forblir NONE i evidence-capture-responsen
  const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
  assert.match(src, /decisionAuthority:\s*'NONE'/);
});

test('8. komprimering/EXIF/kvalitetssjekk beholdt', () => {
  assert.match(js, /komprimerBilde\(f\)/);
  assert.match(js, /advarsler/);
  assert.match(js, /20 \* 1024 \* 1024/); // 20 MB-grense
  assert.match(js, /\/api\/evidence-capture/);
});
