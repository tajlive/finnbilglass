// Serverkontroll av valgt variant: bil + kundens svar om side, dør, plassering,
// karosseri og utstyr. Dokumentert motstrid avvises; ukjent går videre men lagres
// aldri som bekreftet passform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kontrollerVariant, produkttype, salgsenhet, feltErRelevant } from '../src/glass-variant-kontroll.ts';

const RAV4 = { varenr: '8432AGAC', varenavn: 'TOYOTA RAV 4 22- FR AKU LDW', eurokode: '8432AGACMV1L', kommentar: null };
const VENSTRE_DOR = { varenr: '1111', varenavn: 'VOLVO V70 4D STV 08- DØRRUTE VS', eurokode: null, kommentar: null };
const HOYRE_DOR = { varenr: '2222', varenavn: 'VOLVO V70 4D STV 08- DØRRUTE HS', eurokode: null, kommentar: null };
const BEGGE_DOR = { varenr: '3333', varenavn: 'VOLVO V70 4D STV 08- DØRRUTE VS/HS', eurokode: null, kommentar: null };
const VARMT = { varenr: '4444', varenavn: 'VOLVO V70 4D STV 08- FRONTRUTE', eurokode: null, kommentar: 'OPPVARMET' };

// ── Produkttype: rad_type er upålitelig ─────────────────────────────────

test('produkttype: pyntelist/klips er ikke glass, selv når rad_type sier glass', () => {
  assert.equal(produkttype('FORD S-MAX 06-  PYNTELIST KIT  V+H', '2735PYKIT'), 'list');
  assert.equal(produkttype('NISSAN CHERRY N12 3/5D CC 82-86', '1234PY'), 'list');
  assert.equal(produkttype('TOYOTA RAV 4 22- FR AKU LDW', '8432AGAC'), 'glass');
});

test('kontrollerVariant: tilbehør avvises som variant', () => {
  const ut = kontrollerVariant({ varenr: '2735PYKIT', varenavn: 'FORD S-MAX 06-  PYNTELIST KIT  V+H', eurokode: '3568ASMML+3568AS' }, {});
  assert.equal(ut.status, 'avvist');
  assert.equal(ut.grunn, 'produkttype');
});

// ── Salgsenhet: V+H er sidedekning, ikke bevis på to glass ──────────────

test('salgsenhet: V+H gir ukjent, ikke par', () => {
  const ut = salgsenhet('CITROEN JUMPER V+H DUCATO LAV', '22547CL');
  assert.equal(ut.enhet, 'ukjent');
  assert.match(ut.grunnlag, /sidedekning, ikke bekreftet pakkeinnhold/);
});

test('salgsenhet: fravær av par-ord er ikke dokumentasjon på enkeltglass', () => {
  const ut = salgsenhet('TOYOTA RAV 4 22- FR AKU LDW', '8432AGAC');
  assert.equal(ut.enhet, 'ukjent');
  assert.match(ut.grunnlag, /ingen kildeopplysning/);
});

test('salgsenhet: uttrykkelig PAR av glass gir par (to glass)', () => {
  assert.equal(salgsenhet('FORD S-MAX 06- SIDERUTE PAR', '9999GN').enhet, 'par');
});

test('salgsenhet: SETT gir sett, ikke par — antall glass er ikke dokumentert', () => {
  const ut = salgsenhet('FORD S-MAX 06- SIDERUTE SETT', '9999GN');
  assert.equal(ut.enhet, 'sett');
  assert.match(ut.grunnlag, /antall glass ikke dokumentert/);
});

test('salgsenhet: tilbehørssett er ikke et glasspar', () => {
  const ut = salgsenhet('FORD S-MAX 06- PYNTELIST SETT', '2735PYKIT');
  assert.equal(ut.enhet, 'ukjent');
  assert.match(ut.grunnlag, /ikke glass/);
});

// ── Riktig bil, feil side ────────────────────────────────────────────────

test('riktig bil + feil side avvises med forståelig tekst', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, { side: 'right' });
  assert.equal(ut.status, 'avvist');
  assert.equal(ut.grunn, 'side');
  assert.match(ut.melding, /høyre side/);
  assert.match(ut.melding, /venstre/);
});

test('riktig side bekreftes', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, { side: 'left' });
  assert.equal(ut.status, 'bekreftet');
});

test('«begge sider»-vare støtter både venstre og høyre', () => {
  assert.equal(kontrollerVariant(BEGGE_DOR, { side: 'left' }).status, 'bekreftet');
  assert.equal(kontrollerVariant(BEGGE_DOR, { side: 'right' }).status, 'bekreftet');
});

// ── Endret svar etter variantvalg ───────────────────────────────────────

test('samme variant: endret sidesvar etter valget gir avvik', () => {
  assert.equal(kontrollerVariant(VENSTRE_DOR, { side: 'left' }).status, 'bekreftet');
  assert.equal(kontrollerVariant(VENSTRE_DOR, { side: 'right' }).status, 'avvist');
  assert.equal(kontrollerVariant(HOYRE_DOR, { side: 'left' }).status, 'avvist');
});

// ── Ukjent side/utstyr går videre, men aldri som bekreftet ──────────────

test('ukjent side gir status ukjent med uavklart side', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, {});
  assert.equal(ut.status, 'ukjent');
  assert.ok(ut.uavklart.includes('side'));
});

test('«vet ikke»-svar er ukjent, ikke motstrid', () => {
  const ut = kontrollerVariant(VARMT, { answers: { oppvarmet: 'vet-ikke' } });
  assert.equal(ut.status, 'ukjent');
});

// ── Feil utstyr ─────────────────────────────────────────────────────────

test('kunde sier nei til oppvarmet, men varen er dokumentert oppvarmet → avvist', () => {
  const ut = kontrollerVariant(VARMT, { side: 'left', answers: { oppvarmet: 'nei' } });
  assert.equal(ut.status, 'avvist');
  assert.equal(ut.grunn, 'utstyr');
  assert.match(ut.melding, /oppvarmet/);
});

test('kunde sier ja til oppvarmet på vare uten dokumentasjon → ukjent, ikke avvisning', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, { side: 'left', answers: { oppvarmet: 'ja' } });
  assert.equal(ut.status, 'ukjent');
});

// ── Dørledd ─────────────────────────────────────────────────────────────

test('feil dørledd avvises', () => {
  const bakre = { varenr: '5555', varenavn: 'VOLVO V70 4D STV 08- DØRRUTE BAKRE VS', eurokode: null, kommentar: null };
  const ut = kontrollerVariant(bakre, { side: 'left', door: 'front' });
  assert.equal(ut.status, 'avvist');
  assert.equal(ut.grunn, 'dor');
});

// ── Relevans: «ikke relevant» er ikke «ukjent» ──────────────────────────

test('frontrute: side er ikke relevant og skal aldri registreres som uavklart', () => {
  // Kunden har svart side, men en frontrute har ingen side — feltet er
  // «ikke relevant», ikke «ukjent». Svaret skal aldri bli bekreftet passform.
  const ut = kontrollerVariant(RAV4, { side: 'left', answers: { oppvarmet: 'nei' } });
  assert.notEqual(ut.status, 'avvist');
  assert.ok(!('uavklart' in ut) || !ut.uavklart.includes('side'), 'side skal ikke stå som uavklart');
  assert.notEqual(ut.status, 'bekreftet');
});

test('frontrute uten noen svar: ukjent, ikke bekreftet', () => {
  const ut = kontrollerVariant(RAV4, {});
  assert.equal(ut.status, 'ukjent');
  assert.ok(ut.uavklart.some((u) => u.startsWith('ingen dokumenterte egenskaper')));
});

test('dørrute med ukjent side: ukjent med side i lista', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, { door: 'front' });
  assert.equal(ut.status, 'ukjent');
  assert.ok(ut.uavklart.includes('side'));
});

test('feltErRelevant: side gjelder dør/side/ventil, ikke frontrute', () => {
  assert.equal(feltErRelevant('dor', 'side'), true);
  assert.equal(feltErRelevant('ventil', 'side'), true);
  assert.equal(feltErRelevant('frontrute', 'side'), false);
  assert.equal(feltErRelevant('frontrute', 'body'), true);
});

// ── Utstyr: dokumentert motstrid avvises, ukjent bekreftes ikke ──────────

test('utstyr: dokumentert oppvarmet + kunde sier ja → bekreftet', () => {
  const ut = kontrollerVariant(VARMT, { side: 'left', answers: { oppvarmet: 'ja' } });
  assert.equal(ut.status, 'bekreftet');
});

test('utstyr: dokumentert oppvarmet + «vet ikke» → ukjent, ikke motstrid', () => {
  const ut = kontrollerVariant(VARMT, { side: 'left', answers: { oppvarmet: 'vet-ikke' } });
  assert.equal(ut.status, 'ukjent');
});

test('utstyr: ukjent produktegenskap + kunde sier ja → ukjent', () => {
  const ut = kontrollerVariant(VENSTRE_DOR, { side: 'left', answers: { oppvarmet: 'ja' } });
  assert.equal(ut.status, 'ukjent');
  assert.ok(ut.uavklart.some((u) => u.startsWith('utstyr:')));
});

test('utstyr: endret svar etter variantvalg gir avvik', () => {
  assert.equal(kontrollerVariant(VARMT, { side: 'left', answers: { oppvarmet: 'ja' } }).status, 'bekreftet');
  assert.equal(kontrollerVariant(VARMT, { side: 'left', answers: { oppvarmet: 'nei' } }).status, 'avvist');
});
