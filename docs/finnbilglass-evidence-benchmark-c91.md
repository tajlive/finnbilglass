# FINNBILGLASS EVIDENCE DRIVEN ACCURACY BENCHMARK (C9.1)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Benchmark — ingen prod-endring. «Ikke mer kode først. Lag benchmark.» ✅

## 1. QUESTION INTELLIGENCE ENGINE (utvidet i `question-optimizer.ts`)

**Question Value = kandidater eliminert × feilkostnad unngått × kundens sannsynlighet for å svare**

| Spørsmål | Eliminerer | Feilkostnad | Svarbarhet | **Value** |
|---|---|---|---|---|
| «Har bilen kamera bak speilet?» | 8/10 | 1,0 (ADAS-kalibrering) | 0,95 (kunden ser den) | **7,6** |
| «Har bilen HUD?» | 3/10 | 0,5 | 0,5 (sjelden kjent) | **0,75** |

Testet (C9.1-1/2): kamera stilles alltid først — selv ved lik eliminering vinner høy svarbarhet (kamera 0,95 > coated 0,4). AI spør «bare om kamera fordi det skiller de to frontrutene» — føles intelligent for kunden.

## 2. EVIDENCE PRIORITY (kodifisert)

1. **OE-bilde på frontrute** — slår alt (én merking: 43R-001234 / 8579AGSGYAVZ1B)
2. Montør installert tidligere (C8-fixtures)
3. Kunde bekreftet funksjoner
4. AI-spørsmål (optimal rekkefølge)
5. Katalogkandidat (CLASS_D — foreslår, beviser aldri)

## 3. BENCHMARK: 1000 KJENNEMERKER (5 utfallsklasser)

| Klasse | Antall | % |
|---|---|---|
| 1. EXACT uten spørsmål | 0 | 0 % |
| 2. EXACT etter ett AI-spørsmål | 3 | 0,3 % |
| 3. EXACT etter bilde/OE | 187 | 18,7 % |
| 4. Manuell behandling | 810 | 81 % |
| **5. Feilbestilling** | **0** | **0 %** |

## 4. METRIKKER

| Metrikk | Verdi | Betydning |
|---|---|---|
| **accuracy_score** | **100** | 0 feilbestillinger av 1000 — «jeg vet ikke» er aldri straffet |
| questions_per_solution | 0,02 | nesten ingen spørsmål nødvendig |
| customer_friction | 1,0 | én handling (bilde) per løst ordre |
| **wrong_glass_risk** | **17,2 %** | hvis systemet MÅTTE gjette på kandidatgruppene: 17,2 % bom — det er verdien av å si «jeg vet ikke» |

**Tolking:** 17,2 % wrong_glass_risk er nøyaktig hvor mange feilbestillinger (retur + frakt + montørtid + kundeirritasjon) vi unngår per 1000 søk ved å be om evidens i stedet for å gjette. Transporter: 79/79 søk løses med ett bilde.

## 5. TESTER

**7/7 C9/C9.1** (inkl. kamera-vs-HUD Question Value, svarbarhet-straff, 5-klasse-benchmark-integritet) + 25/25 challenge + 26/26 R1 + 5/5 C8 + 3/3 C76 + 3/3 C6 + suite + TSC 0.

## 6. NESTE (etter arkitekt-gjennomgang)

1. Koble Question Intelligence inn i conversation-v1 (spørsmål stilles i questionValue-rekkefølge)
2. Benchmarken gjøres om til CI-gate (test:benchmark) — hver datakilde-endring måles før/etter
3. C8-fixtures reduserer MANUELL-klassen; målet er EXACT_UTEN_SPORSMAL > 0 via installasjonsdata
4. C9.5 Finn Vehicle Intelligence (annonse → SVV → kunnskapsgraf) når C9.1 er godkjent

**Ingen produksjonsendring. Staging-only. STOPP.**
