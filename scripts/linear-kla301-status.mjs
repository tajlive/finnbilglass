#!/usr/bin/env node
/** Poster faktisk status på KLA-301..305 (Monster Catalog Harvester). */
import { execFileSync } from 'node:child_process';
const KEY = execFileSync('bash', ['-c', "grep '^LINEAR_API_KEY=' /Users/taj/klarpakke/.env.local | head -1 | sed 's/^LINEAR_API_KEY=//' | tr -d \"'\\\"\""], { encoding: 'utf8' }).trim();
const q = (query, variables) => {
  const r = execFileSync('curl', ['-s', '-X', 'POST', 'https://api.linear.app/graphql', '-H', 'Content-Type: application/json', '-H', `Authorization: ${KEY}`, '-d', JSON.stringify({ query, variables })], { encoding: 'utf8' });
  const d = JSON.parse(r);
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '));
  return d.data;
};
const kommentarer = {
  'KLA-301': `STATUS 2026-08-13 (Hermes, hovedsak):

BYGGET: evidence-fusion beslutningsmotor (src/evidence-fusion.ts, ENGINE_VERSION 1.0, signalvekter + hard stops + 4 utfall), crosswalk-pipeline (scripts/crosswalk-pipeline.mjs, idempotent/dry-run/checkpoint), migrasjon 0004 (8 versjonerte tabeller), kilde/lisensmatrise (docs/kilder-matrise.md), FASE 3-5-design (docs/faser-3-5-*.md), test-/release-plan (docs/test-og-release-plan.md).

TESTET (MÅLT): fusion 12/12 grønne, pipeline 5/5 grønne, tsc grønn, fasit staging 2/2 grønne (SU18018→PINPOINT 2525CSGY via L0; AJ95429→VERIFY 4 CLA-kandidater).

KORRIGERT MOT FAKTA: eurokode-format er 8-15 tegn i våre data (fasit 8579ACSGYAVZ1B=14), ikke 15/17 som spesifikasjonen sa — normalisering støtter 6-17 + minst 2 bokstaver.

BLOKKERE: bilde-lisens (0 % dekning — Buycarparts NO-GO), CV-modellvalg ikke besluttet, 500-bil-fasit ikke kjørt, B2B-token (KLA-299) for ktype.

EKSISTERENDE (parallell agent, ikke overskrevet): scripts/catalog-harvester.mjs + docs/catalog-harvester.md + migrasjon 0003 (vin_glass_overrides — nå i aktiv bruk i staging, fasit grønn via L0).

PRODUKSJONSSTATUS: INGEN produksjonspåstand — release-gater G1-G8 dokumentert, kun G4/G8 grønne så langt.`,
  'KLA-302': `STATUS 2026-08-13 (F1 — canonical glass master):

LEVERT: migrations/0004_canonical_glass_master.sql — 8 tabeller: source_katalog, glass_master, glass_identifiers, glass_features, glass_vehicle_links, glass_media, glass_evidence, resolution_audit. Versjonert (version+is_current), ikke-destruktiv (UNIQUE per versjon), provenance obligatorisk for eksterne data.

DEKKER: Eurocode (faktisk format 6-17 tegn — korrigert mot fasit), OEM/SUPPLIER/TRADE/GTIN/KTYPE/ARTICLE-identifikatorer, features separat fra identitet, ktype/build_codes/vin_pattern/årsintervall, LHD/RHD, marked, supersession, media med lisens+attribution+phash, evidens med input_hash+model_version, resolution_audit med signals_json.

TESTET: crosswalk-pipeline skriver kun mot dette skjemaet — 5/5 tester grønne (inkl. «samme eurocode flere leverandørnumre» og «ett OEM flere glass»).

NESTE: deploy migrasjon til staging-D1 + seed fra harvester-records via pipeline (--apply etter review).`,
  'KLA-303': `STATUS 2026-08-13 (F3 — evidence fusion):

LEVERT: src/evidence-fusion.ts — eksplisitt beslutningsmotor. Signalvekter: oem_build 1.0 > vin_ktype/ocr_eurocode 0.9 > ocr_oem 0.85 > feature_data 0.65 > image_feature 0.5 > visual 0.2. Hard stops: kamera/HUD/varme/regn-sensor motstrid → MANUAL_REVIEW. PINPOINT kun med høyvektsbevis + margin ≥0.3 + sellable. AI-bestemmelse alene → alltid VERIFY. Motstridende OCR-signaler → MANUAL_REVIEW. Ikke-salgbart → FALLBACK.

TESTET (MÅLT): 12/12 tester grønne (node --import tsx --test). tsc grønn.

IKKE GJORT: ikke koblet inn i Worker-runtime ennå — resolveren kjører L0-L4 direkte; fusion aktiveres når AI/CV-signaler (F5) finnes. Ingen ytelsestall målt.`,
  'KLA-304': `STATUS 2026-08-13 (F5 — AI/CV):

LEVERT: docs/faser-3-5-media-ai-kundebilder.md — komplett flertrinnsdesign (9 trinn): bildekvalitet → motiv → OCR → feature-deteksjon → geometri → punktsmatching → embedding-shortlist → kandidatsammenligning → evidensrapport. Designkrav: modell returnerer ALDRI varenummer, kun signaler (feature/verdi/confidence/bevisutsnitt/modellversjon/input-hash/forklaring/retning). EXIF-stripping, samtykke, slettetid, manuell fallback i kundeflyt.

IKKE BYGGET: ingen CV-kode, ingen modell valgt (Cloudflare Workers AI vs egen eksport — ikke besluttet), 0 % bilde-dekning (ingen lisens). Ingen AI-presisjonstall finnes — alt er design.`,
  'KLA-305': `STATUS 2026-08-13 (F6 — shadow mode + fasit):

LEVERT: docs/test-og-release-plan.md — 500-bil-testsett DESIGNET (balansert: VAG/Toyota/BMW/Mercedes/Volvo/Hyundai-Kia/PSA/Tesla-Polestar/varebil/el/eldre/import/ADAS/HUD/heated/acoustic/antenna/panorama), release-gates G1-G8 definert.

MÅLT: fasit 2/2 grønne på staging (SU18018 PINPOINT, AJ95429 VERIFY). Falske PINPOINT i kjent fasit: 0.

IKKE GJORT: 500-settet ikke kjørt, shadow mode ikke bygget, p95-latency ikke målt, rollback ikke drillet. G2/G3/G5/G6/G7 åpne.`,
};

(async () => {
  for (const [id, body] of Object.entries(kommentarer)) {
    const iss = q(`query($id: String!) { issue(id: $id) { id identifier } }`, { id }).issue;
    if (!iss) { console.log(id, '— finnes ikke, hoppet over'); continue; }
    const r = q(`mutation($i: String!, $b: String!) { commentCreate(input: { issueId: $i, body: $b }) { success } }`, { i: iss.id, b: body });
    console.log(id, r.commentCreate.success ? 'OK' : 'FEIL');
  }
})();
