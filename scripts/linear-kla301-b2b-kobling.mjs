#!/usr/bin/env node
/** KLA-301: autoglassgrossisten-koblingen — status 2026-08-13 kveld. */
import { execFileSync } from 'node:child_process';
const KEY = execFileSync('bash', ['-c', "grep '^LINEAR_API_KEY=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^LINEAR_API_KEY=//' | tr -d \"'\\\"\""], { encoding: 'utf8' }).trim();
const q = (query, variables) => {
  const r = execFileSync('curl', ['-s', '-X', 'POST', 'https://api.linear.app/graphql', '-H', 'Content-Type: application/json', '-H', `Authorization: ${KEY}`, '-d', JSON.stringify({ query, variables })], { encoding: 'utf8' });
  const d = JSON.parse(r);
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '));
  return d.data;
};
const body = `AUTOGLASSGROSSISTEN ER NÅ KOBLET SAMMEN MED FINNBILGLASS — automatisk B2B→B2C-datakjede:

ARKITEKTUR:
- Workflow A «fbg-sync-dump» (tajlive/autoglassgrossisten, søndag 06:30 CET + dispatch): dumper glass_catalog + glass_prisliste fra B2B-prod-D1 (glass-catalog-db) → GitHub-artifact «b2b-catalog-sync».
- Workflow B «sync-b2b.yml» (tajlive/finnbilglass, søndag 06:45 CET + dispatch): laster artifact (TAJLIVE_PAT-secret) → scripts/sync-b2b-import.mjs → idempotent INSERT OR IGNORE (batch 400) via CF D1 REST → finnbilglass-db-staging.
- Migrasjon 0006: UNIQUE(eurocode) på glass_catalog + UNIQUE(varenr,varenavn) på prisliste + ktype_matches-tabell.

KJØRT END-TO-END I DAG (målt):
- glass_catalog: 33 215 → 52 063 i staging (+18 848 nye B2B-koder) · prisliste 29 627 synket.
- ktype_matches: 0 (B2B har ingen slik tabell — ktype-data krever fortsatt TecDoc-anskaffelse).

ETTER-SYNC-VERIFISERING (200 GT-kjøretøy):
- correct_pinpoint 128 · wrong_pinpoint 0 · aggressiv 4 · verify_med_fasit 13 · verify_uten 55 · p95 571 ms. Fasit 2/2 grønne.

PITFALLS FIKSET UNDERVEIS: (1) jq må iterere results[] (ellers 1 gigantisk jsonl-linje), (2) ktype_matches finnes ikke i B2B (steg fjernet), (3) tom placeholder sync-b2b.yml (0 bytes) fylt, (4) env-token med anførselstegn ødelagt ved sed-strip — skript leser fil med regex.

NESTE: sync til PROD-D1 (finnbilglass-db) krever release-gate-review — staging-verifisering først.`;
const iss = q(`query($id: String!) { issue(id: $id) { id } }`, { id: 'KLA-301' }).issue;
const r = q(`mutation($i: String!, $b: String!) { commentCreate(input: { issueId: $i, body: $b }) { success } }`, { i: iss.id, b: body });
console.log(r.commentCreate.success ? 'KLA-301 OK' : 'FEIL');
