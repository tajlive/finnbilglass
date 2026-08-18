# FINNBILGLASS EVIDENCE LEDGER PERSISTENCE (C8.1)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only (staging-D1 + staging-worker), ingen prod-endring. ✅

## 1. LEVERT (7 oppgaver fra spesifikasjonen)

| # | Oppgave | Status |
|---|---|---|
| 1 | ObservationStore fra memory → D1 | ✅ `D1EvidenceLedger` (append-only INSERT) |
| 2 | InstallationFixtureStore → D1 | ✅ `installation_fixtures`-tabell + upsert |
| 3 | Immutable `evidence_events`-tabell | ✅ migrasjon 0012 — ingen UPDATE/DELETE (testet) |
| 4 | `explainDecision()` | ✅ forklaringskjede: evidens (styrke-sortert) + installasjoner + beslutningsgrunnlag |
| 5 | Migration tests | ✅ C8.1-9 (alle Toms kolonner/verdier i SQL-en) |
| 6 | CAPTURED → VERIFIED-gate bevart | ✅ status-flyt i skjemaet + `læring ≠ sannhet` |
| 7 | Ingen auto-EXACT uten evidence gate | ✅ C8.1-6: UNKNOWN når evidens mangler |

## 2. LEDGERMODELLEN (Toms skjema, i D1)

`evidence_events`: id · vehicle_identity_hash (sha256, aldri rå regnr) · registration_hash · created_at · **source_type** (CUSTOMER/OE_IMAGE/INSTALLATION/MONTOR/SYSTEM) · **evidence_type** (CAMERA/RAIN_SENSOR/OE/ACOUSTIC/HEATED/...) · value · **confidence** (0–100) · **status** (CAPTURED/CONFIRMED/VERIFIED/REJECTED) · **created_by** (customer/installer/ai/system) — alle CHECK-begrenset.

`installation_fixtures`: fixture_id · vehicle · candidate_varenr · outcome (INSTALLED_SUCCESSFULLY/WRONG_GLASS) · installer · status-gate.

## 3. EVIDENCE DECAY (Toms eksempel, testet C8.1-7)

| Kilde | Styrke |
|---|---|
| Montør installert i går | 100 % |
| Montør installert for 5 år siden | 90 % (2 %/år lineært) |
| Kunde (echo-bekreftet) | 70 % |
| AI-antakelse | **0 % — aldri evidens** |

## 4. EVIDENCE MONOTONICITY RULE (fra arkitektreview, kodifisert + testet)

> «Når systemet får sterkere evidens: ny evidens > gammel usikkerhet — det skal aldri gå bakover og spørre om det samme igjen.»

`hasActiveEvidence()`: bekreftet evidens blokkerer nye spørsmål om samme feature; REJECTED blokkerer aldri (C8.1-8).

## 5. E2E-VERIFISERT I STAGING (ekte D1)

```
POST /api/assistant/message «SU18018» → «Fant bilen: VW Transporter T5 2005. Kan du lese OE-nummeret…?»
POST message «7H0845101H»            → «Jeg leste 7H0845101H. Stemmer det?»
POST identifier-confirmation (true)  → bekrefte
SELECT * FROM evidence_events        → OE 7H0845101H · CAPTURED → CONFIRMED · created_by=customer
                                       vehicle_identity_hash acf436c279ef… (sha256 — aldri rå regnr)
```

Append-only-kjeden CAPTURED → CONFIRMED er beviselig i staging-D1. Staging-worker: version 92b08aa7.

## 6. C9-KOBLING (selvforbedrende loop)

Benchmarken eksponerer nå `c8_kobling`: benchmark → MANUELL-årsaker (810 søk, alle «ingen kandidater») → C8-fixtures samles der → ny benchmark → **Coverage øker, Safety forblir 100 %**.

## 7. TESTER

**10/10 C8.1** (akseptkriteriene 1–5 + gate + decay + monotonicity + migrasjon + personvern) + 4/4 C9.2 + 24/24 conversation-v1 + 5/5 C8 + 7/7 C9 + 25/25 challenge + suite + TSC 0.

## 8. NESTE

- Ordre-status → automatisk fixture-registrering (INSTALLED_SUCCESSFULLY/WRONG_GLASS fra ordrestrømmen)
- Tom-gjennomgangs-UI for CAPTURED → VERIFIED (C3 Teacher-mønster)
- C9.5 Finn Vehicle Intelligence · C10 Glass Knowledge Graph

**Ingen produksjonsendring. Staging-only. STOPP.**
