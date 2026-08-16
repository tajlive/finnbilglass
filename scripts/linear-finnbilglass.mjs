#!/usr/bin/env node
/** Opprett FinnBilGlass OE/VIN Pinpoint-issues i Linear (team KLA) via GraphQL.
 *  Bruk: node scripts/linear-finnbilglass.mjs [--comment <issueId>]
 */
import { execFileSync } from 'node:child_process';

const KEY = execFileSync('grep', ['^LINEAR_API_KEY=', '/Users/taj/klarpakke/.env.local'], { encoding: 'utf8' })
  .split('=')[1].trim().replace(/['"]/g, '');
const TEAM = 'a2b657ba-6d13-48b0-8570-25cbcb69f9c4'; // KLA

function gql(query, variables = {}) {
  const res = execFileSync('curl', [
    '-s', '-X', 'POST', 'https://api.linear.app/graphql',
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: ${KEY}`,
    '-d', JSON.stringify({ query, variables }),
  ], { encoding: 'utf8' });
  const d = JSON.parse(res);
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '));
  return d.data;
}

const mainDesc = `Oppdrag (Tom 2026-08-13): OE/VIN-pinpoint for finnbilglass.no — få matcheren fra 76 % til 1:1-riktig treff ved å koble på Autoglass B2B-datakilder. Alternativ A: lokale kopier av resolver-data, ingen runtime-avhengighet til B2B-DB.

## Status: Fase 1–3 implementert på branch \`feat/oe-vin-pinpoint\` (IKKE committet, IKKE prod-deployet)

### Bygget
- \`migrations/0001_resolver_tables.sql\` + \`0002_staging_baseline.sql\` (kjørt mot staging-DB \`finnbilglass-db-staging\`)
- \`scripts/import-resolver-data.mjs\` — repeterbar, versjonert import m/ metadata (resolver_meta: source_version/source_updated_at/imported_at + radtall). Støtter B2B-live-modus via B2B_CLOUDFLARE_API_TOKEN.
- \`src/vin-resolver.ts\` — tre eksplisitte utfall: PINPOINT / VERIFY / FALLBACK. Lag: L1 ground_truth (verifiserte kjøretøy→frontrute), L2 glass_catalog (Pilkington brand/modell/år/utstyr), L3 ktype (klar, tom lokal), L4 = eksisterende tekstmatcher (uendret).
- \`src/index.ts\` — resolver innkoblet i /api/frontrute + /api/regnr. FALLBACK → gammel matcher.
- \`wrangler.staging.toml\` — staging-worker (workers.dev kun, ingen DNS-endring)
- \`scripts/test-fasit.mjs\` — SU18018→PINPOINT 2525CSGYA (hard) + AJ95429→VERIFY
- \`scripts/test-100-vin.mjs\` — test-100 klassifisert (correct_pinpoint/wrong_pinpoint/verify/fallback)

### Importerte radtall (staging, verifisert)
- ground_truth: 2 008 · glass_catalog: 33 215 · oe_eurocode_mapping: 341 · ktype_registry: 833 · vin_ktype_map: 0 (lokal modus)
- autoglass_prisliste: 29 627 (kopiert fra prod til staging)

### Fasit-tester: 2 FEIL funnet (og patchet, IKKE verifisert ennå)
1. AJ95429 → feil PINPOINT 5392AGNM (W213 E-klasse): GT-match via substring «CLA»⊂«CLASS». Fiks: ordbasert matching.
2. SU18018 → VERIFY med feil generasjon (1073GB = 1980). Fiks: årsvindu må være kjent (kolonne eller modellstreng) og inneholde bilens år.
Siste patch er typechecket-klar men ikke redeployet/testet.

### Gjenstår (før arkitektur-review)
1. tsc --noEmit → 2. redeploy staging → 3. test-fasit grønn → 4. test-100-klassifisering → 5. commit → RAPPORT + STOPP for arkitektur-review (UI/prod-deploy er IKKE godkjent ennå)

### Blocker
B2B CLOUDFLARE_API_TOKEN (konto 2266e975) mangler — vin_ktype_map (20 556 rader) + enriched glass_catalog + SU18018-fasit ligger kun i B2B-live-DB. Egen sak opprettet.`;

const blockerDesc = `Blocker for full OE/VIN-pinpoint (FINNBILGLASS OE/VIN Pinpoint — Fase 1–3):

- B2B glass-catalog-db ligger på CF-konto 2266e975 (Autoglass).
- BWS har kun ETT CLOUDFLARE_API_TOKEN (konto 80d5b1d5, scoped) — verifisert: gir 10000/Auth-feil mot 2266e975.
- Klarpakke-tokenet (.env.local) gir samme feil mot 2266e975. CF MCP er nede (serverfeil). Lokale filer er delvise (Pilkington-dump uten ktype/OE-enrichment; ground-truth-seed mangler SU18018-raden).
- Uten tilgang: vin_ktype_map (20 556 rader) + enriched glass_catalog + SU18018-fasit (2525CSGYA) kan ikke importeres → SU18018 hard regresjonstest feiler ærlig.

Trenger Tom: legge B2B CLOUDFLARE_API_TOKEN i BWS (prosjekt Klarpakke) — eller eksportere tabellene. Import-scriptet støtter alt: B2B_CLOUDFLARE_API_TOKEN + B2B_CLOUDFLARE_ACCOUNT_ID → wrangler d1 export → import staging.`;

const CREATE = process.env.CREATE === '1';
const finnById = (identifier) => gql(`query($id: String!) { issue(id: $id) { id identifier url state { name } } }`, { id: identifier }).issue;

let main = null, block = null;
try { main = finnById('KLA-298'); } catch { main = null; }
try { block = finnById('KLA-299'); } catch { block = null; }

if (!main && CREATE) {
  const d = gql(`mutation($t: String!, $d: String!, $p: Int!) {
    issueCreate(input: { teamId: $t, title: "FINNBILGLASS OE/VIN Pinpoint — Fase 1–3 (resolver + dataimport)", description: $d, priority: $p }) {
      issue { id identifier url state { name } }
    }
  }`, { t: TEAM, d: mainDesc, p: 1 });
  main = d.issueCreate.issue;
}
if (main) console.log('Main:', main.identifier, main.url, `[${main.state.name}]`);

if (!block && CREATE) {
  const d2 = gql(`mutation($t: String!, $d: String!, $p: Int!) {
    issueCreate(input: { teamId: $t, title: "FINNBILGLASS B2B-token mangler (CF-konto 2266e975)", description: $d, priority: $p }) {
      issue { id identifier url state { name } }
    }
  }`, { t: TEAM, d: blockerDesc, p: 0 });
  block = d2.issueCreate.issue;
}
if (block) console.log('Blocker:', block.identifier, block.url, `[${block.state.name}]`);

// Flytt hovedsaken til In Progress (finn stateId)
const wf = gql(`query($t: ID!) { workflowStates(filter: { team: { id: { eq: $t } } }) { nodes { id name type } } }`, { t: TEAM });
const inProgress = wf.workflowStates.nodes.find((s) => s.type === 'started') ?? wf.workflowStates.nodes.find((s) => s.name === 'In Progress');
if (inProgress) {
  gql(`mutation($i: String!, $s: String!) { issueUpdate(id: $i, input: { stateId: $s }) { success } }`, { i: main.id, s: inProgress.id });
  console.log(`Flyttet ${main.identifier} → ${inProgress.name}`);
}
