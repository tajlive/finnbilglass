# FINNBILGLASS C10 — GLASS KNOWLEDGE GRAPH PHASE 1 (VW Transporter T5/T6)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** LEVERT i staging — ingen produksjonsendring, ingen deploy, ingen grafdatabase.

## Hva C10 Phase 1 er

En komplett **vertical slice** — ikke hele grafen, men én bevist kjede end-to-end:

```
SU18018
   ↓
VW Transporter T5 2005        (SVV-truth)
   ↓
Candidate glass               (katalog + Glavista)
   ↓
OE 7H0845101H                 (evidens)
   ↓
Evidence Ledger               (evidence_events + installation_fixtures)
   ↓
Quality Score 130/150         (C8.4)
   ↓
EXACT glass 2525GYA
   ↓
explainDecision()             (full beviskjede)
```

Målet er oppnådd: systemet svarer **«Dette er riktig frontrute, og her er hele beviskjeden.»**

## Arkitektur

**Ingen grafdatabase.** Traverseringen er en ren, deterministisk funksjon over eksisterende D1-relasjonstabeller — billig, enkelt, forklarbart, testbart.

- **Vehicle-node** → `GraphVehicle` (identityHash sha256, make/model/generation/år) + `glass_vehicle_links`.
- **Glass-node** → `GraphCandidate` (eurocode, varenr, features, OE-er) + `glass_master`/`glass_catalog`.
- **Evidence-node** → `evidence_events` (ledgeren) + `glass_evidence` (projeksjon).
- **Installation-node** → `installation_fixtures` (ledgeren) + `glass_vehicle_links` (projeksjon).

## Implementasjon

`src/learning-v1/knowledge-graph.ts` — rent domene, ingen I/O:

- **`traverseKnowledgeGraph({ vehicle, candidates, events, fixtures })`** → hele beviskjeden:
  ```
  { vehicle, fitmentStatus, selectedGlass, selectedVarenr,
    qualityScore, candidates[], eliminations[], explanation }
  ```
- **`materializeProjections(events, fixtures)`** → projiserer ledgeren til glass_*-noder (krav #4). glass_*-tabellene er **kun projeksjon** — ledgeren forblir eneste sannhetskilde.

## Beslutningslogikk (deterministisk)

1. **OE-observasjon** hentes fra ledgeren (bilde > kunde-lesning).
2. **Per kandidat:** C8.4-kvalitetsscore + eliminasjon.
3. **Eliminasjon:**
   - `WRONG_GLASS` → eliminerer kandidaten (negativ evidens er absolutt).
   - OE som matcher ett glass → eliminerer de andre («OE 7H0845101H matcher 2525GYA, ikke 2525GYM»).
4. **EXACT-beslutning (konservativ):**
   - Én gjenstående kandidat **med autoritativ evidens** (OE-bilde → score ≥ 50, ELLER ≥ 3 korroberte installasjoner) → **EXACT**.
   - Én kandidat **uten** autoritativ evidens → **UNKNOWN** (én kandidat ≠ bevis).
   - Flere gjenstående → **AMBIGUOUS**.

## Aksept-verifisert

```
Kjøretøy: VW Transporter T5 2005 (SU18018)
OE-observasjon: 7H0845101H (bilde)

Resultat: EXACT — 2525GYA

Evidence Quality Score: 130/150 (HØY)
Bekreftet:
✓ OE-bilde bekreftet — OE 7H0845101H (bilde) (+50)
✓ Montørinstallasjon — 7 vellykkede (+40)
✓ 5+ vellykkede installasjoner — 7 uavhengige montasjer (+30)
✓ Kunde bekreftet — CAMERA (+10)

Installasjonshistorikk: 7 vellykkede installasjon(er)

Eliminerte kandidater:
✗ 2525GYM — OE 7H0845101H matcher ikke dette glasset (matcher 2525GYA)
✗ 2525GY — OE 7H0845101H matcher ikke dette glasset (matcher 2525GYA)
```

## Tester (9/9)

| Akseptkrav | Test | Resultat |
|---|---|---|
| SU18018 + OE → EXACT 2525GYA, 130/150 | C10-1 | ✅ |
| samme resultat ved replay | C10-2 | ✅ |
| ingen evidens = aldri EXACT | C10-3, C10-4 | ✅ |
| WRONG_GLASS eliminerer | C10-5 | ✅ |
| append-only beholdes | C10-7 | ✅ |
| OE fra kunde gir +10 ikke +50 | C10-6 | ✅ |
| materialisering ledger → glass_* | C10-8 | ✅ |
| AI/REJECTED projiseres aldri | C10-9 | ✅ |

`npx tsc --noEmit` = 0 feil · `npm test` (hele suiten, inkl. C8.4) = grønn.

## Overgangen fra «smart søkemotor» til «forklarbar beslutningsmotor»

C10 er ikke en ny idé — den er **visualisering og traversering av sannheten som allerede er bygget**:

- **C7** resolver-grunnlag → **C8.1** ledger-persistens → **C8.4** kvalitetsscore → **C10** graf-traversering.
- Grafen kan nå svare «hvilket glass er mest sannsynlig riktig, og hvorfor?» — med navngitt evidens, kilde, poeng og eliminasjonsgrunn.

## Neste (ikke startet — venter på arkitekt)

- **C8.5 Evidence Normalization** (arkitektens anbefaling, ikke en stopper): `EvidenceNode { id, vehicleHash, glassId, source, type, confidence, timestamp, status }` — rene noder til grafen.
- **C10 Phase 2:** utvid vertikal slice til flere familier (LEAF, Golf, BMW 3) når C8-fixtures dekker dem.
- **explainDecision() i conversation-v1:** koble graf-traverseringen inn i AI-samtalen så kunden får beviskjeden direkte.
