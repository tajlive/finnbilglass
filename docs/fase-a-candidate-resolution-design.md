# Fase A — design: Deterministisk kandidat-reduksjon + human confirmation queue

Tom-godkjent retning (2026-08-19): systemet skal ALDRI sette CONFIRMED, godkjenne
SKU/fitment/ordre, eller gi AI/regelmotor beslutningsmyndighet. Systemet
registrerer kun at en sak har blitt redusert til én kandidat — mennesket bekrefter.

## 1. Dataskjema — migrasjon 0028 (append-only)

```sql
CREATE TABLE IF NOT EXISTS candidate_resolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,            -- 'crv-<caseId>-<n>'
  case_id TEXT NOT NULL REFERENCES evidence_cases(case_id),
  action TEXT NOT NULL DEFAULT 'deterministic_candidate_resolution',
  outcome TEXT NOT NULL CHECK (outcome IN (
    'READY_FOR_HUMAN_CONFIRMATION',         -- nøyaktig 1 kandidat igjen
    'STILL_MULTIPLE_CANDIDATES',            -- 2+ (logges for måling)
    'NO_CANDIDATES'                         -- 0 (feiltilstand, nulltoleranse)
  )),
  candidate_count_before INTEGER NOT NULL,
  candidate_count_after INTEGER NOT NULL,
  resolved_candidate_sku TEXT,              -- kun når outcome=READY_FOR_HUMAN_CONFIRMATION
  verified_catalog_rule_id TEXT,            -- regel-id som fjernet siste konkurrerende kandidat
  customer_evidence_ids_json TEXT NOT NULL DEFAULT '[]',  -- id-er på kundesvar som fjernet kandidater
  policy_version TEXT NOT NULL,             -- versjon av approval/policy.ts
  decision_authority TEXT NOT NULL DEFAULT 'NONE' CHECK (decision_authority = 'NONE'),
  actor TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crv_case ON candidate_resolution_events(case_id);
CREATE INDEX IF NOT EXISTS idx_crv_ready ON candidate_resolution_events(outcome, created_at);
```

- **Append-only:** ingen UPDATE/DELETE — nye hendelser legges til per sak (én per kundesvar-runde).
- **Nulltoleranse:** `candidate_count_after` kan aldri bli 0 i `READY_FOR_HUMAN_CONFIRMATION`
  (CHECK på hendelsenivå er ikke nok — koden MÅ kaste hvis reduksjonen gir 0; test dekker).
- **Kobling:** hendelsen knyttes til `evidence_cases` via `session_id`-match (kundesvar- og
  bilde-sesjon deler `sessionId`). Finner resolve-checken ingen sak, skrives ingen hendelse
  (ingen ops-sak å vise — målet er ops-arbeid).
- `resolved_candidate_sku` = varenr fra kandidatlista FØR reduksjon (aldri oppfunnet).

## 2. Statusdiagram

```
                     kundesvar (differensieringsspørsmål)
   NEW ──────────────────────────────► deterministisk resolve-check
   │                                           │
   │  (0/N kandidater fra katalogen)           ├── 1 kandidat → hendelse
   │                                           │   outcome=READY_FOR_HUMAN_CONFIRMATION
   │                                           │   (sakens status FORBLIR NEW/UNDER_REVIEW)
   │                                           │
   │                                           ├── 2+ kandidater → hendelse
   │                                           │   outcome=STILL_MULTIPLE_CANDIDATES
   │                                           │   (logges; sak forblir VERIFY-tilstand)
   │                                           └── 0 → hendelse NO_CANDIDATES + varsel
   ▼
   OPS: saker med siste hendelse = READY_FOR_HUMAN_CONFIRMATION vises ØVERST
   («Klar for menneskelig bekreftelse» + én kandidat + hvilke kundesvar/regler
    fjernet de andre — aldri «autogodkjent»-språk)

   ▼  kun token-autentisert operatør (supportAuthorised + append-only):
   ├── CONFIRMED        (evidence_cases.status + review_event m/ reason+actor+timestamp)
   ├── REJECTED         (samme)
   ├── NEEDS_CUSTOMER_INFO (samme)
   └── SKU-beslutning   (case_sku_decisions: approve_sku/choose_alternative_sku)

   SYSTEM KAN ALDRI: sette CONFIRMED, endre SKU/fitment/ordre, skrive uten
   decision_authority='NONE'. Alle skrivebaner er token-gated.
```

**Nøkkelregel:** `READY_FOR_HUMAN_CONFIRMATION` er en *hendelse*, ikke en status —
ops utleder «klar»-tilstanden fra siste hendelse + fravær av påfølgende
operatør-statusendring. `evidence_cases.status` endres kun av menneske.

## 3. Regresjonstestplan (nye tester, eksisterende 229 uendret)

`tests/candidate-resolution.test.mjs` (ny modul `src/candidate-resolution.ts`):

| # | Test | Forventning |
|---|---|---|
| T1 | Reduksjon til eksakt 1 kandidat | hendelse `READY_FOR_HUMAN_CONFIRMATION`, count_before>count_after, count_after=1 |
| T2 | **Nulltoleranse:** reduksjon som ville gi 0 | kaster; ingen hendelse skrives; count_after≥1 alltid |
| T3 | resolvedCandidateSku ∈ kandidatlista FØR reduksjon | alltid sann (aldri oppfunnet SKU) |
| T4 | Alle felter skrevet (action, outcome, counts, sku, ruleId, customerEvidenceIds, policyVersion, actor='system', decisionAuthority='NONE') | append-only rad, eksakt skjema |
| T5 | Append-only: to kundesvar-runder → to rader, ingen UPDATE | 2 rader med økende id |
| T6 | System kan aldri sette CONFIRMED | ingen kodebane uten supportAuthorised; regresjonstest: kall uten token → 401 |
| T7 | Ops-visning: READY-sak øverst med «Klar for menneskelig bekreftelse», kandidat + fjerningsgrunnlag, ingen «autogodkjent»-tekst | /api/ops/ai-observasjoner sorterer + merker |
| T8 | Operatør-overstyring: CONFIRMED/REJECTED/NEEDS_CUSTOMER_INFO med reason+actor+timestamp | append-only status_events; sak forsvinner fra «klar»-køen |
| T9 | STILL_MULTIPLE_CANDIDATES logges (effektmåling) | hendelse med count_after≥2 |
| T10 | policyVersion-pinning: hendelse skrevet med versjon som matcher approval/policy.ts | lik strings |
| T11 | Fitment-golden/challenge + fasit-integritet uendret | 229/229 + nye grønne |
| T12 | Målings-aggregater (andel READY, overstyringsrate) | query-skjema verifisert |

**Effektmåling (fase A-krav):** ops-API får aggregat-endepunkt som rapporterer
andel VERIFY→READY, median behandlingstid (opprettet→CONFIRMED), overstyringsrate
(READY→REJECTED/NEEDS_INFO), og årsaksfordeling for STILL_MULTIPLE_CANDIDATES.

## 4. Kodeplassering

| Fil | Rolle |
|---|---|
| `migrations/0028_candidate_resolution_events.sql` | DDL ovenfor |
| `src/candidate-resolution.ts` | resolve-check (deterministisk, ingen AI) + hendelse-skriving + validering |
| `src/index.ts` | koble inn i kundesvar-/resolver-flyten (sessionId→caseId), ops-query (øverst + merking), aggregat-endepunkt |
| `src/ops-center-ui.ts` | «Klar for menneskelig bekreftelse»-kort (ingen autogodkjent-språk) |
| `tests/candidate-resolution.test.mjs` | T1–T12 |

## 5. Fase D (CI-gate) — design

`deploy.yml` får jobb `self-test-50-staging-gate` som kjører
`npm run selftest:50:staging` **etter staging-deploy, før prod-deploy-jobben**;
exit≠0 stopper prod-deploy; `resultat.json`/`rapport.md` lastes opp som
CI-artefakter; testen nekter production som default (guard). Ikke per commit,
ingen daglig cron ennå (vurderes etter 3–5 releaser + målt SVV/R2-kostnad).

---

**Godkjenn dette designet (dataskjema + statusdiagram + testplan) — eller be om
endringer — før jeg skriver noen kodeendringer.** Implementering skjer deretter
i rekkefølge: 0028 → candidate-resolution.ts → index.ts → ops-center-ui → tester.
