# FINNBILGLASS EXPERT LEARNING SYSTEM v1

**Phase C3 — kontrollert læringssystem** · Dato: 2026-08-18 · Agent: Hermes (Implementation Agent)
Branch: `arch/conversational-assistant-staging-v1` · C2-commit (forutsetning): `29f2dd4dcee4214004a3ed8416e7e724a618e46d` · C3-commit: `dfff20224b7ae99e3f743501d319977e68cef985`
**Kjerne: LEARNING != AUTOMATIC TRUTH.** Ingen konversasjon eller LLM-output blir ACTIVE fitment-sannhet automatisk. Ingen prod-deploy. STOPP.

---

## 1. Status & grenser

| Krav | Status |
|---|---|
| Commit alle aksepterte C2-endringer FØR C3 | ✅ `29f2dd4` på feature-branch |
| Ingen merge til main | ✅ (kun feature-branch) |
| Ingen produksjonsdeploy | ✅ (C3 er 100 % offline/lokalt; Teacher-UI bygget men IKKE deployet) |
| ALLE tester grønne | ✅ 18/18 learning-v1 + full repo-suite exit 0 + tsc 0 |

## 2. Arkitektur

```
src/learning-v1/
  schema.ts                — 11 kunnskapsklasser, 7 livssyklus-stater, 10 autoritetsklasser,
                             scope, proveniens, KnowledgeItem/Candidate/Conflict/Outcome/GoldenFixture
  store.ts                 — KnowledgeStore: livssyklus-guarder, versjonering (supersedes),
                             scope-indeks, activeFitmentRules()
  teacher.ts               — Teacher Mode: undervisningshendelse → KnowledgeCandidate
  interview.ts             — Expert Interview Mode: 14 temaer → kandidater
  conversation-learning.ts — strukturerte læringssignaler + PII-anonymisering
  outcomes.ts              — utfallseviden + promotering + golden-pipeline
  retrieval.ts             — kontekst-filtrert henting med proveniens
  policy.ts                — konflikt-deteksjon, spørsmålsmetrikker, kandidat-oppdagelse,
                             fitment-policy-grense
  teacher-ui.ts            — STAGING-ONLY Teacher-grensesnitt (bygget, ikke deployet)
  samples/                 — 3 eksempel-hendelser (Tom-undervisning, konversasjon, feil glass)
tests/learning-v1.test.ts  — 18 deterministiske tester
```

## 3. Kunnskapsskjema (Knowledge Schema)

- **Klasser (11):** FITMENT_RULE, DOMAIN_KNOWLEDGE, CUSTOMER_SERVICE_GUIDANCE, QUESTION_GUIDANCE, PHOTO_GUIDANCE, CATALOGUE_SEMANTICS, TERMINOLOGY, INSTALLATION_KNOWLEDGE, PRODUCT_KNOWLEDGE, ORDERING_KNOWLEDGE, KNOWN_EXCEPTION.
- **Livssyklus (7):** CAPTURED → PROVISIONAL → REVIEWED → VERIFIED → ACTIVE (+ DEPRECATED/REJECTED). Overgangstabell håndhevet i kode; en revisjon starter alltid på PROVISIONAL igjen.
- **Scope (11 dimensjoner):** make, modelFamily, generation, productionInterval, market, body, engine, application, glassFamily, supplier, catalogueVersion. Retrival/aktivering filtrerer alltid på scope — en regel fra én bil kan aldri globaliseres (testet L5).
- **Proveniens:** origin, author, source, sourceReference, createdAt, reviewedBy, verifiedBy, verificationMethod, supersedes. Versjonering ødelegger aldri forrige versjon (testet L4).

## 4. Autoritetsmodell (10 nivåer)

VERIFIED_REAL_WORLD_INSTALLATION (90) > AUTHORITATIVE_OEM_DATA (80) > VERIFIED_EXPERT_RULE (70) > SUPPLIER_DATA (55) > EXPERT_TEACHING_PROVISIONAL (45) > CUSTOMER_OBSERVATION (35) > CUSTOMER_STATEMENT (20) > HEURISTIC (10) > LLM_INFERENCE (5).

- KUN FITMENT_RULE med autoritet ≥ VERIFIED_EXPERT_RULE **og** status VERIFIED→ACTIVE kan påvirke kandidat-eliminering (`mayInfluenceCandidateElimination()`).
- **LLM_INFERENCE kan aldri bli ACTIVE fitment-sannhet** — verken via overgang eller autoritet (testet L1/L2).
- Konversasjons-avledet FITMENT_RULE kan aldri starte som ACTIVE (guard i `assertLifecycleLegal`).

## 5. Teacher Mode (staging-only, for Tom)

`src/learning-v1/teacher.ts` + `teacher-ui.ts` (bygget, ikke deployet — aktiveres på staging-worker sammen med C2-assistenten):

- inspisere sesjon, korrigere agentsvar + forklare HVORFOR
- undervise terminologi/katalog-semantikk/identifikasjonsteknikk
- undervise bedre kundespørsmål, markere unntak (KNOWN_EXCEPTION), eksempel-/mot-eksempel-biler
- Hver hendelse → KnowledgeCandidate (PROVISIONAL) med teacher/timestamp/kilde/statement/reason/scope/examples/counterexamples/klasse/autoritet/status
- Prod-policy endres ALDRI umiddelbart (testet L3)

## 6. Expert Interview Workflow

`src/learning-v1/interview.ts`: 14 forhåndsdefinerte temaer (frontrute-terminologi, Eurokode-semantikk, leverandørkoder, kamera/sensor, belegg, varme, antenne, HUD, lister, ordrearbeidsflyt, kundemisforståelser, vanlige feil, montering, leverandørarbeidsflyt). Svar → teach() → KnowledgeCandidates (testet L17).

## 7. Konversasjons-læringspipeline

`conversation-learning.ts` — `extractLearningSignals(session)` utleder de 14 påkrevde signalene (questionsAsked/Answered, customerDidNotUnderstand, customerCorrections, agentCorrections, photosRequested, photoRetakes, manualHandoff, resolutionMethod, finalFitmentStatus, verificationMode, orderCreated, laterInstallationOutcome, turns). Råtranskript er ALDRI sannhet (testet L10).

## 8. Utfallslæringspipeline

`outcomes.ts` — utfallskjede: ORDER_CREATED → GLASS_DELIVERED → INSTALLER_CONFIRMED → INSTALLED_SUCCESSFULLY / WRONG_GLASS / RETURNED / FITMENT_CORRECTED.

- **INSTALLED_SUCCESSFULLY** kan promoteres til VERIFIED_REAL_WORLD_INSTALLATION (høyeste autoritet) — men **kun etter policy-validering** og alltid som VERIFIED (aldri automatisk ACTIVE) (testet L12).
- **WRONG_GLASS = kritisk negativt eksempel** — aldri positiv regel, kan aldri bli golden-fixture (testet L13).

## 9. Golden-Dataset-pipeline

`toGoldenFixture(outcome)` — reelt utfall → evidensgjennomgang → VERIFIED_REAL_WORLD_FITMENT → fixture (fx-<outcomeId>) → deterministisk regresjonstest (`tests/fitment-golden.test.ts`). Endrer ALDRI eksisterende fixture-forventninger automatisk (testet L14).

## 10. Retrival-arkitektur

`retrieval.ts` — filtrerer på kjøretøy/applikasjon/glassfamilie/spørsmålstype/kundeintensjon, skår 0–1, maxResults (default 8). Dumper ALDRI hele basen i LLM-kontekst. Proveniens returneres alltid med. `activeFitmentRulesFor()` er den eneste broen til kandidat-eliminering — scope-filtrert (testet L6/L5).

## 11. Fitment-grense (testet L7)

Hentet ekspert-prosa kan hjelpe agenten å forklare/tolke/spørre/veilede/klassifisere — men prosa er DOMAIN_KNOWLEDGE og `mayInfluenceCandidateElimination()===false`. Kun deterministisk policy kan sette EXACT/selectedGlass/verificationMode/orderable-eligibility; `applyPolicyDecision()` validerer struktur (selectedGlass kun ved EXACT).

## 12. Konflikt-håndtering (testet L8/L9)

Ny undervisning vs ACTIVE-kunnskap i overlappende scope → `KnowledgeConflict` (old/new, scopes, sources, authorities, examplesAffected, status OPEN) — **ALDRI overskriv**. Krever eksplisitt løsning (KEEP_OLD/ADOPT_NEW/REJECT_NEW av Tom).

## 13. Personvern (testet L11)

- Data-minimering: kundeidentifiserende data separeres fra gjenbrukbar domene-læring.
- `anonymize()`: telefon (+47…), kjennemerke (SU18018), epost → [telefon]/[kjennemerke]/[epost].
- `deriveReusableLearning()`: «Tom Hansen på +47… sa…» → «Kunder forveksler regnsensor og ADAS-kamera.»
- Rå lyd krever ikke varig lagring: separerte retensjons-policyer (rå lyd / transkript / strukturerte observasjoner / avledet læring) — designet i schema, ingen rå lyd lagres i læringslageret.

## 14. Automatisk kandidat-oppdagelse (testet L16)

`discoverySignals()` foreslår kandidater fra: gjentatte handoffs (≥3), gjentatte korreksjoner (≥3), gjentatte uavklarte spørsmål (≥3), feil-glass-returer (≥1), hyppig ukjent terminologi (≥3) — forblir CAPTURED/PROVISIONAL. Ingen automatisk aktivering.

## 15. Spørsmålsmetrikker (testet L15)

`computeQuestionMetrics()`: resolutionRate, customerConfusionRate, answerCorrectionRate, photoFallbackRate, manualHandoffRate, averageCandidateReduction, averageTurnsToResolution. Prioritet: **korrekthet > konvertering > hastighet** — metrikkene optimerer aldri kun hastighet.

## 16. Tester

`npm run test:learning-v1` — **18/18 grønne**: L1–L18 som beskrevet over (livssyklus/autoritet/teacher/proveniens/scope/retrieval/grense/konflikt/konversasjon/PII/utfall/golden/metrikker/oppdagelse/intervju/eksempler). Full repo-suite exit 0, tsc 0.

## 17. Eksempler (i `src/learning-v1/samples/`)

1. **sample-tom-teaching.json** — Tom underviser T5-antenne/regnsensor-regel (FITMENT_RULE, PROVISIONAL-kandidat, scope T5 2003–2015, eksempel + mot-eksempel).
2. **sample-conversation-learning.json** — SU18018-sesjon → strukturerte signaler + anonymiserte mønstre («Kunder forveksler regnsensor og ADAS-kamera»).
3. **sample-wrong-glass-learning.json** — 2525GY feil montert (kunden hadde regnsensor) → kritisk negativt eksempel + pipeline-aksjoner (ingen positiv regel).

## 18. Anbefalt UI (staging, bygget i `teacher-ui.ts`, ikke deployet)

Separate staging-sider for Tom: (1) sesjonsinspeksjon med korreksjonsknapp + «hvorfor»-felt, (2) undervisningsskjema med scope-velger og eksempel-/mot-eksempel-list, (3) intervjumodus (14 temaer), (4) kandidatliste med status/konfliktvarsel, (5) konflikt-løsningsskjerm. Aktiveres på staging-worker med C2-assistenten (env-gated) i en senere valideringsrunde.

## 19. Anbefalt neste fase

1. **C4: Teacher-UI på staging** (deploye teacher.ts + conversation-v1 sammen på `finnbilglass-frontrute-staging`) + Tom-kjørt intervju-runde 1 (camera/sensor-config + terminology) → første ekte KnowledgeCandidates.
2. **Tilkoble conversation-learning-pipeline** til C2-sesjons-API-et (persistér signaler per sesjon i staging-D1).
3. **Outcome-registrering** med Autoglass-samarbeidspartnerne (installatør-bekreftelser) → første VERIFIED_REAL_WORLD_INSTALLATION.
4. **Golden-fixture-vekst** + deterministisk regresjon mot fitment-v1 (aldri auto-overskriv).
5. Etter aksept: policy-integrasjon — ACTIVE FITMENT_RULE-er inn i fitment-v1 som scope-filtrerte kandidat-elimineringer, fortsatt under deterministisk gate.

## 20. STOPP

C3 levert på feature-branch. Ingen produksjonsdeploy, ingen merge, ingen prod-policy-endring.
