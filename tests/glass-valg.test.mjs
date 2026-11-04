// Valgtreet: kunden skal bare få rutetyper og plasseringer som har katalogstøtte
// for den aktuelle bilen. Testene bygger treet fra håndlagde kandidater, slik at
// hver regel kan måles isolert — katalogdata kan endre seg uten at reglene gjør det.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggValgTre, byggSelection } from '../src/glass-valg.ts';
import { normalizeGlassSelection } from '../src/glass-selection-contract.ts';

/** Minimal CatalogueCandidate. Posisjon er det eneste treet leser. */
function kand({ varenr = 'X1', varenavn = 'TEST', type = 'dor', side = null, dorLedd = null, ventilLedd = null } = {}) {
  return {
    eurokode: varenr,
    varenr,
    varenavn,
    features: [],
    source: 'GT_AUTO_PRISLISTE',
    klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE',
    matchReason: '',
    merke: 'TEST',
    familie: 'TEST',
    aarFra: 2000,
    aarTil: null,
    generasjon: null,
    posisjon: { type, side, dorLedd, ventilLedd, konflikt: false },
  };
}

test('bare frontrute: ett typevalg, ingen plasseringssteg', () => {
  const tre = byggValgTre({ kandidater: [kand({ type: 'frontrute' }), kand({ varenr: 'X2', type: 'frontrute' })] });
  assert.equal(tre.typer.length, 1);
  assert.equal(tre.typer[0].kind, 'windshield');
  assert.deepEqual(tre.typer[0].barn, []);
  assert.equal(tre.dekning, 'TYNN');
});

test('dørruter med bare fremre dør: dørsteget hoppes over, side spørres', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', side: 'venstre', dorLedd: 'fremre' }),
      kand({ varenr: 'B', side: 'hoyre', dorLedd: 'fremre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  assert.ok(dor, 'dørrute skal være et typevalg');
  // Ingen dørspørsmål — katalogen har bare fremre dør, og valget følger automatisk.
  assert.equal(dor.automatisk.door, 'front');
  assert.equal(dor.barn.length, 2);
  assert.equal(dor.barn[0].felt, 'side');
  assert.deepEqual(dor.barn.map((n) => n.tittel), ['Venstre side', 'Høyre side']);
});

test('ugyldige kombinasjoner finnes ikke: bakre dør er bare dokumentert på høyre side', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', side: 'venstre', dorLedd: 'fremre' }),
      kand({ varenr: 'B', side: 'hoyre', dorLedd: 'bakre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  const [fremre, bakre] = dor.barn;
  assert.equal(fremre.tittel, 'Fremre dørrute');
  assert.equal(bakre.tittel, 'Bakre dørrute');
  // Fremre finnes bare på venstre side → sidespørsmålet hoppes over.
  assert.deepEqual(fremre.barn, []);
  assert.equal(fremre.automatisk.side, 'left');
  assert.deepEqual(bakre.barn, []);
  assert.equal(bakre.automatisk.side, 'right');
});

test('kandidat uten side støtter begge svar og forsvinner ikke fra en gren', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'UTEN', side: null, dorLedd: 'fremre' }),
      kand({ varenr: 'V', side: 'venstre', dorLedd: 'fremre' }),
      kand({ varenr: 'H', side: 'hoyre', dorLedd: 'bakre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  const fremre = dor.barn.find((n) => n.verdi === 'front');
  // Kandidaten uten side er kompatibel med begge sider, men blant fremre dører
  // er bare venstre dokumentert — derfor ingen sidespørsmål og ingen høyre-gren.
  assert.deepEqual(fremre.barn, []);
  assert.equal(fremre.automatisk.side, undefined);
});

test('karosseri spørres bare når kandidatene faktisk har ulikt karosseri', () => {
  const uten = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VOLVO V70 4D STV 08-', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VOLVO V70 4D STV 09-', type: 'bakrute' }),
    ],
  });
  const utenBak = uten.typer.find((t) => t.kind === 'rear');
  assert.deepEqual(utenBak.barn, [], 'likt karosseri gir ingen spørsmål');
  assert.equal(utenBak.automatisk.body, 'estate');

  const med = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VOLVO V70 4D SED 08-', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VOLVO V70 4D STV 08-', type: 'bakrute' }),
    ],
  });
  const medBak = med.typer.find((t) => t.kind === 'rear');
  assert.equal(medBak.barn.length, 2);
  assert.equal(medBak.barn[0].felt, 'body');
  assert.deepEqual(medBak.barn.map((n) => n.tittel).sort(), ['Sedan', 'Stasjonsvogn']);
});

test('ukjent plassering telles, men tilbys ikke som valg', () => {
  const tre = byggValgTre({
    kandidater: [kand({ varenr: 'A', type: 'ukjent' }), kand({ varenr: 'B', type: 'ventil', ventilLedd: 'foran', side: 'venstre' })],
  });
  assert.equal(tre.ukjentPlassering, 1);
  // Frontrute er alltid et valg (resolveren søker den), ventil er det eneste
  // katalograder faktisk dokumenterer her.
  assert.deepEqual(tre.typer.map((t) => t.kind), ['windshield', 'ventil']);
});

test('ingen kandidater: ærlig hjelpetekst, ikke tom valgboks', () => {
  const tre = byggValgTre({ kandidater: [] });
  assert.equal(tre.dekning, 'INGEN');
  // Kunden skal fortsatt kunne søke frontrute — den går via resolveren.
  assert.deepEqual(tre.typer.map((t) => t.kind), ['windshield']);
  assert.match(tre.melding, /betyr ikke at ruten ikke finnes/);
});

test('ukjent rattplassering gir venstre/høyre — aldri fører/passasjer', () => {
  const tre = byggValgTre({
    kandidater: [kand({ varenr: 'A', side: 'venstre', dorLedd: 'fremre' }), kand({ varenr: 'B', side: 'hoyre', dorLedd: 'fremre' })],
  });
  assert.equal(tre.rattplassering, 'UKJENT');
  const dorType = tre.typer.find((t) => t.kind === 'door');
  assert.deepEqual(dorType.barn.map((n) => n.tittel), ['Venstre side', 'Høyre side']);
  assert.match(tre.sidehjelp, /kjøreretning/);
});

test('dokumentert rattplassering gir fører/passasjer', () => {
  const tre = byggValgTre({
    kandidater: [kand({ varenr: 'A', side: 'venstre', dorLedd: 'fremre' }), kand({ varenr: 'B', side: 'hoyre', dorLedd: 'fremre' })],
    styring: 'LHD',
  });
  assert.equal(tre.rattplassering, 'LHD');
  const dorType = tre.typer.find((t) => t.kind === 'door');
  assert.deepEqual(dorType.barn.map((n) => n.tittel), ['Førerside', 'Passasjerside']);
});

test('«begge sider» dokumenterer begge sider: sidevalget tilbyr venstre OG høyre', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'B', side: 'begge', dorLedd: 'fremre' }),
      kand({ varenr: 'V', side: 'venstre', dorLedd: 'fremre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  // Dør er felles (fremre) → ikke et spørsmål. Siden spørres fordi «begge»
  // dokumenterer høyre i tillegg til venstre.
  assert.deepEqual(dor.barn.map((n) => n.tittel), ['Venstre side', 'Høyre side']);
  const hoyre = dor.barn.find((n) => n.verdi === 'right');
  assert.equal(hoyre.antall, 1, 'bare «begge»-kandidaten støtter høyre');
});

test('SED+STV bevares som konkret mengde: begge karosserier tilbys', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VOLVO V70 4D SED+5D STV 08-', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VOLVO V70 4D SED 09-', type: 'bakrute' }),
    ],
  });
  const rear = tre.typer.find((t) => t.kind === 'rear');
  // «SED+STV» dokumenterer både sedan og stasjonsvogn — ikke «ukjent for begge».
  assert.deepEqual(rear.barn.map((n) => n.tittel).sort(), ['Sedan', 'Stasjonsvogn']);
});

test('byggSelection er gyldig i kontrakten for alle rutetyper', () => {
  for (const kind of ['windshield', 'door', 'side', 'rear', 'ventil', 'roof']) {
    const selection = byggSelection(kind, {});
    assert.ok(normalizeGlassSelection(selection), `kontrakten avviser selection for ${kind}: ${JSON.stringify(selection)}`);
  }
});

test('byggSelection tar med svarene kunden faktisk ga', () => {
  const selection = byggSelection('door', { door: 'front', side: 'left', body: 'estate' });
  assert.equal(selection.kind, 'door');
  assert.equal(selection.door, 'front');
  assert.equal(selection.side, 'left');
  assert.equal(selection.body, 'estate');
});
