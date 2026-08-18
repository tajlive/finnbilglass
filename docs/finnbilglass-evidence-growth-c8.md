# FINNBILGLASS EVIDENCE GROWTH & CUSTOMER LEARNING PLATFORM (C8)

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** Staging-only, ingen prod-endring. TecDoc = fremtidig akselerator, ikke fundament.

## 1. ARKITEKTUR (Toms flyt, nå kodifisert)

```
SVV → Vehicle Identity → Application Candidates
        ├─ Supplier data (CLASS_D-kandidater) ─┐
        └─ Customer evidence (C8-observasjoner) ┴→ Evidence Resolver → Exact Glass → Konfigurasjon → Ordre
```

**Kunder som sensorer:** en vanlig leverandør kjøper data; FinnBilGlass bygger data gjennom ekte bruk. Over tid blir FinnBilGlass Fitment Database mer verdifull enn en generell katalog — norske biler, modeller, spørsmål, feilbestillinger, montørerfaringer.

## 2. LEVERTE MODULER

| Modul | Funksjon |
|---|---|
| `src/learning-v1/customer-evidence.ts` | **ObservationStore** — append-only kundeobservasjoner (rainSensor/camera/antenna/coated/heated/acoustic/OE), echo-bekreftede, personvern (kun hash), deterministisk feature-evidence |
| `src/learning-v1/installation-fixture.ts` | **InstallationFixtureStore** — montørbekreftede installasjoner: `INSTALLED_SUCCESSFULLY` (korroborasjon, ≥3 → høyeste autoritet `VERIFIED_REAL_WORLD_INSTALLATION`) og `WRONG_GLASS` (**negativ evidens som eliminerer kandidaten**) |
| `src/learning-v1/growth.ts` | **Growth Engine** — vekstplan: hvor mange installasjonsfixtures som trengs per familie for 50 % dekning, sortert etter kundemengde (Toms liste: Transporter/Golf/Passat/Tesla/BMW/Mercedes-varebil/Volvo) |
| `src/conversation-v1/evidence-capture.ts` | **AI-agenten som kunnskapsinnsamler** — koblet inn i api.ts på 3 punkter: OE skrevet (svak), feature-svar (echo-bekreftet), OE-bekreftet (høyeste kundeobservasjon) |

## 3. INNSAMLINGSFLYT (testet)

```
Kunde: «Jeg har regnsensor og antenne»
  → captureFeature (ECHO_CONFIRMED)          → evidens: rainSensor=true, antenna=true
Kunde: «7H0845101H» → AI: «Jeg leste 7H0845101H. Stemmer det?» → «Ja»
  → captureOeConfirmed (ECHO_CONFIRMED)      → evidens: oeMarking=7H0845101H
Montør: INSTALLED_SUCCESSFULLY (via ordre-status)
  → InstallationFixture                        → VERIFIED_REAL_WORLD_INSTALLATION (rank 90)
Montør: WRONG_GLASS
  → negativ evidens                            → kandidaten ELIMINERES (evidens eliminerer)
```

## 4. TESTER (5/5, + suite + TSC 0)

- **C8-1** observasjoner bygger deterministisk feature-evidence (aldri LLM-tolket)
- **C8-2** ≥3 uavhengige INSTALLED_SUCCESSFULLY → korroborert fixture
- **C8-3** **WRONG_GLASS eliminerer kandidaten** (4 feil vs 1 ok → eliminert)
- **C8-4** **læring ≠ automatisk sannhet** — fixtures starter CAPTURED, Tom-gjennomgang for VERIFIED
- **C8-5** vekstplan prioriterer der kundemengden er (LEAF 135 annonser først)

## 5. VEKSTPLAN (estimat: én korroborert fixture ≈ 8 biler dekket)

| Familie | SVV-biler | Annonser | Fixtures for 50 %-dekning |
|---|---|---|---|
| Nissan LEAF | 94 | 135 | 6 |
| VW Transporter | 79 | 89 | 5 |
| VW Golf | 102 | ~100 | 7 |
| Tesla Model 3/Y | 122 | 187 | 8 |
| Toyota RAV4 | 83 | 131 | 6 |
| BMW 3-serie | 86 | 133 | 6 |
| Volvo XC60 | 49 | 91 | 4 |

**«Gjør de mest solgte bilene ekstremt gode»:** ~42 korroberte installasjonsfixtures på 7 familier gir 50 % applikasjonsdekning — bygget av ekte kunder, ikke kjøpt.

## 6. PRINSIPP-OVERHOLD

- AI spør → kunden svarer → evidens bygges. **AI gjetter aldri** (C8-4 gate)
- Kun evidenskilder kan skape EXACT — fixtures styrker evidensgrafen, gaten avgjør
- WRONG_GLASS = negativ evidens → eliminering (C7-leksjonen videreført)
- Personvern: kun hash; ingen eierdata

## 7. NESTE (etter arkitekt-gjennomgang)

1. D1-persistens av observasjoner/fixtures (staging) — i dag in-memory
2. Ordre-status → automatisk fixture-registrering (`INSTALLED_SUCCESSFULLY`/`WRONG_GLASS` fra ordrestrømmen)
3. Tom-gjennomgangs-UI for PROVISIONAL → VERIFIED (C3 Teacher-mode-mønster)
4. TecDoc forblir akselerator-alternativ — ROI-listen fra C7.6 står klar

**Ingen produksjonsendring. Staging-only. STOPP.**
