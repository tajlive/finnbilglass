# FINNBILGLASS EXACT GLASS OPTIMIZATION ENGINE (C9)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. Mål: kjennemerke → én riktig frontrute med minst mulig friksjon.

## 1. QUESTION OPTIMIZER (ny: `src/fitment-v1/question-optimizer.ts`)

Tom-eksemplet er nå kodifisert og testet (C9-1):

| Glass | regnsensor | antenne |
|---|---|---|
| A | ✓ | ✓ |
| B | ✓ | — |
| C | — | — |

- **RainSensor spørres FØRST** — «nei» eliminerer A+B (potensial 2) vs antenne «nei» eliminerer A (potensial 1)
- **OE-ID prioriteres alltid øverst** når noen kandidat har OE (C9-3) — én lesning av merkingen kan erstatte flere spørsmål (C1: «prefer minimum reliable evidence»)
- Katalogfravær = null (ukjent) — elimineres aldri konservativt; spørsmål kan aldri eliminere «ukjente»
- `rankedEvidenceRequests` = optimal rekkefølge, brukes i stedet for `buildEvidenceRequests`

**Resultat:** «Har bilen en liten kameraenhet bak speilet?» — aldri «Velg mellom 15 frontruter».

## 2. 1000-KJENNEMERKESØK-MÅLING (`scripts/c9-accuracy.mjs`, 3 076-SVV-korpus, 1 000 søk)

| Utfall | Antall | % | Forklaring |
|---|---|---|---|
| **EXACT direkte** | 0 | 0 % | krever alltid OE/foto-evidens — katalog er aldri fasit |
| **Løst etter 1 spørsmål** | 3 | 0,3 % | Golf-caser der én feature eliminerer til én kandidat |
| **Løst etter foto/OE** | 187 | 18,7 % | kandidater finnes, OE-merking skiller — ett bilde |
| **Handoff** | 810 | 81 % | ingen kandidater i noen kilde |

Per familie (Tier 1): **Transporter 79/79 foto/OE** (kernel+Glavista-kandidater, rainSensor/antenne-skiller), **Golf 111: 3×1-spm, 108×foto/OE**, LEAF/RAV4/3-serie/Model-3/Xc60 = handoff (ingen kandidatdata ennå — C8-fixtures bygger dette).

## 3. ACCURACY GAIN × MARKET VOLUME (C7.6-kobling)

| Familie | Annonser | Status i dag | Optimeringseffekt |
|---|---|---|---|
| Transporter | 89 | foto/OE klar | **høyest ROI**: et bilde løser 79/79 |
| Golf | ~100 | 1-spm + foto | question optimizer gir 3 søk uten bilde |
| Passat | ~60 | handoff | kandidatdata mangler → C8-fixtures |
| Tesla/BMW/Leaf/RAV4 | ~500 | handoff | bygges via kundeobservasjoner |

## 4. FIRE EKTE DATAVALITETSFUNN (fiks i `catalogue-candidates.ts` + `application-resolver.ts` + `generation-registry.ts`)

1. **gt-prislisten inneholder tilbehør** (GU=gummilist, PY=pyntelist, K=klips-kit) — Golf VII 2016 ga 355 «kandidater» der de fleste var lister. **Fiks: ekskluder tilbehør + bak/side-ruter** → 23 ekte glasskandidater.
2. **Katalograd uten produksjonsintervall er ikke kandidat-evidence for en år-spesifikk bil** — ekskluderes nå (før: alle rader beholdt, år-filter meningsløst).
3. **gt-prislisten dekker ikke T5** (kun T4/eldre) — T5-kandidatene kommer fra kernel/Glavista. Kandidatunionen (kernel + CLASS_D) er nå målingen.
4. **SVV-uppercase vs register-tittelcase + CARAVELLE/MULTIVAN-aliaser** — CARAVELLE gav 0 applikasjoner (modellen inkluderer ikke «Transporter»). Fiks: alias-støtte i `matchesMakeModel`; T5/T6-aliaser lagt til.

## 5. TESTER

**4/4 C9** (maks-eliminering-rekkefølge, potensial desc, OE øverst, 1000-søk-integritet) + 25/25 challenge + 26/26 R1 + 5/5 C8 + 3/3 C76 + 3/3 C6 + conversation-v1 + suite + TSC 0.

## 6. KONKLUSJON

«Best possible guess uten å gjette» er nå målbart: **18,7 % av kjennemerkesøkene kan løses med ett bilde, 19 % med ett bilde eller ett spørsmål.** Neste trinn i Accuracy Roadmap: koble optimizeren inn i conversation-v1 (C2) slik at spørsmålene faktisk stilles i optimal rekkefølge, og la C8-fixtures bygge kandidatdata for handoff-familiene (LEAF/RAV4/3-serie).

**Ingen produksjonsendring. Staging-only. STOPP.**
