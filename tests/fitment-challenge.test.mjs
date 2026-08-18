/**
 * Fitment Challenge — permanent regresjons-benchmark (kategorier A–F).
 * Måler applikasjoner, kandidater, spørsmålskvalitet og ærlig UNKNOWN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EvidenceKernel } from '../src/fitment-v1/policy/kernel.js';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildEvidenceRequests, isIrrelevantQuestion } from '../src/fitment-v1/differentiation.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

const challenge = JSON.parse(readFileSync(new URL('../data/fitment-challenge.json', import.meta.url), 'utf8'));
const kernel = new EvidenceKernel();
const appResolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });
// CLASS_D-kandidatindeks (gt-prislisten) — kandidatmateriale, aldri fasit
const fixtureCatalogue = fileURLToPath(new URL('./fixtures/analytics/catalogue.json', import.meta.url));
const gtRaw = JSON.parse(readFileSync(fixtureCatalogue, 'utf8'));
const classDIndex = buildClassDCandidates(gtRaw[0].results);

function runCase(c) {
  const v = { make: c.make, model: c.model, modelYear: c.year, facelift: c.facelift ?? null };
  const apps = appResolver.resolve(v).applications;
  const kernelRes = kernel.resolve({ registrationNumber: 'CH-' + c.id, vin: null, make: c.make, model: c.model, modelYear: c.year });
  const requests = buildEvidenceRequests(kernelRes.candidates);
  const irrelevant = requests.filter((q) => isIrrelevantQuestion(q, kernelRes.candidates)).length;
  const classD = matchClassDCandidates(classDIndex, c.make, c.model, c.year);
  return { apps, candidates: kernelRes.candidates, requests, irrelevant, status: kernelRes.status ?? 'UNKNOWN', classD };
}

for (const c of challenge.cases) {
  test(`CH ${c.id} (${c.kategori}) ${c.beskrivelse}`, () => {
    const r = runCase(c);
    // 0 irrelevante spørsmål er en universell gate (C2-krav)
    assert.equal(r.irrelevant, 0, 'irrelevante spørsmål forbudt');
    const k = c.krav;

    if (k.ingenGjett) {
      assert.equal(r.status, 'UNKNOWN', 'uten data: aldri gjett');
      if (k.nullSporsmal) assert.equal(r.requests.length, 0, 'uten kandidater: null spørsmål');
      return;
    }
    if (k.applikasjoner != null) assert.equal(r.apps.length, k.applikasjoner, 'antall applikasjoner');
    if (k.generasjon) assert.ok(r.apps.some((a) => a.generation === k.generasjon), `generasjon ${k.generasjon} mangler`);
    if (k.kunPreFaceliftApplikasjon) {
      assert.ok(r.apps.length >= 1);
      assert.ok(r.apps.every((a) => a.facelift === 'pre-facelift'), 'post-facelift-applikasjon lekker inn');
    }
    if (k.flereKandidater) assert.ok(r.candidates.length > 1, 'flere kandidater forventet');
    if (k.sporsmal === 'skillende') {
      assert.ok(r.requests.length > 0, 'kandidatforskjeller må gi spørsmål');
    }
    if (k.kandidaterFraKatalogEllerUnknown) {
      assert.ok(r.classD.length > 0 || r.status === 'UNKNOWN', 'CLASS_D-kandidater ELLER ærlig UNKNOWN');
      // CLASS_D-merking er aldri fasit: klassifisering må være eksplisitt
      for (const c of r.classD) assert.equal(c.klassifisering, 'CLASS_D_CATALOGUE_CANDIDATE');
    }
    if (k.sporsmalInkluderer) {
      const features = r.requests.map((q) => q.feature);
      for (const f of k.sporsmalInkluderer) assert.ok(features.includes(f), `spørsmål om ${f} mangler`);
    }
    if (k.aldriGeneriskeTilbehorssporsmal) {
      const generisk = r.requests.some((q) => /klips|pyntelist|gummilist|list/.test(String(q.question).toLowerCase()));
      assert.equal(generisk, false, 'aldri generiske tilbehørsspørsmål');
    }
  });
}

test('CH-STATUS: challenge-settet dekker alle kategorier A–F + H (hard set)', () => {
  const kats = new Set(challenge.cases.map((c) => c.kategori));
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'H']) assert.ok(kats.has(k), `kategori ${k} mangler`);
});
