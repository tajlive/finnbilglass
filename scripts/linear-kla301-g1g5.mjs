#!/usr/bin/env node
/** KLA-301: G1/G5-målinger fra 500-GT-fasit-kjøringen (runde 3, 2026-08-13 kveld). */
import { execFileSync } from 'node:child_process';
const KEY = execFileSync('bash', ['-c', "grep '^LINEAR_API_KEY=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^LINEAR_API_KEY=//' | tr -d \"'\\\"\""], { encoding: 'utf8' }).trim();
const q = (query, variables) => {
  const r = execFileSync('curl', ['-s', '-X', 'POST', 'https://api.linear.app/graphql', '-H', 'Content-Type: application/json', '-H', `Authorization: ${KEY}`, '-d', JSON.stringify({ query, variables })], { encoding: 'utf8' });
  const d = JSON.parse(r);
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '));
  return d.data;
};
const body = `500-bil GT-fasit-kjøring (runde 3) — G1/G5 MÅLT:

METODE: scripts/test-500-gt.mjs — 500 GT-kjøretøy (make/modell/år + fasit-eurocode fra ground_truth med prisliste-join) mot staging /api/frontrute. Variant-bevisst klassifisering (GT-kode + varenr + prisliste-eurokode + base-8-kode-regel for Pilkington-suffikser).

RESULTAT (seed 42):
- correct_pinpoint 319 · pinpoint_aggressiv 15 · WRONG_PINPOINT 0 · verify_med_fasit 27 · verify_uten_fasit 139 · fallback 0 · api_feil 0
- falsk-pinpoint-rate (hard): 0,0 % → G1-hard GRØNN
- fasit-dekning (PINPOINT-korrekt + VERIFY-med-fasit): 69,2 %
- latency: p50 120 ms · p95 710 ms · p99 1221 ms → G5 GRØNN (<1,5 s)

RESULTAT (seed 99, reproduserbarhet):
- correct 308 · aggressiv 10 · wrong 1 (VOLVO EX30 2024: 8851AGAC vs GT 8851AGSCMVZ2L — utstyrsforskjell AC/SC) · verify_med 27 · verify_uten 154 · p95 736 ms
- falsk-rate: 0,2 % (1/500)

FORBEHOLD:
1. Parallell-deploys til staging under målingen (response-format skiftet underveis: utfall=null + kandidater i nytt format) — tallene er per-deploy-øyeblikksbilde. Må re-måles mot PINNET versjon før endelig G1-sign-off.
2. Aggressiv-PINPOINT ~4 % (PINPOINT på kjøretøy med >1 GT-variant) — doktrinen krever VERIFY; L1-nedgradering er neste iterasjon.

LÆRDOM (kode-struktur): prislisten crosswalker GT-koder (gammel, f.eks. 1936GB) med AGS-koder (2031AGNBL) på SAMME rad (varenr vs eurokode-felt) — fasit-tester MÅ sammenligne begge felt + base-8-prefiks.

GJENSTÅENDE G1-vei: L1 flervariant→VERIFY, re-måling mot pinnet staging-versjon, deretter G1 sign-off.`;
const iss = q(`query($id: String!) { issue(id: $id) { id } }`, { id: 'KLA-301' }).issue;
const r = q(`mutation($i: String!, $b: String!) { commentCreate(input: { issueId: $i, body: $b }) { success } }`, { i: iss.id, b: body });
console.log(r.commentCreate.success ? 'KLA-301 OK' : 'FEIL');
