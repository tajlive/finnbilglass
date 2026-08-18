# FINNBILGLASS CONVERSATION INTELLIGENCE INTEGRATION (C9.2)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. Koble motoren inn — ikke mer benchmark. ✅

## 1. Question Intelligence nå i samtalen (`tools.ts getNextQuestion`)

Spørsmålene AI-agenten stiller er nå sortert etter **Question Value = eliminering × feilkostnad × svarbarhet**:

- **Før (C9.1):** motoren finnes, samtalen bruker fast rekkefølge (rainSensor → camera → antenna → coated → heated → acoustic → OE **sist**)
- **Etter (C9.2):** samtalen stiller spørsmålet med høyest Question Value først; **OE-ID øverst når kandidatene har OE** (Evidence Priority 1 — én lesning av merkingen erstatter flere spørsmål)

## 2. Verifisert flyt — SU18018 (ekte kandidater)

```
Kunde: «Jeg trenger frontrute» (SU18018)
AI:    «Fant bilen: VW Transporter T5 2005 (SU18018).
        Kan du lese OE-nummeret på kanten av den eksisterende frontruten?»   ← ETT spørsmål
```

Ikke «velg mellom 12 frontruter» — nøyaktig den flyten Tom spesifiserte.

## 3. Regresjonsfunn fikset underveis (test 17)

**OE-spørsmålet ble stilt på nytt etter at kunden allerede ga OE** (1176700500 → 2 kandidater → acoustic-skill nødvendig). Fiks: bekreftet OE-identifikator fjerner OE-spørsmålet fra køen — agenten skiller da på acoustic. Dobbeltspørsmål er friksjon, og friksjon er det vi optimaliserer bort.

## 4. KPI-oppdatering (Toms presisering)

`accuracy_score` er erstattet med to KPI-er i benchmarken (C9.1-3-test):

| KPI | Nå | Mål |
|---|---|---|
| **Safety Accuracy** | **100 %** | aldri feilbestilling — forblir 100 % |
| **Coverage Accuracy** | **19,0 %** | øker via C8-data (fixtures → EXACT_UTEN_SPORSMAL) |

Markedsspørsmålet «kan dere faktisk finne riktig glass?» besvares av Coverage; Safety forteller at vi aldri tar sjansen.

## 5. TESTER

**4/4 C9.2** (Question Value-rekkefølge i samtale, OE øverst med OE-data, OE sist uten, én-opplysning-flyt) + **24/24 conversation-v1** (regresjon grønn etter OE-dedupe-fiks) + 7/7 C9/C9.1 + 25/25 challenge + 26/26 R1 + suite + TSC 0.

## 6. ROADMAP-STATUS

- ✅ C9.1 Evidence Benchmark — **arkitekt-godkjent gate**
- ✅ **C9.2 Conversation Intelligence Integration** — LEVERT
- ⏭ C8.1 D1-persistens (ekte læringsdatabase — observasjoner/fixtures i D1)
- ⏭ C9.5 Finn Vehicle Intelligence (annonse → SVV → kunnskapsgraf → prioriterte C8-fixtures)
- ⏭ C10 Glass Knowledge Graph

**Ingen produksjonsendring. Staging-only. STOPP.**
