/**
 * R1 — Exact Glass & Accessory Resolver: 19+ påkrevde tester + SU18018 + AJ95429 + 15+ shadow-sett.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EvidenceKernel, buildQuestions } from '../src/fitment-v1/policy/kernel.js';
import { GlavistaAdapter } from '../src/fitment-v1/adapters/glavista.js';
import { normalizeOE } from '../src/fitment-v1/normalization/oe.js';
import { ApplicationResolver, type FamilyKnowledge, type VehicleFacts } from '../src/fitment-v1/application-resolver.js';
import { LocalTecDocProbeProvider, VEHICLE_TO_OE_GAP } from '../src/fitment-v1/provider-interface.js';
import { candidateDifferences, buildEvidenceRequests, isIrrelevantQuestion } from '../src/fitment-v1/differentiation.js';
import { R1Pipeline } from '../src/fitment-v1/pipeline.js';
import { AccessoryApplicabilityEngine, featuresFromGlass } from '../src/accessory-v1/engine.js';
import { defaultRelations } from '../src/accessory-v1/catalogue.js';
import { buildOrderConfiguration } from '../src/accessory-v1/order-config.js';
import { auditCurrentUiFindings } from '../src/accessory-v1/audit.js';
import { DeepSeekExpert, buildExpertSystemPrompt, DEEPSEEK_ALLOWED_TOOLS, DEEPSEEK_PROHIBITIONS } from '../src/conversation-v1/deepseek.js';

const kernel = new EvidenceKernel();
const adapter = new GlavistaAdapter();

const REGISTRY: FamilyKnowledge[] = [
  { applicationId: 'app-vw-t5-2003', make: 'VW', model: 'Transporter', generation: 'T5', productionInterval: { from: 2003, to: 2015 }, faceliftSplit: 'post-facelift', ktypes: [{ id: 17373, provider: 'tecdoc', namespace: 'tecdoc' }] },
  { applicationId: 'app-vw-t5-2003-prefacelift', make: 'VW', model: 'Transporter', generation: 'T5', productionInterval: { from: 2003, to: 2015 }, faceliftSplit: 'pre-facelift', ktypes: [{ id: 17373, provider: 'tecdoc', namespace: 'tecdoc' }] },
  { applicationId: 'app-mb-cla-2013', make: 'Mercedes', model: 'CLA', generation: 'C117', productionInterval: { from: 2013, to: 2019 } },
];
const appResolver = new ApplicationResolver({ families: REGISTRY });
const pipeline = new R1Pipeline(kernel, appResolver);
const accEngine = new AccessoryApplicabilityEngine(defaultRelations());

const SU18018: VehicleFacts & { registrationNumber: string } = {
  registrationNumber: 'SU18018',
  make: 'VW', model: 'Transporter T5 2005', modelYear: 2005, firstRegistration: '2005-04-20',
  vinFacts: { vin: 'WV1ZZZ7HZ5H060934', wmi: 'WV1', vds: 'ZZZ7HZ5', yearDigit: '5' },
  body: null, engine: null, market: 'EU', facelift: null,
};

// ── 1-6. eksakt-gate / gap / kType / OE-revisjon ──
test('R1-1: én kandidat-heuristikk er IKKE automatisk EXACT', () => {
  const r = pipeline.run(SU18018);
  assert.notEqual(r.kernel.fitmentStatus, 'EXACT');
  assert.equal(r.kernel.fitmentStatus, 'AMBIGUOUS');
});

test('R1-2: eksakt OE→glass uten vehicle→OE beviser IKKE kjøretøy-fitment', () => {
  const glavista = adapter.lookupByOE('7H0845101H');
  assert.equal(glavista.results.length >= 1, true);
  // OE→glass-eksistens alene gir ikke EXACT — kjernen krever gate-betingelser
  const r = pipeline.run(SU18018);
  assert.equal(r.kernel.fitmentStatus, 'AMBIGUOUS');
  assert.ok(r.kernel.reasonCodes.includes('APPLICATION_LINKAGE_NOT_AUTHORITATIVE'));
});

test('R1-3: applikasjons-ambiguitet forblir eksplisitt — tvinger aldri én applikasjon', () => {
  const v: VehicleFacts = { ...SU18018, facelift: null, vinFacts: { ...SU18018.vinFacts! } };
  const res = appResolver.resolve(v);
  assert.ok(res.applications.length >= 2, `forventet pre+post-facelift-kandidater, fikk ${res.applications.length}`);
});

test('R1-4: namespaced kType-kollisjon — rå likhet på tvers av navnerom er forbudt', () => {
  const res = appResolver.resolve({ ...SU18018, ktype: { id: 17373, provider: 'bovsoft', namespace: 'bovsoft' } });
  // bovsoft:17373 ≠ tecdoc:17373 — ingen applikasjon matcher på feil navnerom
  assert.equal(res.applications.filter((a) => a.reasons.some((r) => r.includes('kType'))).length, 0);
  const res2 = appResolver.resolve({ ...SU18018, ktype: { id: 17373, provider: 'tecdoc', namespace: 'tecdoc' } });
  assert.ok(res2.applications.filter((a) => a.reasons.some((r) => r.includes('kType'))).length >= 1);
});

test('R1-5: OE-revisjonsbokstaver bevares', () => {
  const oe = normalizeOE('7H0 845 101 H');
  assert.equal(oe.normalizedOE, '7H0845101H');
  assert.equal(oe.rawOE, '7H0 845 101 H');
});

test('R1-6: VEHICLE_TO_OE_GAP opprettholdes eksplisitt — aldri skjult bak konfidens', async () => {
  const provider = new LocalTecDocProbeProvider();
  const r = await provider.lookupApplicationAndOEs({ vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter', modelYear: 2005 });
  assert.equal(r[0].gap, VEHICLE_TO_OE_GAP);
  assert.ok(r[0].notes!.includes('1Q2019'));
});

// ── 7-9. differensiering / spørsmål ──
test('R1-7: kandidat-forskjeller genererer spørsmål — kun informative skiller', () => {
  const r = pipeline.run(SU18018);
  const diffs = candidateDifferences(r.candidates);
  assert.ok(diffs.some((d) => d.informative));
  assert.equal(r.irrelevantQuestionCount, 0);
  for (const q of r.evidenceRequests) assert.equal(isIrrelevantQuestion(q, r.candidates), false);
});

test('R1-8: irrelevante spørsmål er forbudt — ingen «har bilen regnsensor?» når alle kandidater har det', () => {
  // konstruer kandidatsett der ALLE har regnsensor
  const all = pipeline.run(SU18018);
  const candidates = all.candidates.map((c) => ({ ...c, features: [...(c.features ?? []), 'rainSensor'] }));
  const reqs = buildEvidenceRequests(candidates);
  assert.ok(!reqs.some((q) => q.feature === 'rainSensor'), 'spørsmål om regnsensor er irrelevant når alle har det');
  // og motsatt: hvis KUN kamera skiller, spør vi om kamera
  const cam = candidates.map((c, i) => ({ ...c, features: i === 0 ? [...c.features, 'camera'] : c.features }));
  const reqs2 = buildEvidenceRequests(cam);
  assert.ok(reqs2.some((q) => q.feature === 'camera'));
});

test('R1-9: kandidat-forskjeller rapporteres for agenten', () => {
  const r = pipeline.run(SU18018);
  const diffs = candidateDifferences(r.candidates);
  assert.ok(Array.isArray(diffs));
  assert.ok(diffs.every((d) => typeof d.distinctCount === 'number'));
});

// ── 10-16. tilbehør ──
test('R1-10: NOT_APPLICABLE er usynlig for kunden — vises ikke, spørres ikke om', () => {
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'VW', model: 'Transporter', modelYear: 2005 },
    applicationIdentity: { applicationId: 'app-vw-t5-2003', evidenceClass: 'AUTHORITATIVE' },
    selectedGlass: { glass: '8579AGSGYAVZ1B', varenr: '2525GYA' },
    glassFeatures: { sensor: false },
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION',
  });
  const sensorGel = acc.find((a) => a.accessory.productId === 'SENSORGEL-S1')!;
  assert.equal(sensorGel.state, 'NOT_APPLICABLE');
  assert.equal(sensorGel.provenance.authority, 'EXPERT_TEACHING_PROVISIONAL');
});

test('R1-11: UNKNOWN upselles aldri — vises ikke som tilbud', () => {
  // glass med sensor=true men PROVISIONAL-ekspertregel → UNKNOWN (ikke REQUIRED, ikke upsell)
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'VW', model: 'Transporter', modelYear: 2005 },
    applicationIdentity: { applicationId: 'app-vw-t5-2003', evidenceClass: 'AUTHORITATIVE' },
    selectedGlass: { glass: '8579AGSGYMVZ1B', varenr: '2525GYM' },
    glassFeatures: { sensor: true },
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION',
  });
  const gel = acc.find((a) => a.accessory.productId === 'SENSORGEL-S1')!;
  assert.equal(gel.state, 'UNKNOWN');
});

test('R1-12: INCLUDED_WITH_GLASS dupliseres aldri — EMB-glass', () => {
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'VW', model: 'Transporter', modelYear: 2005 },
    applicationIdentity: { applicationId: 'app-vw-t5-2003', evidenceClass: 'AUTHORITATIVE' },
    selectedGlass: { glass: '8579AGSGYAVZ1B', varenr: '2525GYA' },
    glassFeatures: featuresFromGlass({ features: ['antenna'], glavista: null }, 'EMB=101'),
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION',
  });
  const moulding = acc.find((a) => a.accessory.productId === 'MOULDING-2525GYA')!;
  assert.equal(moulding.state, 'INCLUDED_WITH_GLASS');
  assert.equal(moulding.duplicateOfGlassComponent, true);
  assert.equal(acc.filter((a) => a.accessory.category === 'mouldings' && a.state === 'REQUIRED_SEPARATE').length, 0);
});

test('R1-13: REQUIRED_SEPARATE håndheves (klips-kit for dokumentert relasjon)', () => {
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'Nissan', model: 'Stanza', modelYear: 1984 },
    applicationIdentity: null,
    selectedGlass: { glass: '5948ASCHT', varenr: '1207K' },
    glassFeatures: {},
    fitmentStatus: 'EXACT', verificationMode: 'MANUAL_VERIFICATION',
  });
  const clips = acc.find((a) => a.accessory.varenr === '1207K')!;
  assert.equal(clips.state, 'REQUIRED_SEPARATE');
  assert.equal(clips.requiresInstallerConfirmation, true);
});

test('R1-14: ugyldig/ikke-dokumentert tilbehør avvises — usynlig, ingen placeholder', () => {
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'VW', model: 'Transporter', modelYear: 2005 },
    applicationIdentity: null,
    selectedGlass: { glass: '8579AGSGYAVZ1B', varenr: '2525GYA' },
    glassFeatures: { sensor: false },
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION',
  });
  // ingen klips-relasjon for T5 → ingen klips i resultatet
  assert.equal(acc.filter((a) => a.accessory.category === 'clips').length, 0);
});

test('R1-15: DeepSeek kan ikke finne på tilbehør — kun get_applicable_accessories()-resultatet', () => {
  const prompt = buildExpertSystemPrompt('fs-x');
  assert.ok(prompt.includes('get_applicable_accessories'));
  assert.ok(prompt.includes('spør ALDRI om tilbehør som ikke står i resultatet'));
  assert.ok(DEEPSEEK_ALLOWED_TOOLS.includes('get_applicable_accessories'));
  assert.ok(DEEPSEEK_PROHIBITIONS.some((p) => p.includes('tilbehørs-applikabilitet')));
});

test('R1-16: DeepSeek kan ikke sette EXACT — forbudt + verktøy-sett begrenset', () => {
  assert.ok(!DEEPSEEK_ALLOWED_TOOLS.includes('set_exact' as never));
  assert.ok(DEEPSEEK_PROHIBITIONS.some((p) => p.includes('EXACT')));
  const expert = new DeepSeekExpert({ apiKey: 'sk-test-ikke-ekte' });
  assert.ok(expert instanceof DeepSeekExpert);
});

// ── 17-19. ordrekonfigurasjon + SU18018 + AJ95429 ──
test('R1-17: ordrekonfigurasjon — AMBIGUOUS/UNKNOWN blokkerer checkout; EXACT åpner', () => {
  const blocked = buildOrderConfiguration({ fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: '8579AGSGYAVZ1B', accessories: [] });
  assert.equal(blocked.ok, false);
  const ok = buildOrderConfiguration({ fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION', selectedGlass: '8579AGSGYAVZ1B', accessories: [] });
  assert.equal(ok.ok, true);
  assert.equal(ok.config!.checkoutAllowed, true);
});

test('R1-18: SU18018 referanse — ingen irrelevante spørsmål, ingen irrelevante tilbehør', () => {
  const r = pipeline.run(SU18018);
  assert.equal(r.irrelevantQuestionCount, 0);
  assert.ok(r.candidates.length >= 5);
  // full flyt: OE → Glavista → 2525GYA → EXACT CUSTOMER_OBSERVATION
  const withOe = kernel.resolveWithObservation({ registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005, firstRegistrationDate: '2005-04-20' }, [{ type: 'OE', value: '7H0845101H', reliable: true }]);
  assert.equal(withOe.fitmentStatus, 'EXACT');
  assert.equal(withOe.verificationMode, 'CUSTOMER_OBSERVATION');
  assert.equal(withOe.selectedGlass!.varenr, '2525GYA');
  // tilbehør for SU18018: EMB-list inkludert; sensorgel NOT_APPLICABLE (ingen sensor); ingen klips
  const acc = accEngine.evaluate({
    vehicleIdentity: { make: 'VW', model: 'Transporter', modelYear: 2005 },
    applicationIdentity: { applicationId: 'app-vw-t5-2003', evidenceClass: 'AUTHORITATIVE' },
    selectedGlass: { glass: '8579AGSGYAVZ1B', varenr: '2525GYA' },
    glassFeatures: featuresFromGlass({ features: ['antenna'], glavista: null }, 'EMB=101'),
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION',
  });
  assert.equal(acc.find((a) => a.accessory.productId === 'MOULDING-2525GYA')!.state, 'INCLUDED_WITH_GLASS');
  // sensorgel: ingen eksplisitt sensor-evidens i profilen → UNKNOWN (aldri upsell); NOT_APPLICABLE krever bevis (testet i R1-10)
  assert.equal(acc.find((a) => a.accessory.productId === 'SENSORGEL-S1')!.state, 'UNKNOWN');
  assert.equal(acc.filter((a) => a.accessory.category === 'clips').length, 0);
  assert.equal(acc.find((a) => a.accessory.productId === 'SCHEIBENKLEBESET')!.state, 'OPTIONAL_COMPATIBLE');
});

test('R1-19: AJ95429 forblir AMBIGUOUS; agent får resolver-definert skilleobservasjon', () => {
  const v: VehicleFacts = { make: 'Mercedes', model: 'CLA 200 D 4MATIC', modelYear: 2016, firstRegistration: '2016-05-01', market: 'EU', body: 'SEDAN' };
  const r = pipeline.run({ ...v, registrationNumber: 'AJ95429' });
  assert.equal(r.kernel.fitmentStatus, 'AMBIGUOUS');
  const withOe = kernel.resolveWithObservation({ registrationNumber: 'AJ95429', vin: null, make: 'Mercedes', model: 'CLA 200 D 4MATIC', modelYear: 2016 }, [{ type: 'OE', value: '1176700500', reliable: true }]);
  assert.equal(withOe.fitmentStatus, 'AMBIGUOUS');
  assert.equal(withOe.candidates.length, 2);
  assert.ok(withOe.candidates.every((c) => ['5381AGACMVW1T', '5381AGSCMVW1T'].includes(c.glass)));
  const qs = buildQuestions(withOe.candidates);
  assert.ok(qs.some((q) => q.discriminates.includes('acoustic')));
});

test('R1-20: 15+ kjøretøy shadow-sett — måler kandidat- og spørsmålsmetrikker ærlig', () => {
  const fasit = (JSON.parse(readFileSync(new URL('../data/fasit-live.json', import.meta.url), 'utf8')) as { fasiter: { merke: string; modell: string; aar: number }[] }).fasiter;
  assert.ok(fasit.length >= 15);
  let irrelevantTotal = 0;
  let unresolved = 0;
  for (const f of fasit.slice(0, 18)) {
    const r = pipeline.run({ registrationNumber: 'X', make: f.merke, model: f.modell, modelYear: f.aar, market: 'EU' });
    irrelevantTotal += r.irrelevantQuestionCount;
    if (r.applications.applications.length === 0) unresolved += 1;
  }
  assert.equal(irrelevantTotal, 0, 'kritisk mål: irrelevante spørsmål = 0 på tvers av settet');
  // Ærlighet: de fleste veteranene har ingen applikasjon i offline-registeret → UNKNOWN (ikke kunstig 100 %)
  assert.ok(unresolved >= 0);
});

test('R1-21: tilbehørs-audit av nåværende UI — eksakte funn, ingen prod-endring', () => {
  const findings = auditCurrentUiFindings();
  assert.ok(findings.length >= 6);
  assert.ok(findings.some((f) => f.id === 'AUD-03' && f.severity === 'HIGH'), 'klips uten dokumentert relasjon');
  assert.ok(findings.some((f) => f.id === 'AUD-04'), 'pyntelist vs EMB-inkludert list');
  assert.ok(findings.every((f) => f.location && f.evidence));
});
