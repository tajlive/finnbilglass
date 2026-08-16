#!/usr/bin/env node
/** Oppdaterer KLA-301 (kjør-alt-status) og KLA-299 (ktype-faktum) 2026-08-13. */
import { execFileSync } from 'node:child_process';
const KEY = execFileSync('bash', ['-c', "grep '^LINEAR_API_KEY=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^LINEAR_API_KEY=//' | tr -d \"'\\\"\""], { encoding: 'utf8' }).trim();
const q = (query, variables) => {
  const r = execFileSync('curl', ['-s', '-X', 'POST', 'https://api.linear.app/graphql', '-H', 'Content-Type: application/json', '-H', `Authorization: ${KEY}`, '-d', JSON.stringify({ query, variables })], { encoding: 'utf8' });
  const d = JSON.parse(r);
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '));
  return d.data;
};
const poster = {
  'KLA-301': `«Kjør alt»-runde 2 (Hermes, 2026-08-13):

UTFØRT:
1. B2B/ktype-spor: CI-dump mot B2B-prod-D1 via repoets eget GH-secret (workflow dump-ktype-map.yml på main) → FAKTA: glass_catalog.ktype = NULL i ALLE 33 215 rader. Blokkeren er ikke tokenet — det er anskaffelse av TecDoc-ktype-data (data/tecdoc-mappings.json finnes ikke). Oppdatert KLA-299.
2. Canonical glass master SEEDET i staging: glass_master 32 091 · identifiers 63 799 · features 288 819 · vehicle_links 30 976 · source_katalog 4 kilder. Pipeline: harvester (33 215 records) → crosswalk → 17 sikre chunks → D1. Feil fikset underveis: ??/||-syntaksfeil i harvester (linje 170), FK på source_katalog (seedet), chunk-grenser (re-chunk på glass-grenser).
3. Kill switch (G6) BYGGET + TESTET: src/kill-switch.ts + migrasjon 0005 (feature_flags: resolver_all/resolver_pinpoint/l1/l2/l3/cv_model_*) + integrert i Worker (/api/frontrute) + 6/6 tester grønne. TSC grønn.
4. test-100 mot staging: correct_pinpoint 11 · wrong_pinpoint 0 · verify 77 · fallback 20 (110 biler, 2 api-feil). Falske PINPOINT: 0.
5. CV-modell VALGT: Cloudflare Workers AI uform-gen2-qwen-500m (docs/fase-5-cv-modellvalg.md) — ikke bygget.
6. Bilde-lisens: forespørselsdokument klart (docs/bilde-lisens-forespoersel.md) — sendes av Tom via Autoglass.
7. G7 rollback: prosedyre verifisert (docs/rollback-drill-g7.md); drill avventer 2. staging-deploy.
8. test-500 KJØRER i bakgrunn (finn.no-bredde + 1s delay + latency-måling).

ÅPENT: test-500-resultat, bilde-lisens-svar, TecDoc-anskaffelse, CV-POC.`,
  'KLA-299': `FAKTA-OPPDATERING (2026-08-13): B2B-tokenet er IKKE lenger blokkeren for ktype.

Verifisert via CI-dump (workflow dump-ktype-map.yml, kjørt med repoets eksisterende CLOUDFLARE_API_TOKEN-secret):
- glass-catalog-db (B2B-prod): glass_catalog.ktype = NULL i ALLE 33 215 rader (COUNT=0).
- data/tecdoc-mappings.json finnes IKKE i repoet — TecDoc-importen er aldri kjørt.

Konsekvens: L3 ktype forblir tom inntil (a) TecDoc kType-mappings anskaffes (tecdoc-import.yml er klar til å kjøre når filen finnes) ELLER (b) FinnBilGlass kjøper egen TecDoc VIS/VIN-tilgang. Token-veien alene gir ingenting mer.`,
};

(async () => {
  for (const [id, body] of Object.entries(poster)) {
    const iss = q(`query($id: String!) { issue(id: $id) { id } }`, { id }).issue;
    const r = q(`mutation($i: String!, $b: String!) { commentCreate(input: { issueId: $i, body: $b }) { success } }`, { i: iss.id, b: body });
    console.log(id, r.commentCreate.success ? 'OK' : 'FEIL');
  }
})();
