# FINNBILGLASS FINN VEHICLE INTELLIGENCE (C9.5 Phase 1)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Datamotor (ikke produkt) · Kun topp 3 (BMW 3-SERIE, NISSAN LEAF, TESLA MODEL-Y) — ikke bygget bredt. Ingen produksjonsendring.

## 1. DET STØRSTE FUNNET: slice(3)-buggen

`matchClassDCandidates` brukte `matchReason.split(' ').slice(3)` for å hente produksjonsintervallet — det forutsetter et generasjons-token (f.eks. «VW GOLF II 2003–2008»). Uten generasjon («BMW 3-SERIE 1983–1990», «NISSAN LEAF 2012–» — 3 ord) ble slice(3) en TOM array → **0 kandidater for alle år-spesifikke biler uten generasjons-hint**.

Det betyr at **LEAF, Model 3/Y, RAV4, Corolla, Passat og 1-serie hadde kandidater i gt-prislisten hele tiden** — matcheren blokkerte dem. Fiks: intervall-match på hele matchReason.

**Etter fiks (verifisert):**

| Bil | Kandidater før | Kandidater etter |
|---|---|---|
| NISSAN LEAF 2019 | 0 | **8** (6077LGN…, 6077RGN…) |
| TESLA MODEL Y 2023 | 0 | **6** (8103LGA…) |
| TOYOTA RAV4 2018 | 0 | **1** (5689AGNMV1B, 2013–) |
| VW PASSAT 2016 | 0 | **45** |
| TESLA MODEL 3 2021 | 0 | **6** (2018–2021) |
| BMW 118I 2017 | 0 | **16** (2004–) |

## 2. GLAVISTA-UNIONEN: moderne BMW 3 dekkes

gt-prislisten har kun BMW 3 1975–1992 (E21/E30/E36). **Glavista dekker F30**: «BMW 3ER 4T F30 + Kombi F31 2011–» → 6 frontruter (Windscreen) med OE 51 31 7 258 055/057/063/064/065/069 → eurokoder 2465AGS*. Lagt til som kandidatunion (klassifisert `CLASS_D_CATALOGUE_CANDIDATE` — Glavista beviser OE→glass, IKKE at bilen har OE).

## 3. DEKNING MÅLT (finn-annonser × SVV, topp 3)

| Familie | Annonser | Med kandidater | Snitt | Via Glavista |
|---|---|---|---|---|
| BMW 3-SERIE | 253 | **42 %** (var 0 %) | 24,1 | 25 % |
| TESLA MODEL-Y | 40 | **100 %** | 6,0 | — |
| NISSAN LEAF | 36 | **100 %** | 8,9 | 100 % |

Finn = markedssensor, aldri sannhet. Kandidater = forslag, aldri EXACT.

## 4. NY TOPP-10 (C8.2, med Glavista-union) — arbeidsstrømmen endret

```
 1. BMW 3-SERIE : 78 søk, 0 manuell — mangler encapsulated-evidens      → C8
 2. BMW 1-SERIE : 35 søk, 2 manuell                                      → C8 (+2 kandidatgap)
 3. NISSAN LEAF : 94 søk, 0 manuell                                      → C8
 4. TESLA MODEL-3: 72 søk, 0 manuell — mangler camera-evidens            → C8
 5. TESLA MODEL-Y: 50 søk, 0 manuell                                     → C8
 6. TOYOTA COROLLA: 76 søk, 0 manuell — mangler encapsulated            → C8
 7. TOYOTA RAV4 : 83 søk, 0 manuell — mangler heated                     → C8
 8. VW TRANSPORTER: 79 søk, 0 manuell — antenna/coated/encapsulated/rainSensor → C8
 9. VW PASSAT  : 44 søk, 0 manuell — mangler encapsulated/rainSensor     → C8
10. VW GOLF    : 111 søk, 0 manuell — mangler encapsulated/rainSensor    → C8
```

**Konsekvens:** kandidatgenerering er i praksis løst for Tier 1 (slice-fix + Glavista) — hele linja er nå **C8-evidenssamling**. Gjenstående kandidatgap: BMW 3 G20 (2019+), BMW 1-SERIE (2/35).

## 5. LEARNING OPPORTUNITY CONFIDENCE (fra arkitektreview)

`confidenceFor()`: HØY (≥300 obs eller ≥10 korroberte installasjoner) / MIDDELS (≥100 obs eller ≥3) / LAV («bare N observasjoner»). Hindrer overreaksjon på små datasett — eksponert i TOPP-rapporten med årsak.

## 6. TESTER

**4/4 C9.5** (slice-fix-regresjon, script-integritet topp 3, CLASS_D-klassifisering, C8.2-refleksjon) + **7/7 C8.2** (med confidence) + 10/10 C8.1 + 4/4 C9.2 + 7/7 C9 + 25/25 challenge + suite + TSC 0.

## 7. NESTE

- **C8-evidenssamling** for hele Tier 1 (Transporter/Golf/3-Serie/Leaf/Model-Y/RAV4/Corolla/Passat)
- G20-kandidatgenerering (BMW 3 2019+) — neste C9.5-trekk når det bestilles
- C10 Glass Knowledge Graph

**Ingen produksjonsendring. Staging-only. STOPP.**
