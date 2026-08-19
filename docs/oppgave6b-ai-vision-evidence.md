# Oppgave 6b — Teknisk skisse: AI-vision som evidence-kilde

**Dato:** 2026-08-19 · **Status:** ANALYSEDOKUMENT til godkjenning — ingen kode
**Mal:** samme som oppgave 6-rapporten (bunnlinje → mekanisme → klassifisering → anbefaling)

---

## 0. Bunnlinje

**AI-vision (OCR av glassmerking + feature-detection) skrives inn i den eksisterende evidence-strukturen med `source='ai_vision'`, og kan KUN (a) redusere candidateCount ved å eliminere kandidater som motsier det observerte, eller (b) bekrefte/sette attributt-verdier som input til policyen. AI-vision kan ALDRI sette `approved` direkte — approved krever fortsatt approvalPolicy sine tre vilkår (1 kandidat + verifisert regel + ingen konflikt).**

Dette er en naturlig forlengelse av oppgave 3–4-strukturen (case_sku_decisions + evidence_events) — ingen ny arkitektur, ingen ny ekstern API.

## 1. Hva AI-vision kan observere (to evidensklasser)

| Klasse | Observasjon | Eksempel | Eksisterende bildetype |
|---|---|---|---|
| **OE-lesning** | OCR av glassmerking nederst i frontruten (E6-nummer/OE) | `7H0845101H` → Glavista-kobling → 2525GYA | `glass_marking` (ny, oppgave 3) |
| **Feature-detection** | Sensor/kamera bak speil, varmetråder, antenne, akustisk merking | «regnsensor til stede» / «ingen kamera-sone» | `mirror_sensor` + `windshield` |

Begge klassene produserer strukturerte påstander: `{attributt/oe, verdi, konfidens, bilde-ref}`.

## 2. Skrive-mekanisme (append-only, spores)

| Tabell | Rad | Felt |
|---|---|---|
| `evidence_events` | Én evidens-hendelse per påstand | `source_type='SYSTEM'`, `evidence_type` ∈ {OE, RAIN_SENSOR, CAMERA, ACOUSTIC, HEATED, ANTENNA}, `value`, `confidence 0–100`, `status='CAPTURED'` → `CONFIRMED` ved terskel, `created_by='ai'`, `notes='ai_vision model=… bilde=<r2_key>'` |
| `case_sku_decisions` | Én beslutnings-rad per sak (kun når visionen endrer utfallet) | `decision_type='ai_vision_observation'`, `sku` (hvis OE-kobling), `meta_json` med påstander + konfidens |

Kobling til sak: `case_id` + `vehicle_identity_hash` (samme append-only-prinsipp som manual_review — ingen UPDATE/DELETE).

## 3. Hvordan evidensen påvirker policy (og hvordan den ALDRI kan sette approved)

```
bilde → AI-vision → evidens-rad (source='ai_vision', conf, status)
        ↓
   [1] Berik kandidatenes attributes (kun der verdi er null — aldri overskriv katalogdata)
        ↓
   [2] Eliminér kandidater som MOTSIER observasjonen (f.eks. OE 7H0845101H → kun 2525GYA)
        ↓
   [3] approvalPolicy(candidateSkus, hasVerifiedCatalogRule, konflikter)
        → 'approved' KUN hvis: length===1 && hasVerifiedCatalogRule && ingen konflikt
```

**Sikkerhetsregler (harde):**
1. **`approved` krever fortsatt `hasVerifiedCatalogRule=true`** — en AI-vision-rad alene gir aldri dette. Kun når matchende override/GT-regel finnes i tillegg kan approved oppstå.
2. **Eliminering kun ved motsigelse** — AI-vision «ser ikke sensor» eliminerer IKKE en sensor-kandidat med mindre modellen eksplisitt detekterer fravær med konfidens ≥ terskel. Ukjent/utydelig → ingen effekt (konservativt, samme doktrine som null-attributter).
3. **Konfidens-terskel + status-gate**: påstander under terskel (foreslått: OCR ≥ 90, feature ≥ 80) får `status='CAPTURED'` og brukes IKKE i filtrering før `CONFIRMED`. Feil-lesninger kan dermed aldri eliminere riktig kandidat.
4. **Full sporbarhet**: hver påstand har bilde-ref (r2_key) + modell + konfidens — enhver beslutning kan etterprøves mot råbildet (samme audit-krav som explainDecision).
5. **Monotonicitet**: AI-vision spør aldri om evidens som allerede er bekreftet, og REJECTED-evidence blokkerer aldri (eksisterende C8.1-regel videreføres).

## 4. Klassifisering: kode vs prosess

| Steg | Type | Detalj |
|---|---|---|
| Evidens-skriving (endepunkt, normalisering, terskler) | **Kode (6a)** | Utvide `/api/evidence-capture` med AI-vision-behandling; ingen ny tabell (0022-strukturen dekker) |
| Policy-kobling (berik + eliminer i matcher steg 8b) | **Kode (6a)** | Samme mekanisme som glavista-attributter — kun ny evidens-kilde |
| Modellvalg (Workers AI vision) og terskel-kalibrering | **Prosess (6b)** | Tom velger modell + terskler; kalibreres på ekte bilder (kontrollsaker FBG-20260818-*) |
| Referansebank for merking (glass_marking finnes IKKE i evidence-capture ennå som treningsdata) | **Prosess (6b)** | Bygge manuelt gjennomgåtte eksempler → kvalitetsmåling av OCR |
| Operatør-gjennomgang av CONFIRMED-observasjoner (stikkprøver) | **Prosess (6b)** | Append-only audit, samme flyt som /ops/sku |

## 5. Effekt-analyse (forventet)

| Saksklasse | I dag (fasit-live) | Med AI-vision |
|---|---|---|
| OE-lesning på variantfeller (T5, Golf) | 2+ kandidater → needs_verification | OE 7H0845101H → 1 kandidat (2525GYA) → kan nå approved når override/GT finnes |
| Sensor/kamera-features (challenge C) | spørsmål til kunde | bilde-svar → bekreftet attributt → kandidat eliminert |
| Katalog-gap (180C, 685GU) | handoff | ingen effekt (vision krever kandidater å skille) — går via 6b-override |

**Målbart:** andel saker som får candidateCount redusert av `ai_vision`-evidens, eksponert i `rapport:dekning` som ny kolonne (approved-mekanisme = override/GT, evidens-kilde = ai_vision/manual_review).

## 6. Anbefaling

1. **6a (kode)** når Tom godkjenner: evidens-skriving + policy-kobling — liten, isolert utvidelse av oppgave 3–4-koden; alle harde regler videreført (approved umulig uten hasVerifiedCatalogRule).
2. **6b (prosess)** parallelt: modellvalg + terskler + referansebank (bygger på kontrollsakene fra Operations Center).
3. AI-vision er en **akselerator for bevisinnhenting**, ikke en ny autoritet — katalog foreslår, evidens bestemmer, installasjon lærer systemet.

*Skissen er analyse — ingen produktkode er endret i denne oppgaven.*
