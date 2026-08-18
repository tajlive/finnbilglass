# FINNBILGLASS EVIDENCE ANALYTICS (C8.2)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Innsikt — ingen produksjonsendring. «Gjør læringen målbar, da vet C9.5 hvor den skal lete.» ✅

## 1. TOPP 10 LÆRINGSMULIGHETER (ekte data: SVV-korpus × finn.no-volum × kandidatgap)

```
 1. BMW 3-SERIE : 78 søk,  78 manuell — kandidatgenerering mangler        → C9.5
 2. BMW 1-SERIE : 35 søk,  35 manuell — kandidatgenerering mangler        → C9.5
 3. Nissan LEAF : 94 søk,  94 manuell — kandidatgenerering mangler        → C9.5
 4. Tesla MODEL-3: 72 søk, 72 manuell — kandidatgenerering mangler        → C9.5
 5. Tesla MODEL-Y: 50 søk, 50 manuell — kandidatgenerering mangler        → C9.5
 6. Toyota COROLLA: 76 søk, 76 manuell — kandidatgenerering mangler       → C9.5
 7. Toyota RAV4 : 83 søk,  83 manuell — kandidatgenerering mangler        → C9.5
 8. VW TRANSPORTER: 79 søk, 0 manuell — mangler antenna/coated/encapsulated/rainSensor-evidens → C8
 9. VW PASSAT  : 44 søk,  44 manuell — kandidatgenerering mangler         → C9.5
10. VW GOLF    : 111 søk,  0 manuell — mangler encapsulated/rainSensor-evidens    → C8
```

**Læringsscore = markedsvolum × manuell-gap × evidence-mangel.** To tydelige arbeidsstrømmer:
- **C9.5 (kandidatgenerering):** BMW 3/1-Serie, Leaf, Model 3/Y, Corolla, RAV4, Passat — ingen kandidater → C9.5 Finn Vehicle Intelligence bygger applikasjonskandidater
- **C8 (evidenssamling):** Transporter og Golf har kandidater, men skillende features uten lagret evidens → kundesamtale + installasjonsfixtures

Nøyaktig Toms eksempel-format: «VW Golf VII: 31 søk, mangler acoustic» → «VW GOLF: 111 søk, mangler encapsulated/rainSensor».

## 2. KOMPONENTER

| Modul | Funksjon |
|---|---|
| `src/learning-v1/analytics.ts` | Rent domene: `learningOpportunities()` — læringsscore, manglende features (harEvidens-filter), feilglass (WRONG_GLASS), verdifulle fixtures (≥3 korroberte), anbefaling (C8 vs C9.5) |
| `scripts/c82-evidence-analytics.mjs` | SVV-korpus → kandidatunion (kernel + CLASS_D) → rankQuestions → per-familie-aggregat × finn.no-volum (C7.6) → TOPP 10 + JSON |

## 3. LEARNING FLYWHEEL (koblet)

```
Benchmark → svakeste områder (C8.2) → samle fixtures (C8/C8.1) → Coverage øker → ny benchmark
```

Analytics er nå det som forteller **hvor** flywheelet skal gripe inn — og etter hvert som evidence_events akkumuleres i D1, leser `harEvidens` ekte lagret evidens (fixtures: feilglass + verdifulle installasjoner telles direkte).

## 4. TESTER

**5/5 C8.2** (score-rangering, harEvidens-filter, anbefaling C8-vs-C9.5, feilglass/verdifulle-fixtures, script-integritet) + 10/10 C8.1 + 4/4 C9.2 + 7/7 C9 + 25/25 challenge + suite + TSC 0.

## 5. NESTE

- **C9.5 Finn Vehicle Intelligence** — vet nå nøyaktig hvor den skal lete (BMW/Leaf/Tesla/RAV4/Passat-kandidatgenerering; Transporter/Golf-evidenssamling)
- C10 Glass Knowledge Graph

**Ingen produksjonsendring. Staging-only. STOPP.**
