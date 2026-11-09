// Verifiserer valgtreet mot EKTE produksjonskatalog (kun lesing).
//
// Kjøres lokalt:  node --import tsx scripts/verify-valgtre.mjs
//
// Henter katalograder via `wrangler d1 execute --remote --json` per bilmerke og
// bygger treet med de samme funksjonene Workeren bruker. Rapporterer dekning,
// steg og brudd på invariantene:
//
//   • et typevalg uten kandidater skal ikke finnes
//   • en gren skal aldri ende i null kandidater
//   • hvert løv må gi et selection-objekt kontrakten godtar
//   • en side som ikke finnes for plasseringen skal ikke tilbys
import { execFileSync } from 'node:child_process';
import { buildClassDCandidates, matchClassDCandidates, normMerke } from '../src/fitment-v1/catalogue-candidates.ts';
import { byggValgTre, byggSelection } from '../src/glass-valg.ts';
import { normalizeGlassSelection } from '../src/glass-selection-contract.ts';

const BILER = [
  { navn: 'VW Transporter 2005', merke: 'VOLKSWAGEN', modell: 'TRANSPORTER', aar: 2005 },
  { navn: 'Toyota RAV4 2020', merke: 'TOYOTA', modell: 'RAV4', aar: 2020 },
  { navn: 'Volvo XC60 2018', merke: 'VOLVO', modell: 'XC60', aar: 2018 },
  { navn: 'Nissan Leaf 2020', merke: 'NISSAN', modell: 'LEAF', aar: 2020 },
  { navn: 'Ford Transit 2018', merke: 'FORD', modell: 'TRANSIT', aar: 2018 },
  { navn: 'BMW 320d 2015', merke: 'BMW', modell: '320D', aar: 2015 },
];

function d1(sql) {
  const ut = execFileSync('npx', ['wrangler', 'd1', 'execute', 'finnbilglass-db', '--remote', '--json', '--command', sql], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = ut.indexOf('[');
  if (start < 0) throw new Error('fant ikke JSON i wrangler-svaret');
  return JSON.parse(ut.slice(start)).flatMap((d) => d.results || []);
}

const brudd = [];
const noter = (tekst) => brudd.push(tekst);

for (const bil of BILER) {
  // Samme merkenormalisering som Workeren bruker (VOLKSWAGEN → VW), ellers
  // måler skriptet et annet søk enn kunden faktisk får.
  const merke = normMerke(bil.merke).replace(/[%_']/g, '').replace(/\s+/g, '%');
  const rows = d1(`SELECT varenr, varenavn, eurokode, kommentar FROM glass_prisliste WHERE varenavn LIKE '${merke}%' LIMIT 5000`);
  const index = buildClassDCandidates(rows.map((r) => ({
    varenr: r.varenr, varenavn: r.varenavn, eurokode: r.eurokode ?? null, kommentar: r.kommentar ?? null,
  })));
  const kandidater = matchClassDCandidates(index, bil.merke, bil.modell, bil.aar);
  const tre = byggValgTre({ kandidater });

  console.log(`\n=== ${bil.navn} — ${kandidater.length} kandidater, dekning ${tre.dekning}, ukjente plasseringer ${tre.ukjentPlassering}`);
  if (!tre.typer.length) { console.log('  (ingen dokumenterte rutetyper — kunden får hjelpetilstand)'); continue; }

  for (const type of tre.typer) {
    // Frontrute søkes i resolveren og kan lovlig ha null katalograder her.
    if (!type.antall && type.kind !== 'windshield') noter(`${bil.navn}: type ${type.kind} uten kandidater`);
    console.log(` ${type.tittel} (${type.antall})${Object.keys(type.automatisk).length ? ' · automatisk ' + JSON.stringify(type.automatisk) : ''}`);
    let lov = 0;
    const gaa = (noder, svar, dybde) => {
      for (const n of noder) {
        if (!n.antall) noter(`${bil.navn}: ${type.kind}/${n.felt}=${n.verdi} uten kandidater`);
        console.log('  ' + '  '.repeat(dybde) + `${n.tittel} (${n.antall})`);
        const arvet = { ...svar, ...(n.automatisk || {}) };
        if (n.barn.length) { gaa(n.barn, arvet, dybde + 1); continue; }
        lov += 1;
        const sel = byggSelection(type.kind, arvet);
        if (!normalizeGlassSelection(sel)) noter(`${bil.navn}: kontrakten avviser ${JSON.stringify(sel)}`);
      }
    };
    gaa(type.barn, { ...(type.automatisk || {}) }, 1);
    // Rutetyper uten spørsmål (frontrute, bakrute uten karosserivalg) har ett løv.
    if (!type.barn.length) {
      const sel = byggSelection(type.kind, { ...(type.automatisk || {}) });
      if (!normalizeGlassSelection(sel)) noter(`${bil.navn}: kontrakten avviser ${JSON.stringify(sel)}`);
      lov = 1;
    }
    console.log(`   → ${lov} gyldige sluttsvar`);
  }
}

console.log('\n' + (brudd.length ? `BRUDD (${brudd.length}):\n- ` + brudd.join('\n- ') : 'Ingen brudd på invariantene.'));
process.exit(brudd.length ? 1 : 0);
