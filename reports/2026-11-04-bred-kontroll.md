# Bred kontroll — testgrunnlag, invarianter og serverkjede

**Dato:** 2026-11-04 · **Commit:** se `git log` (denne commiten) · **Staging:** `6f6a3dbc-b3e3-463d-89aa-106d9bf49a67`
**Produksjon:** `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d` (uendret i denne runden)

---

## 1. Testgrunnlaget som faktisk finnes

| Kilde | Kjennemerker |
|---|---|
| `data/testgrunnlag/testgrunnlag-v1-privat.csv` (har `test_id`) | 117 |
| `data/fixtures/self-test-50-cars.json` | 50 |
| `data/finn-100.jsonl` | 110 |
| Øvrige filer (rapporter, tester) | resten |

**Unike:** **143** kjennemerker — **140 ekte**, **3 syntetiske** (SU18018, AJ95429, DS30475).
**Med bilopplysninger (merke + modell): 117.** 26 mangler merke/modell og kan ikke kjøres uten SVV-oppslag.

**500 finnes ikke.** 143 er taket i repoet. Ingen ny scraping er gjort.

Manifest: `data/testgrunnlag/manifest-v2.json`, SHA-256 `89eabb0d…`. Rapporten bruker
`test_id` (FBG-T-xxxx) — kjennemerker står bare i manifestet.

**Fordeling:** år ≤2010: 25 · 2011–2019: 37 · ≥2020: 55 · ukjent: 26.
Merker: Volkswagen 46, Toyota 29, BMW 8, Mitsubishi 4, Volvo 4, Kia 3, og enkeltbiler ellers.

## 2. Bred kjøring — én reell feil funnet

`scripts/bred-kontroll.mjs` kjører de faktiske modulene mot **ett frosset katalogsnapshot**
(30 937 rader, SHA-256 `c221fb6c…`), ikke en forenklet kopi.

| Måling | Resultat |
|---|---|
| Biler testet | 117 |
| Med kandidater | 25 |
| Uten kandidater | 92 |
| Kandidater totalt | 467 |
| Løvnoder (mulige sluttsvar) | 140 |
| **Feil etter retting** | **0** |

**Feilen som ble funnet:** `8432ASMR «TOYOTA RAV 4 2019- BUNNLIST»` ble tilbudt som
**glasskandidat**. Årsak: `erTilbehor()` i kandidatgeneratoren hadde bare
`PYNTELIST|GUMMILIST|KLIPS|PAKNING` — ordet `LIST` manglet. 74 rader i katalogen har
LIST i navnet; de fleste fanges av PY-suffikset, men ikke denne.

Rettet med `|LIST\b`, og låst med regresjonstest. Effekt: 474 → 467 kandidater
(7 duplikate BUNNLIST-rader forsvant).

**Invariantene som ble kontrollert:** ingen kapping (alle merker ligger under API-grensen
5 000), tilbehør aldri glass, variantidentitet på hver kandidat, ukjent svar filtrerer ikke,
ukjente data bekreftes aldri, hvert viste valg godtas av serveren, ingen år-/modellmotstrid,
og XLS-prisregelen (× 0,3125) holder for alle 30 937 rader.

**Dette er automatiske konsistenskontroller — ikke fasitbiler.** 117 kjøringer uten feil
sier at logikken er selvkonsistent, ikke at glassene passer.

## 3. Serverkjeden — ekte integrasjonstest

`tests/variant-kontroll-integrasjon.test.mjs` går gjennom **`worker.fetch`** med et
realistisk `glass_prisliste`-skjema (inkl. `kommentar`):

| Test | Forventet | Resultat |
|---|---|---|
| Dokumentert oppvarmet + kunde «nei» | 400, ingen sak, ingen e-post | **PASS** |
| Samme vare + «ja» | 201, én sak | **PASS** |
| Tilbehør som variant | 400, ingen sak | **PASS** |
| Ukjent variant | 400, ingen sak | **PASS** |
| Feil side | 400, ingen sak | **PASS** |

Testen krever eksplisitt at `INSERT INTO beta_inquiries` **ikke** kjøres og at ingen
Brevo/Resend-kall gjøres. Dette er sterkere enn vakt-testen som bare så på SQL-teksten.

## 4. Produksjonsmodus vs stagingmodus

| Miljø | Flagg | Modus | 5 representative biler |
|---|---|---|---|
| Produksjon | `ALL_GLASS_KANDIDATER_ENABLED` **ikke satt** | `MANUAL_QUOTE` | 0 kandidater for alle 5 |
| Staging | `= "true"` | `ALL_GLASS_VALG` | 4 × 0, 1 × 31 kandidater (FBG-T-0077) |

Produksjonskontrollene var lesende og sekvensielle (0,7 s pause), opprettet ingen saker
og sendte ingen e-post. **Flagget er ikke aktivert i produksjon.**

## 5. Sak #45 — statusordlyd og ukjent utstyr

`tilhørighet: bekreftet_bil_ukjent_plassering` var **misvisende**: årsaken var ikke
plassering, men at katalogen ikke dokumenterer noen egenskaper for den varianten.

- **Ukjent utstyr er korrekt.** `8432AGACMV1L` har ingen `kommentar` → ingen dokumenterte
  egenskaper. Kunden svarte «nei» til oppvarming; det gjør ikke «nei» til en bekreftet
  egenskap, og svaret lagres som ukjent.
- **Statusordlyden var feil.** Endret til `bekreftet_bil_ukjent_kontroll`.
- Ingen feil i dataveien denne gangen — `kommentar` hentes nå (fikset i forrige runde).

## 6. Tilbake på mobil — ikke rettet

`#btn-glass-back` vises bare når `valgBak.length > 0`, altså etter at kunden har valgt seg
ned i **valgtreet**. Frontrute-flyten går via resolveren og legger ingenting i `valgBak`,
så knappen er skjult på mobil (og desktop) etter svarsteget.

**Ikke rettet i denne runden.** En retting krever ny navigasjonsstate for resolver-flyten
(beholde svar, nullstille ugyldige valg, unngå gammel variant) — det er en funksjonsendring
som må testes for seg, ikke en kosmetisk fiks.

## 7. QA

| Måling | Verdi |
|---|---|
| QA totalt | **602/602** |
| Nye tester | 5 integrasjon + 1 regresjon (BUNNLIST) + 1 vakt (kommentar) |
| tsc | grønn |

## Gjenstår

1. `Tilbake` på mobil/desktop for frontrute-flyten (se punkt 6).
2. 26 biler i testgrunnlaget mangler merke/modell — krever SVV-oppslag for å kjøres.
3. 92 av 117 biler har ingen katalogkandidater — dekning, ikke feil.
4. Fasitpar er fortsatt 2; bred kjøring er ikke fasit.
5. Produksjonsdeploy av denne runden krever egen godkjenning.
