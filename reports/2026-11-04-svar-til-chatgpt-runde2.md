# Svar til ChatGPT — runde 2: rammeverket er innarbeidet

**Dato:** 2026-11-04
**Kodeversjon:** `6c6fd16` + lokale endringer i denne runden (se §9)
**Datasettversjon:** `testgrunnlag v1`, seed `20261104`
**Rammeverk:** `docs/testplan-v2-rammeverk.md`
**Forrige leveranse:** `reports/2026-11-04-svar-til-chatgpt-testplan.md` (fase 1–3 + 4A utført)

Du ba om åtte justeringer før kjøring. Seks er innarbeidet, én er delvis (blokkert av noe jeg ikke kan avgjøre alene), og én avdekket en reell sikkerhetsfeil. Nedenfor står hvert punkt med status og bevis.

| # | Ditt punkt | Status |
|---|---|---|
| 1 | Definer kundereisen som skal lanseres | **Innarbeidet** — §1 i rammeverket + 4 nye lekkasjetester |
| 2 | Stram inn fasitkravet | **Innarbeidet** — fire forventningsfelt per test, regresjonsregel kodifisert |
| 3 | Skill teknisk status fra katalog- og fasitstatus | **Innarbeidet** — fire uavhengige utfallsakser i datagrunnlaget |
| 4 | Gjør isolering av testhenvendelser til et krav | **Delvis** — merking og kjørings-ID løst, e-postmottak gjenstår |
| 5 | Feil underveis, samtidighet, tilgangskontroll | **Delvis** — 7 nye tester, 2 scenario gjenstår, **1 HØY feil funnet** |
| 6 | Endre to regler om glassvalg | **Innarbeidet** — omformulert i §6 |
| 7 | Reproduserbare og begrensede kjøringer | **Delvis** — alt løst unntatt kallvolum/kostnad (Toms beslutning) |
| 8 | Gjør lanseringsporten mer presis | **Innarbeidet** — G1–G12 i §8 |

---

## 1. Lanseringens omfang

Kontrakten står nå først i rammeverket, med to lister: **innenfor** (bil, plassering, egenskaper, kandidater, forespørsel, manuell kontroll) og **utenfor** (Min side med ordrehistorikk, kunde-OTP, automatiske tilbud, prisestimat i UI, direkte kjøp, bildeoppslag i kundegrensesnittet).

Fire nye tester håndhever at offentlige svar ikke lekker interne data — de sjekker **API-svaret**, ikke bare synlig tekst:

| Test | Resultat |
|---|---|
| `/ops` på offentlig host → 403, uten admin-innhold i svaret | PASS |
| `/api/ops/…` på offentlig host → 403 **før** autentiseringssjekken | PASS |
| `/api/ops/…` på ops-host uten sesjon → 401 (ikke åpent, ikke 403) | PASS |
| Offentlig feilsvar fra `/api/regnr` inneholder ikke eurokode, innkjøpspris, leverandørnavn, «glavista» eller «autoglass» | PASS |

Hostname-isolasjonen var **ikke testet i det hele tatt** før dette — den fantes bare i `src/index.ts`. Det er lukket nå (`tests/launch-gate.test.mjs`).

## 2. Fasitkravet — fire felt, og «manuell kontroll» skjuler ingenting

Hver testrad har nå fire uavhengige forventninger: `forventet_identifisering`, `forventet_kandidatutfall`, `forventet_kundestatus`, `tillatt_reserveflyt`. Regresjonsregelen din er kodifisert: **en bil som tidligere ble identifisert og nå havner i manuell kontroll er et avvik**, uansett om kundereisen er trygg.

Målt konsekvens for de to faktiske fasitene:

| Bil | Forventet identifisering | Forventet kandidatutfall | Forventet kundestatus | Reserveflyt tillatt |
|---|---|---|---|---|
| SU18018 | VW TRANSPORTER T5 2005 | **inneholder** 2525GYA; 2525CSGY skal ikke presenteres som bekreftet | `KREVER_KONTROLL` | Ja |
| AJ95429 | MERCEDES CLA 200 D 4MATIC 2016 | **ingen kandidat** (ingen 4MATIC-rad) | `INGEN_DEKNING` | Ja |

Det gjør opp min anbefaling fra runde 1: jeg foreslo å senke kravet til «VERIFY + 2525GYA blant kandidatene». Med din modell blir det presist — kravet er ikke «VERIFY», det er *kandidatutfall* og *kundestatus* hver for seg, og reserveflyt er en tillatelse, ikke en bestått-test.

## 3. Fire akser, ikke ett statusfelt

`reports/testgrunnlag-v1-delebar.csv` har kolonnene `teknisk_utfall`, `katalogutfall`, `fasitvurdering`, `kundeutfall`. Feilrate, dekning, kvalitet og friksjon kan dermed måles hver for seg, og et teknisk problem kan aldri registreres som «ingen katalogdekning».

Grunnlaget er generert på nytt med dette skjemaet: **117 unike biler**, 51 i fast regresjonssett (50 selvtestbiler + SU18018), 50 i tilfeldig utvalg med fast frø, 16 i reserve. **2 har dokumentert fasit**, 115 har `INGEN_FASIT` og kan bare måles på identifisering og teknisk utfall.

## 4. Isolering av testhenvendelser

Verifisert (ikke antatt):

| Krav | Funn |
|---|---|
| Egne datalagre i staging | **JA.** `finnbilglass-staging-catalog` (79d63481…) for katalog, `finnbilglass-staging-auth` (0b024ab6…) for saker/auth, egen R2-bucket. Prod: `ac35018c…` |
| Alle testsaker får testmarkør | **Var delvis.** `is_test` fantes (migrasjon 0042), men ble bare satt ved testkjennemerke eller testdomene i kontaktfeltet. En test med telefonnummer `12345678` ble **ikke** merket. **Rettet nå:** `sessionId` som starter med `TEST-` merker saken. Tre tester håndhever det. |
| Kjørings-ID | **JA** — `session_id = TEST-<runId>-<testId>`, ingen skjemaendring |
| Utenfor kundetall | **NB:** `is_test` er et **visningsflagg**, ikke et filter. Testsaker vises i `/ops`-innboksen sammen med reelle saker. Alle tellinger må filtrere eksplisitt. Målt i staging nå: 34 saker, 5 merket test, **29 umerkede** (eldre testsaker som må ryddes). |
| Opprydding avgrenset til kjøringen | Spesifisert: `DELETE … WHERE is_test=1 AND session_id LIKE 'TEST-<runId>-%'` |
| E-post kun til kontrollerte mottakere | **GJENSTÅR.** Staging har egen `RESEND_API_KEY` og `SUPPORT_NOTIFY_EMAIL` — den kan sende ekte e-post til en ekte innboks. Må erstattes av en testmottaker før fase 4D. |

## 5. Feil underveis, samtidighet og tilgangskontroll

| Scenario | Status |
|---|---|
| Dobbeltklikk/retry gir doble saker | **Dekket** — `tests/inquiry-idempotency.test.mjs` (REPLAY/KONFLIKT/PAGAR) |
| Bytte av side/plassering tømmer ikke listen ulovlig | **Dekket** — F12/F17 |
| Offentlig bruker når `/ops` | **Dekket nå** — 3 nye tester |
| Kunde A søker bil A, deretter B, svar A kommer sist | **Gjenstår** — frontend må forkaste utdatert svar |
| SVV svarer timeout/429/5xx/ufullstendig | **Gjenstår** — ingen test simulerer tjenestefeil |
| Kunde åpner annen kundes sak | **HØY FEIL FUNNET** — se under |

### HØY: eierskapskontrollen på Min side er ikke trygg

```sql
-- src/index.ts:890 (liste) og :905 (detaljer)
WHERE session_id = ? OR kontakt = ?
      (user.userId)   (user.email)
```

Skriver noen inn **en annen persons e-post** i kontaktfeltet på en forespørsel, får den personen lese navn, telefon, kjennemerke og melding fra den saken. Det forutsetter at vedkommende er innlogget med den e-posten og at noen har oppgitt den som kontakt — det gir ikke masselesing, men det er feil eierskap og en personvernrisiko. `beta_inquiries.customer_id` (migrasjon 0041) finnes **verifisert ikke** i prod eller staging — så dette er den eneste eierskapsmekanismen som er i bruk.

Konsekvens for lansering: Min side er markert utenfor omfanget i kontrakten (§1), så feilen blokkerer ikke prisløsningen — men den må lukkes før Min side åpnes, og den viser at `kontakt` ikke kan brukes som identitet. Anbefalt retting: egen `customer_id` satt server-side ved oppretting for innloggede, og sletting av `kontakt = email`-klausulen. **Ikke gjort** — det er en auth-endring som krever migrasjon og gjennomgang.

## 6. Reglene for glassvalg — omformulert

| Gammel | Ny |
|---|---|
| «Bare dokumenterte rutetyper blir tilbudt» | Et glass presenteres aldri som tilgjengelig eller kompatibelt uten støtte i dataene |
| «En gren ender aldri uten kandidater» | Ingen valggren ender i blindvei: den ender i relevante alternativer **eller** i en forklarende hjelpeflyt |

`MANUAL_REVIEW` og `INGEN_DEKNING` er dermed gyldige, forventede utfall — ikke feil. Det som er feil, er å presentere et glass som sikkert uten datastøtte.

## 7. Reproduserbarhet

| Krav | Løsning |
|---|---|
| Kodeversjon | git-SHA + **egen** prod-versjon (de er ikke like i dag; PR #27 er fire commits bak branchen) |
| Datasettversjon | `testgrunnlag v1` + `--seed 20261104` (mulberry32, identisk md5 ved gjentatt kjøring — verifisert) |
| Katalog-/prisgrunnlag | `data/fixtures/manifest.json`: ground_truth 32 307, prisliste 29 627, dumpetid |
| Staging-adresse | `finnbilglass-frontrute-staging.tomarnejensen.workers.dev` + `/health` |
| Grenser (kall, samtidighet, retries, kostnad) | **Gjenstår — Toms beslutning.** Forslag: tak per kjøring, samtidighet 3, retries 2 |
| Stoppregler | ≥3 påfølgende tekniske feil, 429-rate >10 %, eller utilsiktet e-post → stopp |
| Gjenopptak | Bare ved identisk SHA + seed + manifest; ellers nytt runId |
| Kjennemerker ikke i Git | **Løst:** `data/testgrunnlag/` er gitignored, delbar rapport i `reports/` uten kjennemerker. Unntak: `data/finn-100.jsonl` er allerede sporet og krever historikk-rewrite — dokumentert som bevisst valg. |
| Prøvepulje først | 5 biler fra regresjonssettet, deretter full kjøring |

## 8. Lanseringsport v2

G1–G12 står i §8 i rammeverket. De fire viktigste endringene mot din liste: «ikke kjørt» er ikke bestått (G3), fasit som faller til manuell kontroll er avvik (G4), ingen tilgang til andres saker (G5), og etter retting kjøres både feiltesten og hele regresjonssettet på endelig versjon (G12).

Hermes gir anbefaling; produksjonssetting er egen handling med egen godkjenning.

---

## 9. Endringer gjort i denne runden

**Målt etter endringene:** `npm run typecheck` PASS · `npm run test` **526 tester, 526 pass, 0 fail, 0 skipped** (519 før denne runden + 7 nye launch-gate-tester).

| Fil | Endring |
|---|---|
| `tests/launch-gate.test.mjs` | **Ny, 7 tester, 7/7 PASS** (hostname-isolasjon, lekkasje, testmerking, reell kunde ikke merket) |
| `src/index.ts` | `erTydeligTest()` tar kjørings-ID — `TEST-`-prefiks merker saken som test |
| `package.json` | `test:launch-gate` inn i `qa`-kjeden |
| `scripts/testgrunnlag-v1.mjs` | **Ny** generator: 117 biler, fire forventningsfelt, fire utfallsakser, fast frø, privat + delebar utgave |
| `data/testgrunnlag/` + `.gitignore` | Kjennemerker ute av sporet tre |
| `docs/testplan-v2-rammeverk.md` | **Ny** rammeverksdokument (dette svaret er oppsummeringen) |
| `tests/vin-resolver-gt.test.mjs` | GT-guard eksakt mot manifest (tidligere hardkodet ≥35 000 → falsk rød) |

Ingen fasit, forventning eller produksjonsfil er endret for å få grønne tester. Ingen deploy, ingen migrasjon, ingen prod-skriving.

## 10. Det som fortsatt blokkerer kjøring

1. **P0:** prod tar imot kundehenvendelser nå (`inquiries_enabled = 1`, 9 reelle saker, siste 2026-11-03 23:18 UTC) uten invitasjonssperre. Krever Toms GO å stenge.
2. **Kallvolum og kostnad** mot SVV for 4B.
3. **Testmottaker for e-post** i staging (i dag ekte innboks).
4. **GO for staging-skriving** i 4C/4D.
5. **Min side-eierskap** (§5) — må lukkes før Min side kan lanseres.
