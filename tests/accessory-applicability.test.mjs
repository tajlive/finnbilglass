// P0.1-regresjonstester: tilbehør er kandidat- og glassstyrt (Tom-doktrine).
// Fasit = AccessoryApplicabilityEngine (deterministisk, ikke LLM/if-else i UI).
// Regler: ingen relasjon → ingen tilbehør; UNKNOWN/NOT_APPLICABLE → aldri vist;
// REQUIRED/INCLUDED → informasjon (aldri avkrysningsboks); OPTIONAL → valg;
// lim-kit kun ved selvmontasje; VERIFY → null avkrysningsbokser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessoryApplicabilityEngine } from '../src/accessory-v1/engine.ts';
import { defaultRelations } from '../src/accessory-v1/catalogue.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const engine = new AccessoryApplicabilityEngine(defaultRelations());

function evalFor(varenr, eurokode, features = {}, fitmentStatus = 'EXACT') {
  return engine.evaluate({
    vehicleIdentity: null,
    applicationIdentity: null,
    selectedGlass: { glass: eurokode ?? '', varenr: varenr ?? null },
    glassFeatures: features,
    fitmentStatus,
    verificationMode: null,
  });
}
const VISSYNLIG = ['REQUIRED_SEPARATE', 'INCLUDED_WITH_GLASS', 'OPTIONAL_COMPATIBLE'];
const synlige = (list) => list.filter((a) => VISSYNLIG.includes(a.state));

test('1. ingen dokumentert tilbehør → ingen tilbehør', () => {
  const app = evalFor('9999X', 'NONEXISTENT123');
  // lim-kit (INSTALLATION_CONSUMABLE) er universell og montasjebetinget;
  // ingen FITMENT-tilbehør (klips/lister/sensorgel) er dokumentert.
  assert.equal(synlige(app).filter((a) => a.accessory.kind === 'FITMENT_ACCESSORY').length, 0);
});

test('1b. lim-kit er OPTIONAL (universell) men aldri automatisk kundevalg', () => {
  const app = evalFor('9999X', 'NONEXISTENT123');
  const kit = app.find((a) => a.accessory.kind === 'INSTALLATION_CONSUMABLE');
  assert.ok(kit, 'lim-kit er dokumentert universelt (Glavista alleKoder)');
  assert.equal(kit.state, 'OPTIONAL_COMPATIBLE');
  // Frontend: lim-kit vises KUN ved selvmontasje (verksted-default → skjult)
  const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(js, /montasje !== 'selv'/);
});

test('2. ingen sensorvariant → aldri sensorgel/tape/feste', () => {
  for (const features of [{ sensor: false }, { sensor: true }, {}]) {
    const app = evalFor('2500A', '2500A', features);
    const gel = app.filter((a) => ['sensor_gel', 'sensor_tape', 'sensor_bracket'].includes(a.accessory.category));
    // PROVISIONAL → UNKNOWN; sensor=false → NOT_APPLICABLE; aldri visbart som valg
    assert.equal(gel.filter((a) => VISSYNLIG.includes(a.state)).length, 0, `features=${JSON.stringify(features)}`);
  }
});

test('3. ingen klips/list i evidens → aldri klips/pyntelist', () => {
  const app = evalFor('9999X', 'NONEXISTENT123');
  const klips = app.filter((a) => ['clips', 'mouldings', 'trim_strip', 'rubber_seals'].includes(a.accessory.category));
  assert.equal(klips.length, 0);
});

test('4. inkludert tilbehør → informasjon, ikke avkrysningsboks', () => {
  const app = evalFor('2525GYA', null);
  const emb = app.find((a) => a.accessory.productId === 'MOULDING-2525GYA');
  assert.ok(emb, 'innkapslet list skal være dokumentert for 2525GYA');
  assert.equal(emb.state, 'INCLUDED_WITH_GLASS');
  assert.equal(emb.duplicateOfGlassComponent, true);
});

test('5. påkrevd tilbehør → informasjon, ikke avkrysningsboks', () => {
  const app = evalFor(null, '5948ASCHT'); // NISSAN STANZA KLIPS (GT-prisliste)
  const klips = app.find((a) => a.accessory.productId === '1207K');
  assert.ok(klips, 'klips skal være dokumentert for 5948ASCHT');
  assert.equal(klips.state, 'REQUIRED_SEPARATE');
  assert.equal(klips.requiresInstallerConfirmation, true);
});

test('6. kun relevant OPTIONAL → bare dette ene valget', () => {
  const app = evalFor('3355ABC', null); // varekort-prefiks 3355 → pyntelist-kit
  const fitmentOpt = synlige(app).filter((a) => a.accessory.kind === 'FITMENT_ACCESSORY');
  assert.ok(fitmentOpt.length >= 1, 'pyntelist-kit skal være OPTIONAL for 3355*');
  assert.ok(fitmentOpt.every((a) => a.accessory.name.includes('Pyntelist')), 'kun dokumentert pyntelist — ingen andre lister/klips');
});

test('7. VERIFY → null avkrysningsbokser (frontend)', () => {
  const app = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /VERIFY: aldri kandidatspesifikke valg/);
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /Vi avklarer eventuelt nødvendig tilbehør før vi sender tilbudet/);
});

test('8. selvmontasje + dokumentert Sika → lim-kit kan vises (frontend)', () => {
  const app = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /INSTALLATION_CONSUMABLE/);
  assert.match(app, /montasje !== 'selv'/); // lim-kit kun ved selvmontasje
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /name="montasje" value="verksted" checked/); // verksted = default (aldri automatisk Sika)
  // Statiske bokser er borte:
  assert.equal(html.includes('value="sika-pakke"'), false);
  assert.equal(html.includes('Regnsensorgel / sensorfeste'), false);
  assert.equal(html.includes('Klips / festeklips'), false);
});

test('grunnregel: engine gir aldri synlig fitment-tilbehør for ukjent glass', () => {
  // Hovedinvariant: kun dokumenterte relasjoner er synlige; ukjent glass har
  // ingen SYNLIGE fitment-relasjoner (UNKNOWN/NOT_APPLICABLE teller ikke).
  const app = evalFor('9999X', 'NONEXISTENT123');
  assert.equal(synlige(app).filter((a) => a.accessory.kind === 'FITMENT_ACCESSORY').length, 0);
});
