/**
 * R1 shadow-kjøring mot dagens resolver (2026-08-18).
 * SU18018 + fasit-live-utvalg. R1 påvirker ALDRI produksjon.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { EvidenceKernel } from '../src/fitment-v1/policy/kernel.js';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { R1Pipeline } from '../src/fitment-v1/pipeline.js';
import { AccessoryApplicabilityEngine } from '../src/accessory-v1/engine.js';
import { defaultRelations } from '../src/accessory-v1/catalogue.js';
import { gtRaderSett } from '../src/vin-resolver.js';

const kernel = new EvidenceKernel();
const appResolver = new ApplicationResolver({
  families: [
    { applicationId: 'app-vw-t5-2003', make: 'VW', model: 'Transporter', generation: 'T5', productionInterval: { from: 2003, to: 2015 } },
    { applicationId: 'app-mb-cla-2013', make: 'Mercedes', model: 'CLA', generation: 'C117', productionInterval: { from: 2013, to: 2019 } },
  ],
});
const pipeline = new R1Pipeline(kernel, appResolver);
const accEngine = new AccessoryApplicabilityEngine(defaultRelations());

const fasit = JSON.parse(readFileSync(new URL('../data/fasit-live.json', import.meta.url), 'utf8')).fasiter;
const cases = [
  { registrationNumber: 'SU18018', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005, legacyUtfall: 'VERIFY' },
  { registrationNumber: 'AJ95429', make: 'Mercedes', model: 'CLA 200 D 4MATIC', modelYear: 2016, legacyUtfall: 'VERIFY' },
  ...fasit.slice(0, 14).map((f) => ({ registrationNumber: 'X', make: f.merke, model: f.modell, modelYear: f.aar, legacyUtfall: 'PINPOINT' })),
];

const rows = [];
let irrelevantTotal = 0;
let legacyCandsTotal = 0;
let r1InitialTotal = 0;
let exactCount = 0;
let ambiguousCount = 0;
let unknownCount = 0;

for (const c of cases) {
  const r = pipeline.run(c);
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: c.make, model: c.model, modelYear: c.modelYear },
    applicationIdentity: r.applications.applications[0] ? { applicationId: r.applications.applications[0].applicationId, evidenceClass: r.applications.applications[0].evidenceClass } : null,
    selectedGlass: r.kernel.selectedGlass ? { glass: r.kernel.selectedGlass.glass, varenr: r.kernel.selectedGlass.varenr } : null,
    glassFeatures: {},
    fitmentStatus: r.kernel.fitmentStatus, verificationMode: r.kernel.verificationMode,
  });
  const legacyCands = (() => { try { return gtRaderSett(c.make, c.model, c.modelYear, null).length; } catch { return 0; } })();
  irrelevantTotal += r.irrelevantQuestionCount;
  legacyCandsTotal += legacyCands;
  r1InitialTotal += r.candidates.length;
  if (r.kernel.fitmentStatus === 'EXACT') exactCount += 1;
  else if (r.kernel.fitmentStatus === 'AMBIGUOUS') ambiguousCount += 1;
  else unknownCount += 1;
  rows.push({
    vehicle: `${c.make} ${c.model} (${c.modelYear})`,
    legacyUtfall: c.legacyUtfall,
    legacyCandidates: legacyCands,
    r1InitialCandidates: r.candidates.length,
    r1Applications: r.applications.applications.length,
    r1Questions: r.evidenceRequests.map((q) => q.feature),
    irrelevantQuestions: r.irrelevantQuestionCount,
    r1Status: r.kernel.fitmentStatus,
    r1VerificationMode: r.kernel.verificationMode,
    vehicleToOeGap: r.vehicleToOeGap,
    accessoryStates: acc.map((a) => `${a.accessory.productId}:${a.state}`),
  });
}

const metrics = {
  cases: cases.length,
  irrelevantQuestionTotal: irrelevantTotal,
  averageInitialCandidates: Math.round((r1InitialTotal / cases.length) * 100) / 100,
  averageLegacyCandidates: Math.round((legacyCandsTotal / cases.length) * 100) / 100,
  exactRate: exactCount / cases.length,
  ambiguousRate: ambiguousCount / cases.length,
  unknownRate: unknownCount / cases.length,
  applicationResolutionCoverage: rows.filter((r) => r.r1Applications > 0).length / cases.length,
};

const out = { metrics, rows };
writeFileSync(new URL('../data/r1-shadow-results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(metrics, null, 2));
console.log('\n=== SU18018 (shadow) ===');
console.log(JSON.stringify(rows[0], null, 2));
console.log('\n=== AJ95429 (shadow) ===');
console.log(JSON.stringify(rows[1], null, 2));
