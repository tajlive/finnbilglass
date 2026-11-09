# Testplan v2 — rammeverk (etter CTO-gjennomgang 2026-11-04)

Dette dokumentet erstatter planens rammeverk (ikke kjørefasen). Det svarer punkt for punkt på
CTO-innvendingene i runde 2, og skiller strengt mellom **verifisert**, **spesifisert** og **gjenstår**.

Kodeversjon: `6c6fd16` + lokale endringer i denne runden (se §10).
Datasettversjon: `testgrunnlag v1`, seed `20261104` (`scripts/testgrunnlag-v1.mjs`).

---

## 1. Lanseringens omfang (kontrakt)

Kontrakten skal stå først i alle testrapporter. Alt utenfor er utenfor lanseringen.

**Innenfor lansering**

| Element | Kundens opplevelse | Krav |
|---|---|---|
| Bilidentifikasjon | Kjennemerke → merke, modell, år | Må stemme med SVV. Feil bil = kritisk feil. |
| Glassplassering | Velge blant de plasseringene bilen faktisk har | Kun plasseringer med datastøtte vises; ellers hjelpeflyt |
| Utstyrsegenskaper | Svare på spørsmål som skiller kandidater | «Vet ikke» er alltid et gyldig svar |
| Kandidater | Se dokumenterte alternativer | En kandidat er **ikke** en bekreftelse på at glasset passer |
| Forespørsel | Sende inn og få kvittering | Må alltid være mulig, også uten kandidater |
| Manuell kontroll | Få svar fra menneske | Endelig glass og pris godkjennes manuelt i denne lanseringsmodellen |

**Utenfor lansering** (skal ikke testes som kundeflyt, og skal ikke annonseres):
Min side med ordrehistorikk · OTP-innlogging for kunder · automatiske tilbud · prisestimat i UI ·
direkte kjøp/checkout · bildeoppslag i kundegrensesnittet.

**Forbudt i offentlige svar** (testes i `tests/launch-gate.test.mjs`): eurokode, varenr,
innkjøpspris, leverandørnavn, intern diagnostikk, andre kunders data, `/ops`-innhold.
Kontrollen dekker API-svaret, ikke bare synlig tekst.

---

## 2. Fasitmodell — fire felt, aldri ett statusfelt

Hver testrad har fire uavhengige forventninger (`reports/testgrunnlag-v1-delebar.csv`):

| Felt | Avgjør |
|---|---|
| `forventet_identifisering` | hvilken bil/variant som skal finnes |
| `forventet_kandidatutfall` | hvilke dokumenterte alternativer som skal være med/utelatt |
| `forventet_kundestatus` | `KREVER_KONTROLL` · `INGEN_DEKNING` · `BEKREFTET` |
| `tillatt_reserveflyt` | om manuell kontroll er akseptabelt **i denne testen** |

**Regresjonsregel (CTO punkt 2):** en bil som tidligere ble identifisert og nå havner i manuell
kontroll, registreres som **regresjon** selv om kundereisen er trygg. `tillatt_reserveflyt=JA`
betyr «manuell kontroll er greit her», ikke «alt er greit».

Målt i dag: 117 biler i grunnlaget, **2 har dokumentert fasit** (SU18018 `PROVISIONAL`,
AJ95429 `AMBIGUOUS`), 115 har `INGEN_FASIT` og kan bare måles på identifisering og teknisk utfall.

---

## 3. Utfallsmodell — fire akser, aldri blandet

| Akse | Verdier | Hvorfor |
|---|---|---|
| `teknisk_utfall` | `OK` · `TIMEOUT` · `429` · `5xx` · `ANNET` | tekniske feil må ikke telles som kataloghull |
| `katalogutfall` | `KANDIDATER` · `INGEN_DEKNING` · `IKKE_VURDERT` | dekning er en egen metric |
| `fasitvurdering` | `SAMSVAR` · `AVVIK` · `UKLART` · `IKKE_VURDERT` | kvalitet mot fasit |
| `kundeutfall` | hva kunden faktisk så og kunne gjøre | produktopplevelsen |

Feilrate = aksen `teknisk_utfall`. Dekning = aksen `katalogutfall`. Kvalitet = aksen
`fasitvurdering`. Konvertering/friksjon = aksen `kundeutfall`. Ingen summering på tvers.

---

## 4. Isolering av testinnsendinger — verifisert

| Krav (CTO punkt 4) | Status | Bevis |
|---|---|---|
| Staging bruker egne datalagre | **JA** | `wrangler.staging.toml`: `FINNBILGLASS_DB` = `finnbilglass-staging-catalog` (79d63481…), `FINNBILGLASS_STAGING_AUTH` = `finnbilglass-staging-auth` (0b024ab6…), R2 = `finnbilglass-opplaering-staging` (prod: `ac35018c…` / egen bucket) |
| Alle testsaker får testmarkør | **JA, utvidet i denne runden** | `beta_inquiries.is_test` (migrasjon 0042). Automatisk satt når kjennemerke er testmønster, når kontakt er testdomene — **og nå også når kjørings-ID `TEST-<runId>-<testId>` sendes som `sessionId`**. Målt før endringen: en test med telefonnummer `12345678` ble **ikke** merket. |
| Kjørings-ID | **JA** | `session_id` = `TEST-<runId>-<testId>`; ingen skjemaendring nødvendig |
| Testene holdes utenfor kundetall | **JA, som flagg — men ikke som filter** | `is_test=1` settes og eksponeres som `erTest` i `/ops` (`src/ops-consolidation.ts:127`). Merk: det er et **visningsflagg**, ikke et filter — testsaker vises i innboksen sammen med reelle saker. «Utenfor kundetall» krever at rapporter og tellinger filtrerer på `is_test=0`; det må gjøres eksplisitt i hver spørring. |
| Opprydding avgrenset til kjøringen | **JA (spesifisert)** | `DELETE FROM beta_inquiries WHERE is_test=1 AND session_id LIKE 'TEST-<runId>-%'` — slettes kun etter at kjøringen er rapportert |
| E-post kun til kontrollerte mottakere | **NEI — gjenstår** | Staging har egen `RESEND_API_KEY` + `SUPPORT_NOTIFY_EMAIL`. Det betyr at staging **kan** sende ekte e-post til en ekte innboks. Må erstattes av en testmottaker før fase 4D. |

**Målt status i staging nå:** 34 saker, hvorav **5 er `is_test=1`** og **29 er `is_test=0`**.
De 29 er eldre/umerkede testsaker — de må ryddes eller merkes før de kan brukes som «kundetall».

---

## 5. Feil underveis, samtidighet og tilgangskontroll

| Scenario (CTO punkt 5) | Dekning i dag |
|---|---|
| Kunde søker bil A, deretter B, og svaret for A kommer sist | **Gjenstår** — frontend må teste at utdatert svar forkastes |
| Bytte av bil/plassering etter at oppsummeringen er laget | **Dekket delvis** (F12/F17: valgt side fjerner motsatt side, tom liste aldri) — manuell nettlesertest gjenstår |
| Dobbeltklikk / retry etter timeout gir doble saker | **Dekket** (`tests/inquiry-idempotency.test.mjs`, Idempotency-Key + REPLAY/KONFLIKT/PAGAR) |
| Oppslagstjenesten svarer timeout/429/5xx/ufullstendig | **Gjenstår** — ingen test simulerer SVV-feil |
| OTP feil, utløpt eller brukt | **Utenfor lansering** (OTP er ikke i omfanget), men auth-laget har lockout-tester |
| Innlogget kunde åpner annen kundes sak | **HØY (personvern) — ikke dekket av test, og koden er ikke trygg** | `/api/customer/inquiries` og `/:id` eier-uttrykket er `session_id = userId OR kontakt = email` (`src/index.ts:890` og `:905`). Konsekvens: skriver noen inn en annen persons e-post som kontaktfelt, får den personen (innlogget med den e-posten) lese navn, telefon, kjennemerke og melding. Ingen masselesing, men feil eierskap. `beta_inquiries.customer_id` (migrasjon 0041) finnes **ikke** i prod eller staging — verifisert. |
| Offentlig bruker når interne `/ops`-funksjoner | **DEKKET NÅ** — `tests/launch-gate.test.mjs`: offentlig host → 403 før auth, ops-host uten sesjon → 401 |
| Bildeoppslag / uleselig skilt | **Utenfor lansering** (bildeoppslag er ikke i kundegrensesnittet) |

---

## 6. Regler for glassvalg — omformulert

De to forrige formuleringene var for bastante og er erstattet:

| Gammel regel | Ny regel |
|---|---|
| «Bare dokumenterte rutetyper blir tilbudt» | Et glass presenteres aldri som tilgjengelig eller kompatibelt uten støtte i dataene |
| «En gren ender aldri uten kandidater» | Ingen valggren ender i en blindvei: den ender i relevante alternativer **eller** i en forklarende hjelpeflyt |
| — | Manglende katalogdekning skal alltid gi en tydelig vei til manuell forespørsel |

Praktisk konsekvens: `MANUAL_REVIEW` og `INGEN_DEKNING` er gyldige, forventede utfall — ikke feil.
Det som er feil, er å presentere et glass som sikkert uten datastøtte.

---

## 7. Reproduserbarhet og grenser

| Krav | Løsning |
|---|---|
| Kodeversjon | git-SHA i rapporten (og prod-versjon separat — de er ikke like i dag) |
| Datasettversjon | `testgrunnlag v1` + seed i filnavn/rapport |
| Katalog- og prisgrunnlag | `data/fixtures/manifest.json` (ground_truth 32 307 · prisliste 29 627 · dumpet-tidspunkt) |
| Staging-adresse + utrullet versjon | `https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev` + verifisert `/health` |
| Fast frø for tilfeldig utvalg | `--seed 20261104` (mulberry32, identisk md5 ved gjentatt kjøring — verifisert) |
| Maks kall/samtidighet/retries/kostnad | **Gjenstår å fastsette av Tom**: tak per kjøring, samtidighet (foreslått 3), retries (2), SVV-kostnad |
| Stoppregler | Stopp ved ≥3 påfølgende tekniske feil, ved 429-rate >10 %, eller ved utilsiktet e-postutsending |
| Gjenopptak | Kun hvis kode-SHA, datasett-seed og katalog-manifest er identiske; ellers ny kjøring med nytt runId |
| Kjennemerker ikke i Git | **JA for nye grunnlag**: `data/testgrunnlag/` er gitignored; delbar rapport i `reports/` uten kjennemerker. `data/finn-100.jsonl` er allerede sporet i Git og krever historikk-rewrite for å fjerne — bevisst valg, dokumentert. |
| Prøvepulje først | 5 biler fra regresjonssettet, deretter full kjøring |

---

## 8. Lanseringsport v2

| # | Kriterium |
|---|---|
| G1 | Ingen åpne kritiske feil |
| G2 | Ingen åpne høye feil i funksjoner som skal lanseres — med mindre funksjonen tas ut av omfanget |
| G3 | Alle obligatoriske tester er **kjørt**; «ikke kjørt» er ikke bestått |
| G4 | Ingen dokumentert fasit havner i manuell kontroll uten at det er registrert som avvik |
| G5 | Ingen uvedkommende når andre kunders saker eller interne data (API + nettverkstrafikk) |
| G6 | Ingen uventet økning i manuell kontroll mot godkjent referansekjøring |
| G7 | Teknisk feilrate og responstid innenfor avtalte grenser (fastsettes av Tom) |
| G8 | Nettleserflyt fungerer på mobil og desktop |
| G9 | E-postflyt kontrollert med testmottakere |
| G10 | Persondata utenfor logger og rapporter; testsaker testmerket og ryddet |
| G11 | Rapport viser dato, kodeversjon, prod-versjon, datasettversjon, seed og manifest |
| G12 | Etter retting: både den konkrete feiltesten og hele regresjonssettet kjørt på endelig versjon |

Hermes gir **anbefaling**; produksjonssetting er en egen handling med egen godkjenning.

---

## 9. Hva som gjenstår før fase 4B–4E kan kjøres

1. **P0 må lukkes:** prod tar imot kundehenvendelser nå (`inquiries_enabled = 1`, 9 reelle saker). Krever Toms GO.
2. **Kallvolum og kostnad** mot SVV (punkt 7).
3. **Testmottaker for e-post** i staging (i dag ekte innboks).
4. **GO for staging-skriving** i 4C/4D.
5. **Avgjørelse på SU18018-kravet** — se §10.

---

## 10. Endringer gjort i denne runden

**Målt:** `npm run typecheck` PASS · `npm run test` **526 tester, 526 pass, 0 fail, 0 skipped**.

| Fil | Endring |
|---|---|
| `tests/launch-gate.test.mjs` | **Ny.** 7 tester: hostname-isolasjon (403/401), ingen intern lekkasje i offentlig svar, testmerking via kjørings-ID, reell kunde ikke merket. 7/7 PASS. |
| `package.json` | `test:launch-gate` lagt inn i `qa`-kjeden. |
| `src/index.ts` | `erTydeligTest()` tar kjørings-ID: `sessionId` som starter med `TEST-` merker saken som test. Uten dette ble testsaker med telefonnummer ikke merket (målt). |
| `scripts/testgrunnlag-v1.mjs` | **Ny.** Genererer testgrunnlag v1 (117 biler) med fire forventningsfelt, fire utfallsakser, fast frø, privat/delebar utgave. |
| `data/testgrunnlag/` + `.gitignore` | Kjennemerker flyttet ut av sporet tre; delbar rapport i `reports/`. |
| `tests/vin-resolver-gt.test.mjs` | GT-guarden sammenligner eksakt mot `manifest.json` (var hardkodet ≥35 000 → falsk rød test). |
