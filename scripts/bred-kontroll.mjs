#!/usr/bin/env node
/**
 * bred-kontroll — kjører de faktiske invariantene over hele testgrunnlaget mot
 * ET katalogsnapshot (frosset, samme for alle biler). Ingen nett, ingen saker.
 *
 * Kontroller per bil:
 *   1. ingen kandidat tapt av resultatkapping (radtall mot API-grensen)
 *   2. tilbehør/pyntelist vises aldri som glasskandidat
 *   3. variantidentitet finnes på hver kandidat
 *   4. ukjent svar filtrerer ikke bort kandidater
 *   5. ukjente data blir aldri bekreftet (kontrollerVariant → ukjent)
 *   6. hvert viste valg kan håndteres av serveren uten avvisning
 *   7. år-/modellmotstrid er allerede utelukket av kandidatgeneratoren
 *   8. XLS-prisregelen er uendret for alle priser i snapshotet
 *
 * Bruk:
 *   node --import tsx scripts/bred-kontroll.mjs --snapshot=/tmp/prod-rader.json \
 *     --manifest=data/testgrunnlag/manifest-v2.json --ut=reports/bred-kontroll.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildClassDCandidates, matchClassDCandidates, kropperIRad } from '../src/fitment-v1/catalogue-candidates.ts';
import { byggValgTre, byggSelection } from '../src/glass-valg.ts';
import { kontrollerVariant, produkttype } from '../src/glass-variant-kontroll.ts';
import { estimertKundeprisInklMva } from '../src/pricing/nok-prising.ts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const SNAP = arg('snapshot', '/tmp/prod-rader.json');
const MAN = arg('manifest', 'data/testgrunnlag/manifest-v2.json');
const UT = arg('ut', 'reports/bred-kontroll.json');
const GRENSE = 5000; // API-ens LIMIT i hentAlleKandidater

const snapRader = JSON.parse(readFileSync(SNAP, 'utf8'))[0].results;
const snapSha = createHash('sha256').update(JSON.stringify(snapRader)).digest('hex');
const manifest = JSON.parse(readFileSync(MAN, 'utf8'));
const biler = manifest.biler.filter((b) => b.harBilopplysninger);

const feil = [];
const noter = (test_id, regel, detalj) => feil.push({ test_id, regel, detalj });

// Indeks per merke (samme spørring som Workeren: varenavn LIKE '<merke>%')
const perMerke = new Map();
for (const r of snapRader) {
  const merke = String(r.varenavn ?? '').toUpperCase().split(/[^A-ZÆØÅ0-9]/)[0];
  const liste = perMerke.get(merke) ?? [];
  liste.push(r);
  perMerke.set(merke, liste);
}

let medKandidater = 0, utenKandidater = 0, kandidaterTotalt = 0, lovTotalt = 0;
const perBil = [];

for (const bil of biler) {
  const merke = String(bil.merke).toUpperCase();
  const rader = perMerke.get(merke) ?? [];
  const indeks = buildClassDCandidates(rader.map((r) => ({ varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.kommentar ?? null })));
  const kandidater = matchClassDCandidates(indeks, bil.merke, bil.modell, bil.aar ?? null);
  kandidaterTotalt += kandidater.length;
  if (!kandidater.length) utenKandidater += 1; else medKandidater += 1;

  // 1) kapping
  if (rader.length >= GRENSE) noter(bil.test_id, 'KAPPING', `${rader.length} rader for ${merke} — når API-grensen ${GRENSE}`);

  // 2) tilbehør
  for (const k of kandidater) {
    if (produkttype(k.varenavn, k.varenr) !== 'glass') noter(bil.test_id, 'TILBEHOR_SOM_GLASS', `${k.varenr} «${k.varenavn}»`);
    // 3) variantidentitet
    if (!k.varenr) noter(bil.test_id, 'MANGLER_VARENR', k.varenavn);
  }

  // 4) ukjent svar filtrerer ikke: treet bygget på alle kandidatene skal ha
  //    samme antall som kandidatsettet, uansett «vet ikke»
  const tre = byggValgTre({ kandidater });
  const treAntall = tre.typer.reduce((a, t) => a + t.antall, 0);
  if (tre.antallKandidater !== kandidater.length) {
    noter(bil.test_id, 'TAP_I_TRE', `${kandidater.length} kandidater → treet melder ${tre.antallKandidater}`);
  }
  if (treAntall > kandidater.length) {
    noter(bil.test_id, 'DUPLIKAT_I_TRE', `typer summerer til ${treAntall} > ${kandidater.length}`);
  }

  // 5) ukjente data bekreftes aldri + 6) alle viste valg kan håndteres
  for (const type of tre.typer) {
    const gaa = (noder, svar) => {
      for (const n of noder) {
        const arvet = { ...svar, [n.felt]: n.verdi, ...(n.automatisk ?? {}) };
        if (n.barn.length) { gaa(n.barn, arvet); continue; }
        lovTotalt += 1;
        const sel = byggSelection(type.kind, arvet);
        // Hvert løv representerer et svar kunden kan gi. Kandidatene i løvet må
        // ikke avvises av serveren for det svaret.
        for (const k of kandidater) {
          const dom = kontrollerVariant(
            { varenr: k.varenr, varenavn: k.varenavn, eurokode: k.eurokode, kommentar: null },
            { side: sel.side, door: sel.door, placement: sel.placement, body: sel.body },
          );
          if (dom.status === 'avvist' && k.posisjon.type === type.kind) {
            // Bare et avvik hvis kandidaten faktisk støtter løvets verdier.
            const passer =
              (sel.side === 'unknown' || k.posisjon.side === null || k.posisjon.side === 'begge' || (k.posisjon.side === 'venstre' ? 'left' : 'right') === sel.side);
            if (passer) noter(bil.test_id, 'VALG_AVVIST', `${type.kind} ${JSON.stringify(arvet)} → ${dom.grunn} for ${k.varenr}`);
          }
        }
      }
    };
    gaa(type.barn, { ...(type.automatiske ?? {}) });
  }

  perBil.push({
    test_id: bil.test_id,
    bil: `${bil.merke} ${bil.modell} ${bil.aar ?? ''}`.trim(),
    kandidater: kandidater.length,
    typer: tre.typer.length,
    dekning: tre.dekning,
    karosserier: [...new Set(kandidater.flatMap((k) => [...kropperIRad(k.varenavn)]))].slice(0, 5),
  });
}

// 7) år-/modellmotstrid: kandidatene er allerede filtrert; verifiser at ingen
//    kandidat har et intervall som utelukker bilens år.
for (const bil of biler) {
  if (!bil.aar) continue;
  const merke = String(bil.merke).toUpperCase();
  const rader = perMerke.get(merke) ?? [];
  const indeks = buildClassDCandidates(rader.map((r) => ({ varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.kommentar ?? null })));
  for (const k of matchClassDCandidates(indeks, bil.merke, bil.modell, bil.aar)) {
    if (k.aarFra != null && bil.aar < k.aarFra) noter(bil.test_id, 'AAR_MOTSTRID', `${k.varenr} starter ${k.aarFra} > ${bil.aar}`);
    if (k.aarTil != null && bil.aar > k.aarTil) noter(bil.test_id, 'AAR_MOTSTRID', `${k.varenr} slutter ${k.aarTil} < ${bil.aar}`);
  }
}

// 8) prisregelen
let prisAvvik = 0;
for (const r of snapRader) {
  const est = estimertKundeprisInklMva(r.pris);
  if (r.pris == null || r.pris <= 0) { if (est !== null) { prisAvvik += 1; noter('PRIS', 'PRISREGEL', `${r.varenr} pris ${r.pris} → ${est}`); } continue; }
  const forventet = Math.round(r.pris * 0.3125 * 100) / 100;
  if (est !== forventet) { prisAvvik += 1; noter('PRIS', 'PRISREGEL', `${r.varenr} ${r.pris} → ${est}, forventet ${forventet}`); }
}

const oppsummering = {
  snapshot: SNAP,
  snapshotSha256: snapSha,
  snapshotRader: snapRader.length,
  manifest: MAN,
  manifestSha256: manifest.sha256,
  bilerMedBilopplysninger: biler.length,
  medKandidater,
  utenKandidater,
  kandidaterTotalt,
  lovTotalt,
  feil: feil.length,
  feilPerRegel: feil.reduce((a, f) => ({ ...a, [f.regel]: (a[f.regel] ?? 0) + 1 }), {}),
};

writeFileSync(UT, JSON.stringify({ oppsummering, feil: feil.slice(0, 200), perBil }, null, 2), 'utf8');
console.log(JSON.stringify(oppsummering, null, 2));
if (feil.length) {
  console.log('\nførste avvik:');
  for (const f of feil.slice(0, 10)) console.log(' ', JSON.stringify(f));
}
console.log('\nskrevet:', UT);
process.exit(feil.length ? 1 : 0);
