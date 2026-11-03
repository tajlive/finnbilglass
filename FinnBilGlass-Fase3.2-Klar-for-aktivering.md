# FinnBilGlass — Fase 3.2: Klar for kontrollert aktivering

**Dato:** 2026-11-03
**Releasekandidat 1 (aktivering):** `release/v6.6.0-fase2` @ `55ae7cf` — PR #25
**Releasekandidat 2 (RAV4, egen):** `fix/rav4-modellnormalisering` @ `ec61ca1` — PR #26
**Staging:** `bd12bf11-f60a-45fc-84b6-c9e7b8466e19`
**Produksjon:** `d6fb5a3b-2882-4281-b978-5dee823f1dda` — uendret, flagget finnes ikke
**Migrasjon 0047:** ikke kjørt i produksjon

---

## 1. Faktisk utgangspunkt (kontrollert på nytt)

| Element | Målt verdi |
|---|---|
| Produksjonsversjon | `d6fb5a3b-2882-4281-b978-5dee823f1dda` (2026-11-03T15:40Z) |
| Produksjonens svar på `/api/glass/kandidater` | `MANUAL_REVIEW`, 0 kandidater, `modus: MANUAL_QUOTE` |
| `ALL_GLASS_KANDIDATER_ENABLED` i prod-`[vars]` | **finnes ikke** (verifisert i `wrangler.toml`) |
| PR #25 | åpen, base `fix/v660-d3-readiness`, head `55ae7cf` |
| Release-branch | `release/v6.6.0-fase2` |
| Staging | `bd12bf11` (release-branchen + staging-konfigfiks, se §5.0) |
| **Rollback-versjon** | `d6fb5a3b` (dagens produksjon) |
| Eldre rollback | `ae5bb623` (forrige release) |

**Én identifisert releasekandidat:** `release/v6.6.0-fase2` @ `55ae7cf`.
RAV4-endringen er skilt ut som egen kandidat (`fix/rav4-modellnormalisering` @ `ec61ca1`, PR #26)
fordi den rører frontrutesøket.

---

## 2. Kroppsvariant i kundeflyten

### Spørsmålet
Nytt felt `body` for **dør, side, bak og ventil** — ikke for frontrute eller takglass, der det i
praksis ikke skiller glasset:

> «Hvilken karosseritype er bilen?» — Sedan · Stasjonsvogn · 5-dørs / hatchback · Coupé ·
> Cabriolet · Varebil / minibuss · SUV / crossover · **Vet ikke**

### Filtreringsregelen (presis)
1. Katalograder som **uttrykkelig** oppgir et annet karosseri fjernes (`SED`, `STV`, `HBK`, `CPE`,
   `CAB`, `VAN`, `MPV`, `SUV`, `CROSSOVER` …).
2. Rader **uten** karosseri beholdes — katalogen sier ikke hva det er.
3. Filtreringen **tømmer aldri** listen: finnes bare «feil» karosseri, beholdes alt.
4. «Vet ikke» → ingen filtrering.

Målt på staging (VW Passat 2016, dør venstre):

| Kundevalg | Kandidater |
|---|---|
| uten `body` (eldre klient) | 12 |
| `sedan` | 6 — ingen STV-rader |
| `estate` | 9 — ingen SED-rader |
| `unknown` | 12 |
| ugyldig verdi (`romskip`) | **400** |

### Kontrakten er bakoverkompatibel
`body` er **valgfritt** i `glass-selection-contract.ts`. Eldre klienter og eksisterende tester
sender det ikke; fravær betyr «vet ikke», ikke feil.

### Valget følger til operatøren — bevist
Staging-henvendelse med `body: "estate"` (sak 26, `is_test=1`):

```
Glassvalg: {"kind":"door","side":"left","door":"front","body":"estate"}
automatisk kontroll av karosseriflyt
Kundens utstyrssvar (må kontrolleres): {"sensor":"vet-ikke"}
```

Kundesammendraget i grensesnittet viser også karosseriet: «Dørrute · Venstre · Foran · Stasjonsvogn».

---

## 3. Forståelige kandidatkort

| Før | Nå |
|---|---|
| Kort med bare varenr + navn; varianter så identiske ut | Hver kandidat viser **dokumenterte egenskaper** dekodet fra eurokoden: grønn tone, solbeskyttende, regnsensor, varmetråder, belegg, antenne |
| Flere varenr med samme tekst ble slått sammen uten forklaring | Gruppering skjer på beskrivelse **+ egenskaper**. Ulike egenskaper = egne kort, så forskjellen er synlig |
| «2 varianter» uten forklaring | «N varianter med samme dokumenterte egenskaper — vi avklarer hvilken som er riktig» |
| Tomt felt når katalogen ikke oppgir noe | «Egenskaper er ikke dokumentert i katalogen» |
| `attributter` (engelske internnøkler) i API-et | `egenskaper` (norsk kundetekst) i hvitelisten; internnøklene er borte |

Målt eksempel (Transporter 2005, dør venstre): tre kort — `26493GNL … Dørrute venstre / solbeskyttende`,
`26495GN … Dørrute venstre / solbeskyttende`, `26495GP … Sideglass venstre / Egenskaper er ikke dokumentert i katalogen`.

Merkingen «Krever kontroll før bestilling — katalogen bekrefter ikke at glasset passer bilen» står
fortsatt på hvert kort, og det er ingen pris i noen av klassene.

---

## 4. RAV4 — egen, liten endring (PR #26)

| Kall | Før (prod, målt) | Etter (staging `152ae8ab`) |
|---|---|---|
| `RAV4` 2018 | FALLBACK, 0 | **PINPOINT** `3202GNCE`, 6 990 kr |
| `RAV 4` 2018 | PINPOINT | PINPOINT |
| `RAV-4` 2018 | PINPOINT | PINPOINT |

**Rotårsak:** GT-matchingen er ordbasert; `RAV4` gir ett token, GT-raden heter `RAV-4` (to tokens).

**Tre vern, alle testet** (`tests/rav4-modellnormalisering.test.mjs`):
1. `modellNokkel()` — likhet først etter at skilletegn er fjernet (RAV4 = RAV 4 = RAV-4).
2. `navnemodellKonflikt()` — Golf Sportsvan/Plus/Cross, Transit Connect/Courier, CLA Shooting Brake,
   Passat CC møtes aldri.
3. `enkelttegnKonflikt()` — «MODEL 3» vs «MODEL Y», «A-CLASS» vs «B-CLASS».
   **Sidefunn:** `MODEL Y` matchet GT-raden `MODEL 3` (tesla-eiere kunne fått feil bil) — rettet.

**Regresjon:** Transporter 2005 (VERIFY, 5), CLA 2016 (VERIFY, 4), BMW 320d 2014 (VERIFY, 2),
Golf 2016 (VERIFY, 6), Corolla 2018 (VERIFY, 2) — identiske lister før/etter.

---

## 5. Hele kundereisen på staging

### 5.0 To staging-hull som blokkerte verifiseringen (funnet og rettet)
`wrangler.staging.toml` manglet to ting som `wrangler.toml [env.staging]` har:

| Manglet | Konsekvens | Rettet |
|---|---|---|
| `FINNBILGLASS_STAGING_AUTH`-binding | `getInquiryDb()` kaster `STAGING_MISSING_D1_BINDING` → **500 på hver gyldig henvendelse** | binding lagt til |
| `inquiries_enabled = "true"` | `henvendelserTillatt()` stengte → **503 på tilbudsskjema** | flagg lagt til |

Uten disse var «kontrollert aktivering» ikke testbar i staging: skjemaet så riktig ut i UI, men
innsendingen feilet. Begge er staging-only; produksjonskonfigurasjonen er urørt.

### 5.1 Chrome E2E — 27 brukerreiser, 0 feil
7 glasstyper + «ukjent karosseri»-variant × 2 biler (Transporter 2005 med dekning, Caddy 2017 uten)
× mobil 393 px og desktop 1280 px, pluss frontrute-regresjon.

| Kontroll | Resultat |
|---|---|
| Alle klasser, begge viewports | ✅ ingen feil |
| Kjent karosseri (stasjonsvogn) og «Vet ikke» | ✅ begge gir kandidater / MANUAL_REVIEW som forventet |
| Venstre og høyre side | ✅ siden filtreres; API verifisert separat (venstre 23 / høyre 20 på Golf) |
| Nulltreff (Caddy, Transporter ventil/tak) | ✅ MANUAL_REVIEW + aktivt tilbudsskjema |
| Flere kandidater | ✅ 3 kort med egenskaper og kontrollmerking |
| Frontrutesøk | ✅ VERIFY, 5 kandidater, 3 kontrollspørsmål, pris vises |
| Prislekkasje i kandidatklassene | ✅ ingen pris |
| Eurokode i kundeflaten | ✅ ingen treff på eurokode-mønster |
| JS-feil | ✅ ingen |
| Mobil overflyt | ✅ ingen |

### 5.2 Operatørflyten — bevist, ikke antatt
Gyldig henvendelse på staging ga `201 {ok:true,inquiryId:26}` og saken inneholder kundevalget
(inkl. karosseri) og utstyrssvarene. `is_test=1` ble satt automatisk av `erTydeligTest`.

### 5.3 API-kontrakt (staging)
| Kontroll | Resultat |
|---|---|
| Kandidatnøkler | `varenr, varenavn, posisjon, egenskaper, varianter` — ingen eurokode/pris/intern kode |
| `EXACT` | aldri; `fitmentAuthority: "ingen — menneskelig bekreftelse kreves"` |
| Ugyldig/ufullstendig/motstridende valg | 400 |
| «Vet ikke»-klasse | 200 uten klassefilter |

---

## 6. Grunnlaget for riktig glass — og hva som mangler

### 6.1 Måleverktøyet er på plass
`scripts/fasit-utvalg.mjs` + `data/fasit-utvalg.csv` måler per glassklasse:

| Dom | Betydning |
|---|---|
| `RIKTIG_ENTYDIG` | fasitens produkt er eneste kandidat |
| `RIKTIG_BLANT_KANDIDATER` | fasitens produkt finnes blant kandidatene (manuell kontroll) |
| `MANUELL_FORVENTET` | fasiten sier «tvetydig» — riktig svar er manuell kontroll |
| `FEIL_FORSLAG` | kandidater finnes, men ikke fasitens produkt |
| `MANGLENDE_TREFF` / `TEKNISK_FEIL` | tomt svar / feil |

Kilden graders som A (uavhengig verifisert), B (autoritativ katalog/OE) eller C (avledet), og
«kandidater til manuell kontroll» holdes atskilt fra dokumentert passform.

### 6.2 Kjørt på det som finnes — og det er for lite
| regnr | klasse | kilde | utfall | dom |
|---|---|---|---|---|
| SU18018 | frontrute | A (Tom 2026-08-16) | VERIFY, 5 | `RIKTIG_BLANT_KANDIDATER` (2525GYA blant de 5) |
| AJ95429 | frontrute | A (Tom 2026-08-13) | VERIFY, 4 | `MANUELL_FORVENTET` |

**Det uavhengige utvalget er to biler.** Det er nok til regresjon, ikke til å måle treffsikkerhet
per glassklasse. `ground_truth` (32 307 rader) kan **ikke** brukes som mål: den er avledet fra
samme katalog som systemet selv bruker (kilde C/D), og ville målt systemet mot seg selv.

**Hva som trengs** (konkret, ikke som plan): 20–40 biler der fasiten er uavhengig — OE-nummer lest
av det gamle glasset, OEM-portal (Tesla parts, BMW AOS) eller montørbekreftelse — fordelt på
frontrute/dør/side/bak. Fyll `data/fasit-utvalg.csv` og kjør scriptet; da er tallene per klasse
reelle.

### 6.3 Dekningshull (kartlagt, ikke pyntet)
| Område | Målt status |
|---|---|
| **Audi** (alle modeller) | **0 kandidater** i alle klasser — merket finnes i alias-tabellen, men ingen familie i `FAMILIER`. 1 137 Audi-rader i katalogen er utilgjengelige |
| **VW Caddy** | 0 — ingen familie |
| **VW Transporter T6 (2016)** | dør 0, side 0, bak 2 — tynn dekning |
| **Ventil/tak** | ingen rader for Transporter T5 / CLA; hele katalogen har 418 ventil- og 39 takrader |
| **RAV4 dør/side/bak** | 0 for 2018 (frontrute dekkes, jf. §4) |
| Øvrige merker uten familie | Renault, Peugeot, Honda, Mazda, Škoda, Hyundai, Kia … → 0 kandidater, MANUAL_REVIEW |

---

## 7. GO/NO-GO

| Gate | Status |
|---|---|
| Tester | **505 / 498 PASS / 0 FAIL / 7 skipped** (RAV4-branchen: 510 / 503) |
| TypeScript | grønn |
| Chrome E2E staging | **27/27 reiser, 0 feil** |
| Kandidatkvalitet (126 kall) | **0 feil**; 0 av 113 topp-3-kort for annen navnemodell |
| Karosseri | ✅ spurt der det virker, filtrerer bare ved dokumentert konflikt, «Vet ikke» alltid mulig |
| Kandidatkort | ✅ egenskaper vises, varianter forklares, «ikke dokumentert» sies høyt |
| Ubekreftet-merking / EXACT / pris | ✅ alltid «Krever kontroll», aldri EXACT, ingen pris i disse klassene |
| Nulltreff | ✅ MANUAL_REVIEW + tilbudsskjema |
| Operatør mottar kundevalget | ✅ bevist i staging-sak 26 |
| Tilbudsmottak i staging | ✅ rettet (manglet binding + flagg) |
| **Aktivering i produksjon** | **NO-GO nå** — se under |

**Hvorfor fortsatt NO-GO for produksjon:**
1. **Kroppsvariant er nå håndtert i spørrefliesen, men bare når kunden svarer.** Svarer kunden
   «Vet ikke», kan coupé/cabriolet/stasjonsvogn-ruter fortsatt komme i listen. Det er merket, men
   det er den største gjenværende feilkilden.
2. **Ingen uavhengig måling per glassklasse** (§6.2): vi vet at listene er rene, men ikke hvor ofte
   det riktige glasset faktisk står i dem.
3. RAV4-rettelsen er en egen releasekandidat og ikke merget.

**Anbefaling — kontrollert aktivering i to trinn:**
- **Trinn 1 (kan godkjennes nå):** aktiver for **frontrute-flyten uendret** + de klassene der
  katalogen er sterkest og kroppsvarianten er minst relevant, med dagens manuelle kontroll.
  Følg §8 i ett døgn.
- **Trinn 2:** utvid til alle klasser når et uavhengig utvalg på 20–40 biler (§6.2) er målt, og
  Audi/Caddy/T6-dekningen er kartlagt eller bevisst akseptert.

---

## 8. Aktivering, overvåking og tilbakeføring

### Aktivering (governed CI, samme vei som forrige release)
```bash
git checkout release/v6.6.0-fase2
grep -c ALL_GLASS_KANDIDATER_ENABLED wrangler.toml     # 1 treff = kun i [env.staging.vars]
# legg linjen i produksjons-[vars]:
#   ALL_GLASS_KANDIDATER_ENABLED = "true"
gh workflow run deploy.yml --ref release/v6.6.0-fase2   # test-gate → security → deploy (eiergodkjenning) → smoke
```

Verifiser at flagget faktisk er på **i den kjørende versjonen** (ikke bare i config):
```bash
curl -s -X POST https://finnbilglass.no/api/glass/kandidater -H 'Content-Type: application/json' \
  -d '{"regnr":"SU18018","schemaVersion":1,"selection":{"kind":"door","side":"left","door":"front","body":"estate"}}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'],len(d['kandidater']),d['modus'])"
# forventet: CANDIDATES <n> ALL_GLASS_CANDIDATES
```

### Overvåking første døgn
| Signal | Kilde | Grense |
|---|---|---|
| Worker-unntak | CF GraphQL `workersInvocationsAdaptive.errors` | > 0 i 10-min-vindu |
| 5xx på kandidatruten | `dimensions.status` | én enkelt |
| Tomme søk der katalogen har data | stikkprøve: Transporter 2005 dør, Golf 2016 dør | `kandidater: []` |
| Frontrute uberørt | `POST /api/frontrute` Transporter 2005 | ikke VERIFY/5 |
| Tilbudsmottak | `POST /api/inquiry {}` | ikke 400 |
| Saker i /ops | ny sak skal inneholde «Glassvalg:» med `body` | mangler feltet |

Den eksisterende 5-minuttersvakten (`~/.hermes/scripts/fbg-monitor.sh`) dekker oppetid,
endepunktfeil og feilrate og trenger ingen endring.

### Tilbakeføring (to uavhengige veier, ingen datatap)
1. **Kode-rollback, sekunder:** `npx wrangler rollback --name finnbilglass-frontrute --version-id d6fb5a3b-2882-4281-b978-5dee823f1dda`
2. **Flagg av, governed:** fjern linjen fra prod-`[vars]`, `gh workflow run deploy.yml`.

Kandidatvisning skriver ingenting i D1 — en rollback er ren kode.

---

## Vedlegg — reproduksjon

```bash
npm run qa
FBG_BASE=https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev node scripts/e2e-release-chrome.mjs
python3 ~/.hermes/cache/scratch/fbg-fase3/kvalitet.py          # 126 kall, kvalitetsfeil
node --import tsx scripts/fasit-utvalg.mjs                      # fasit-utvalg per klasse
node --import tsx --test tests/rav4-modellnormalisering.test.mjs
```
