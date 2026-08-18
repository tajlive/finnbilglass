# FINNBILGLASS C8.4 — EVIDENCE QUALITY SCORE

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** LEVERT i staging — ingen produksjonsendring, ingen deploy.

## Hva C8.4 løser

«Dere trenger ikke bygge en Knowledge Graph først. Dere trenger å gjøre sannhetslaget målbart.»

Før C8.4 visste systemet *data* (OE? montør? kunde? AI? katalog?) men ikke *kvalitet*. Nå får hver kandidat en deterministisk, forklarbar score som rangerer sannhet — fundamentet som gjør C10 verdifull.

## Arkitekturregel (låst)

```
Katalogdata  = forslag        (0 poeng, CLASS_D)
Evidence Ledger = sannhet     (eneste input)
Installation = validering     (korroborasjon / eliminering)
AI           = aldri sannhetskilde (0 poeng)
```

## Poengmodell (Tom, låst)

| Kilde | Poeng |
|---|---|
| OE-bilde bekreftet | +50 |
| Montørinstallasjon (≥1) | +40 |
| 5+ vellykkede installasjoner | +30 |
| Kunde bekreftet | +10 |
| Ekspert fysisk kontroll | +20 |
| **Maks** | **150** |
| Katalog | 0 |
| AI-gjetning | 0 |

Terskler: `≥130` HØY (EXACT-kvalifisert) · `≥50` MIDDELS (VERIFY) · `>0` LAV · `0` INGEN.

## Implementasjon

- `src/learning-v1/quality-score.ts` — ren deterministisk modul, ingen D1/I/O-avhengighet.
  - `evidenceQualityScore(events, fixtures, opts?)` → `{ score, maxScore, confidence, reasons[], evidenceCount, eliminated, eliminateReason }`
  - `explainQualityScore(result)` → `{ bekreftet[], manglende[], tekst }`
- Input er **kun** `evidence_events` + `installation_fixtures` (ledgeren). `glass_*` er projeksjon og aldri input. Katalog og AI er aldri poenggivende kilder.

## Regler implementert

1. **Ledger = eneste sannhetskilde** — kun events/fixtures teller.
2. **glass_* = projeksjon** — aldri input.
3. **Katalog = 0** — CLASS_D gir aldri poeng.
4. **AI = 0** — `createdBy='ai'` filtrert bort.
5. **WRONG_GLASS eliminerer** — negativ evidens er absolutt; score 0 + `eliminated=true`.
6. **Aldri redusere historisk evidens** — REJECTED teller ikke (og eliminerer ikke); append-only ledger garanterer monotont økende score.

## Nuanser (avgjørelser)

- **OE lest av kunde** (sourceType=CUSTOMER) gir **+10** (kunde-bekreftelse), ikke +50. Bare OE **med bilde** (sourceType=OE_IMAGE) gir +50. Én observasjon kan aldri dobbeltelles.
- **REJECTED WRONG_GLASS eliminerer ikke** — kun bekreftet negativ evidens er absolutt (livssyklus CAPTURED→VERIFIED respekteres).
- **Ekspert fysisk kontroll** leveres som eget flagg (`opts.expertPhysicalVerification`) — kilden finnes ennå ikke som `source_type` i ledgeren, og C8.4 legger ingen migrasjon.

## Tester (11/11)

| Test | Resultat |
|---|---|
| OE + montør + 5 installasjoner + kunde = 130/150 | ✅ |
| kun katalog = 0 | ✅ |
| AI-antakelse = 0 | ✅ |
| REJECTED teller ikke | ✅ |
| WRONG_GLASS eliminerer | ✅ |
| REJECTED WRONG_GLASS eliminerer ikke | ✅ |
| ekspert +20 → 150/150 | ✅ |
| monotonicity (score synker aldri) | ✅ |
| OE fra kunde = +10, ikke +50 | ✅ |
| explainQualityScore (✓/✗ + tekst) | ✅ |
| explainQualityScore på eliminert | ✅ |

`npx tsc --noEmit` = 0 feil · `npm test` (hele suiten) = grønn.

## explainQualityScore — kommersiell verdi

```
Evidence Quality Score: 130/150 (HØY)

Bekreftet:
✓ OE-bilde bekreftet — OE 7H0845101H bekreftet (bilde) (+50)
✓ Montørinstallasjon — 7 vellykkede installasjoner (+40)
✓ 5+ vellykkede installasjoner — 7 uavhengige montasjer (+30)
✓ Kunde bekreftet — CAMERA bekreftet av kunde (+10)

Manglende:
✗ Ekspert fysisk kontroll — ingen fysisk verifisering (+0)
```

Bedriftskunden ser *hvorfor* glass X er valgt — navngitt evidens, kilde og poeng. Audit-trail, ikke svart boks.

## Neste

**C10 Knowledge Graph Phase 1** (VW Transporter T5/T6) — grafen kan nå spørre «hvilket glass er mest sannsynlig riktig, og hvorfor?» med C8.4 som rangeringsmotor. `explainDecision()` løftes til graf-traversering, og C8.4-scoren blir grafen sin sannhetsrangering.
