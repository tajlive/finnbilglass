// Valgtreet: kunden skal bare få rutetyper og plasseringer som har katalogstøtte
// for den aktuelle bilen. Testene bygger treet fra håndlagde kandidater, slik at
// hver regel kan måles isolert — katalogdata kan endre seg uten at reglene gjør det.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggValgTre, byggSelection } from '../src/glass-valg.ts';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.ts';
import { normalizeGlassSelection } from '../src/glass-selection-contract.ts';

/** Minimal CatalogueCandidate. Posisjon er det eneste treet leser. */
function kand({ varenr = 'X1', varenavn = 'TEST', type = 'dor', side = null, dorLedd = null, ventilLedd = null, konflikt = false } = {}) {
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
    posisjon: { type, side, dorLedd, ventilLedd, konflikt },
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

test('dokumentert karosseri (stasjonsvogn) gir ingen karosserispørsmål', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'STV', varenavn: 'VOLVO V70 4D STV 08-', type: 'bakrute' }),
      kand({ varenr: 'SED', varenavn: 'VOLVO V70 4D SED 08-', type: 'bakrute' }),
      kand({ varenr: 'CAB', varenavn: 'VOLVO V70 4D CAB 08-', type: 'bakrute' }),
    ],
    dokumentertKropp: 'estate',
  });
  const rear = tre.typer.find((t) => t.kind === 'rear');
  // Kjent stasjonsvogn: kunden skal aldri velge mellom sedan/cabriolet/coupé.
  assert.deepEqual(rear.barn, [], 'ingen karosserispørsmål når biloppslaget dokumenterer karosseri');
  assert.equal(rear.automatisk.body, 'estate');
  // Sedan- og cabriolet-raden er uttrykkelig en annen karosseritype og skal bort.
  assert.equal(rear.antall, 1, 'bare stasjonsvogn-raden står igjen');
});

test('dokumentert karosseri forkaster aldri en rad som er ukjent', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'UKJENT', varenavn: 'VOLVO V70 4D 08-', type: 'bakrute' }),
      kand({ varenr: 'SED', varenavn: 'VOLVO V70 4D SED 08-', type: 'bakrute' }),
    ],
    dokumentertKropp: 'estate',
  });
  const rear = tre.typer.find((t) => t.kind === 'rear');
  assert.equal(rear.antall, 1, 'ukjent rad beholdes — den kan være riktig');
  assert.deepEqual(rear.barn, []);
  assert.equal(rear.automatisk.body, 'estate');
});

test('ukjent karosseri: spørsmålet kommer bare når det skiller kandidatene', () => {
  const likt = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VOLVO V70 4D STV 08-', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VOLVO V70 4D STV 09-', type: 'bakrute' }),
    ],
  });
  assert.deepEqual(likt.typer.find((t) => t.kind === 'rear').barn, [], 'likt karosseri skiller ingenting');

  const ulikt = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VOLVO V70 4D STV 08-', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VOLVO V70 4D SED 08-', type: 'bakrute' }),
    ],
  });
  assert.equal(ulikt.typer.find((t) => t.kind === 'rear').barn.length, 2, 'ulikt karosseri skiller');
});

test('ukjent rad dokumenterer ikke bakre/venstre eller bakre/høyre', () => {
  // Regresjon: fremre+venstre og bakre+ukjent. Den ukjente raden skal beholdes
  // for kontroll, men aldri skape en dokumentert sidekombinasjon for bakre dør.
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'FV', side: 'venstre', dorLedd: 'fremre' }),
      kand({ varenr: 'BU', side: null, dorLedd: 'bakre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  const bakre = dor.barn.find((n) => n.verdi === 'rear');
  assert.ok(bakre, 'bakre dør skal finnes som valg');
  assert.equal(bakre.antall, 1, 'den ukjente raden er med, men som ukjent');
  assert.deepEqual(bakre.barn, [], 'ingen sidespørsmål: ukjent side dokumenterer verken venstre eller høyre');
  assert.equal(bakre.automatisk.side, undefined, 'ukjent side skal aldri autoutfylles');
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

// ── Regresjonstilfeller ────────────────────────────────────────────────
// Konstruerte kandidater som låser bestemte regler. De er IKKE uavhengige
// fasitbiler og skal ikke telles som dokumentert passform.

test('regresjon: «begge sider» (VS+HS) gir sidevalg selv når bare én kandidat har det', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'VSHS', side: 'begge', dorLedd: 'fremre' }),
      kand({ varenr: 'V', side: 'venstre', dorLedd: 'fremre' }),
      kand({ varenr: 'H', side: 'hoyre', dorLedd: 'bakre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  const fremre = dor.barn.find((n) => n.verdi === 'front');
  assert.deepEqual(fremre.barn.map((n) => n.verdi).sort(), ['left', 'right']);
});

test('regresjon: SED+STV dokumenterer begge karosserier, ukjent dokumenterer ingen', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'A', varenavn: 'VW PASSAT 4D SED+5D STV 88-93', type: 'bakrute' }),
      kand({ varenr: 'B', varenavn: 'VW PASSAT 4D 88-93', type: 'bakrute' }),
    ],
  });
  const rear = tre.typer.find((t) => t.kind === 'rear');
  assert.deepEqual(rear.barn.map((n) => n.verdi).sort(), ['estate', 'sedan']);
});

test('regresjon: ukjent plassering tilbys aldri som valg', () => {
  const tre = byggValgTre({
    kandidater: [kand({ varenr: 'U', type: 'ukjent' }), kand({ varenr: 'D', side: 'venstre', dorLedd: 'fremre' })],
  });
  assert.equal(tre.ukjentPlassering, 1);
  assert.deepEqual(tre.typer.map((t) => t.kind).sort(), ['door', 'windshield']);
});

test('regresjon: kildekonflikt gir ubeviselig felt — autofylles aldri', () => {
  const tre = byggValgTre({
    kandidater: [
      kand({ varenr: 'K', side: 'venstre', dorLedd: 'fremre', konflikt: true }),
      kand({ varenr: 'V', side: 'venstre', dorLedd: 'fremre' }),
    ],
  });
  const dor = tre.typer.find((t) => t.kind === 'door');
  assert.equal(dor.automatisk.side, undefined, 'konflikt skal ikke gi autofylt side');
});

test('regresjon: BUNNLIST er tilbehør og blir aldri glasskandidat', () => {
  // Funnet i bred kontroll 2026-11-04: «TOYOTA RAV 4 2019- BUNNLIST»
  // (8432ASMR) ble tilbudt som frontrute fordi LIST ikke var et tilbehørsord.
  const kandidater = matchClassDCandidates(
    buildClassDCandidates([
      { varenr: '8432ASMR', varenavn: 'TOYOTA RAV 4 2019-   BUNNLIST', eurokode: '8432ASMR', kommentar: null },
      { varenr: '8432AGAC', varenavn: 'TOYOTA RAV 4 22- FR AKU LDW', eurokode: '8432AGACMV1L', kommentar: null },
    ]),
    'TOYOTA', 'RAV4', 2024,
  );
  assert.equal(kandidater.length, 1, 'bare frontruten skal stå igjen');
  assert.equal(kandidater[0].varenr, '8432AGAC');
});

test('regresjon: SENSORGEL er tilbehør, ikke glass', () => {
  // Funnet i bred kontroll på 616 biler: «VOLVO XC90 5D SUV 12- SENSORGEL»
  // (3182S) ble tilbudt som glasskandidat.
  const kandidater = matchClassDCandidates(
    buildClassDCandidates([
      { varenr: '3182S', varenavn: 'VOLVO XC90 5D SUV 12-  SENSORGEL', eurokode: '3182S', kommentar: null },
      { varenr: '3182AGN', varenavn: 'VOLVO XC90 5D SUV 12- FRONTRUTE', eurokode: '3182AGN', kommentar: null },
    ]),
    'VOLVO', 'XC90', 2015,
  );
  assert.equal(kandidater.length, 1, 'bare frontruten skal stå igjen');
  assert.equal(kandidater[0].varenr, '3182AGN');
});

// ── Én felles tilbehørsklassifisering ───────────────────────────────────
// SENSORGEL og BUNNLIST slapp gjennom fordi kandidatsøket og produkttype()
// hadde hver sin ordliste. Nå delegerer begge til erTilbehorVare().
import { erTilbehorVare } from '../src/glass-posisjon.ts';

test('tilbehør: sensorgel, sensortape, bunnlist og pyntelist stoppes', () => {
  for (const navn of [
    'VOLVO XC90 5D SUV 12-  SENSORGEL',
    'VOLVO XC90 5D SUV 12-  SENSORTAPE',
    'TOYOTA RAV 4 2019-   BUNNLIST',
    'FORD S-MAX 06-  PYNTELIST KIT  V+H',
    'BMW XM 5D SUV 23-  WS DECOR LIST',
  ]) {
    assert.equal(erTilbehorVare(navn, '9999XX'), true, `skal være tilbehør: ${navn}`);
  }
});

test('tilbehør: ekte glass med sensor-/listord i beskrivelsen stoppes ikke', () => {
  for (const navn of [
    'TOYOTA RAV 4 22- FR AKU LDW',
    'VOLVO XC90 5D SUV 12- FRONTRUTE SENSOR',
    'BMW 3ER 4T F30 12- FRONTRUTE HUD KAMERA',
    'VW GOLF VII 5D 13- BAKRUTE OPPVARMET',
  ]) {
    assert.equal(erTilbehorVare(navn, '1234GN'), false, `skal være glass: ${navn}`);
  }
});
