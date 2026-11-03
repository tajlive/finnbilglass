# FinnBilGlass — Fase 3: Klargjøring av alle glasstyper

**Dato:** 2026-11-03
**Branch:** `release/v6.6.0-fase2` (staging-bygget, ikke deployet til produksjon)
**Staging-versjon under test:** `981e8fdb-5de9-4079-8b8b-3c738f128c00`
**Produksjon:** `d6fb5a3b-2882-4281-b978-5dee823f1dda` — **uendret**, `ALL_GLASS_KANDIDATER_ENABLED` finnes ikke i prod-config
**Migrasjon 0047:** ikke kjørt (verken staging på nytt eller produksjon)

---

## 1. Bunnlinje

# NO-GO for aktivering i produksjon nå

Kandidatkvaliteten er vesentlig bedre enn ved utgangspunktet (23 kvalitetsfeil → 0 i målt matrise),
men to ting må avgjøres før kunder skal se listene:

1. **Kroppsvariant kan gi feil glass.** Katalogen skiller ikke coupé/cabriolet/stasjonsvogn når
   kjøretøyet bare er identifisert som «GOLF» eller «3-SERIE». En BMW 320d-eier kan få en
   cabriolet-dørrute i listen. Det er merket «Krever kontroll», men det er fortsatt feil produkt
   i en liste kunden skal velge fra.
2. **Ingen variantskille i kortet.** To rader med samme tekst kan være ulike glass (ulik farge/
   utstyr). Vi viser varianter som ett kort med `varianter: N`, men kunden kan ikke se *hva* som
   skiller dem — og dermed ikke velge. Det er akseptabelt bare fordi alt går til manuell kontroll.

**Anbefaling:** aktiver for ett kontrollert utvalg (Transporter/Golf/Passat/CLA) etter at
kroppstype-spørsmålet er på plass, eller aktiver med dagens tekst og aksepter manuell kontroll —
det er en produktbeslutning, ikke en teknisk.

---

## 2. Hva som ble målt, og hvordan

| Test | Omfang |
|---|---|
| Kandidatmatrise | 18 kjøretøy × 7 klasser = 126 kall mot staging (`merke/modell/år`, ingen SVV-skriving) |
| Kvalitetskontroll per kandidat | feil posisjon (klasse vs. posisjonstekst), feil modellfamilie, umulig årgang, duplikat varenr |
| Topp-3-analyse | de 3 kortene kunden faktisk ser, vurdert for «annen navnemodell» |
| Chrome E2E | 7 glasstyper × mobil (393 px) og desktop (1280 px) × 2 biler |
| Store sett | alle lister med ≥20 kandidater, pluss visuell kontroll av 25-sett |
| Kontrakt | kandidatnøkler, EXACT, priser, intern diagnostikk, nulltreff-vei |

---

## 3. Funn og rettelser

### F11 — samme varenr to ganger i samme liste (P0)
Katalogen har flere rader per varenr med litt ulik tekst («FORD CONNECT TRANSIT  14-» og
«FORD CONNECT TRANSIT 14-»). Kunden fikk samme produkt to ganger; i Ford Transit-listen fem
ganger. **Rettet:** dedupe på varenr, første forekomst etter sortering beholdes.

### F12 — motsatt side ble foreslått (P0)
Kunden valgte «venstre», men listen inneholdt både venstre- og høyreglass (Transit: 21 venstre +
20 høyre i samme svar). **Rettet:** valgt side filtrerer bort beviselig motsatt side.
Norsk marked er venstrestyrt (`MARKEDSSTANDARD`), så «venstre i kjøreretningen» = fysisk venstre —
en markedsantakelse, dokumentert som sådan. Filtreringen tømmer aldri listen: finnes bare motsatt
side i katalogen, beholdes alt (merket usikkert).

### F13/F15 — nærliggende modeller og egne navnemodeller (P0)
`FAMILIER` samler alt som deler merke og plattform. Resultat før rettelse:
- Ford Transit-listen inneholdt **Transit Connect** og **Courier Transit**
- Golf-listen inneholdt **Golf Sportsvan**, **Golf Plus** og **Golf Cross**

**Rettet i to trinn:** (a) relevanssortering — rader med færrest «ekstra modellord» først, så
nøyaktig modell havner øverst; (b) `NÆRMODELL`-tabell som forkaster rader for en *annen navnemodell*.
Tabellen er symmetrisk: en Golf får ikke Sportsvan-glass, og en Sportsvan får ikke Golf-glass.
Kun navnemodeller som beviselig er egne biler står der (GOLF: SPORTVAN/PLUS/CROSS,
CLA: SHOOTING, TRANSIT: CONNECT/COURIER).

### F14 — identiske kort med ulik varenr (P1)
To rader kan ha samme produkttekst men ulikt varenr (ulik innkjøpsvariant). **Rettet:** kandidatene
grupperes på normalisert beskrivelse + posisjon, og hvert kort får `varianter: N`.
Mellomrom normaliseres — «T5 03-  BAKRUTE» og «T5 03- BAKRUTE» er samme produkt.

### Målt effekt

| Måling | Før | Etter |
|---|---|---|
| Kvalitetsfeil i matrisen (duplikat/år/modell/posisjon) | **23** | **0** |
| Lister med ≥20 kandidater | 23 kombinasjoner | 5 (bare «Vet ikke», som ikke filtrerer) |
| Topp-3-kort for en annen navnemodell | – | **0 av 113** vurderte kort |
| Eksempel Golf 2016 dør | 25 rader, 5 duplikater, Sportsvan først | 8 grupper; «Golf 5D STV» først |
| Eksempel Ford Transit dør | 25 rader, 5 duplikater, begge sider | 10 grupper, 21 rader, kun venstre |
| Transporter bakrute (stor liste) | 2 identiske kort av 3 | 3 ulike kort (se skjermbilde) |

---

## 4. Chrome E2E — alle glasstyper, mobil og desktop

```
OPPSUMMERING: 23 brukerreiser · 0 FEIL · 0 advarsler
FRONTRUTE-REGRESJON: h2="Vi har funnet flere mulige frontruter til bilen din"
                     kort=260 tegn · sporsmaal=3 · pris-elementer=2
```

| Bil | Front | Dør | Side | Ventil | Bak | Tak | Vet ikke |
|---|---|---|---|---|---|---|---|
| SU18018 Transporter 2005 | 5, VERIFY + 3 spm | 3 kort | 3 kort | MANUAL_REVIEW | 3 kort | MANUAL_REVIEW | 3 kort |
| JD79487 Caddy 2017 | frontrute-flyt | MANUAL_REVIEW | MANUAL_REVIEW | MANUAL_REVIEW | MANUAL_REVIEW | MANUAL_REVIEW | MANUAL_REVIEW |

Kontrollert per reise, på innhold og ikke bare HTTP: API kalt og 200, kandidatrader rendret,
«Krever kontroll før bestilling» til stede, ingen eurokode-lignende streng, ingen internal
diagnostikk (`CLASS_D_CATALOGUE_CANDIDATE`, `matchReason`, `listepris`, `undefined`, `NaN`),
ingen pris, ingen horisontal overflyt på 393 px, ingen JS-feil, tilbudsskjema åpner og avviser
tomt skjema.

Visuell kontroll av 25-settet (`transporter-rear.png`): tre ulike kort —
`26499GN … T5 03- BAKRUTE`, `26503GN … DOUBLE CAB 03-`, `26582GP … BAKRUTE EL` — ingen duplikater,
ingen pris, ingen eurokode.

---

## 5. Ubekreftet-merking, EXACT og priser

| Krav | Målt |
|---|---|
| Alle kandidater merket ubekreftet | Hvert kort: «Krever kontroll før bestilling — katalogen bekrefter ikke at glasset passer bilen.» Topptekst: «Riktig variant avhenger av bilens utstyr» |
| `EXACT` i noe svar | Aldri. `fitmentAuthority: "ingen — menneskelig bekreftelse kreves"` |
| Priser | CLASS_D-svaret har **ingen** prisfelt; kundeflaten viser ingen pris for disse klassene |
| Eurokode | Ikke i API-svaret, ikke i kundeflaten (regex-kontroll per reise) |
| Intern diagnostikk | `klassifisering`, `matchReason`, `source` fjernet (hviteliste) |

---

## 6. Nulltreff → MANUAL_REVIEW

Verifisert for Caddy (alle 7 klasser), Transporter ventil og tak: `status: MANUAL_REVIEW`,
`kandidater: []`, kundetekst «Vi må kontrollere hvilken rute bilen bruker før vi kan bekrefte
riktig glass. Send oss en forespørsel, så finner vi det ut.» og **aktivert** tilbudsskjema.
«Ingen glass finnes» forekommer ikke i noe svar.

---

## 7. Toyota RAV4 2018 / `3202GNCE` — rotårsak funnet (to lag)

### Lag 1: koden i GT er et varenr, ikke en eurokode
`ground_truth` har `TOYOTA RAV-4 2018 → 3202GNCE`. I `glass_prisliste` finnes **ingen eurokode**
`3202GNCE`, men **tre rader med varenr `3202GNCE`**:

| varenr | eurokode | varenavn |
|---|---|---|
| 3202GNCE | 8410AGACHMW | TOYOTA RAV-4 5D SUV 13- |
| 3202GNCE | 8410AGAACHMVW1 | TOYOTA RAV-4 5D SUV 15- |
| 3202GNCE | 8410AGAACHMW3L | TOYOTA RAV-4 5D SUV **17-18** |

Dette er ikke en manglende katalogkobling: produktet finnes, med riktig bil og årsintervall.
`prisKandidat()` matcher allerede `varenr = ? OR eurokode = ?`, så lag 1 er ikke blokkeringen.

### Lag 2: modellnavnet må ha skilletegn — det er den faktiske feilen
Samme bil, tre skrivemåter mot `/api/frontrute` (staging):

| `modell` | Utfall | Kandidat |
|---|---|---|
| `RAV4` | **FALLBACK** | 0 |
| `RAV 4` | **PINPOINT** | `3202GNCE` «TOYOTA RAV-4 5D SUV 13-», 6 990 kr |
| `RAV-4` | **PINPOINT** | samme |

GT-matchingen er ordbasert (`gtRadMatch`, «aldri substring»). `RAV4` gir ett token som ikke
treffer GT-raden `RAV-4` (to tokens). `MODEL_TOKEN_ALIAS` har bare CARAVELLE/TRANSPORTER/MULTIVAN.
Feilen rammer alle modeller der SVV skriver navnet uten skilletegn mens GT har det med.

**Ikke rettet i denne fasen:** det er en endring i frontrutesøket — den mest følsomme stien, og
eieren har sagt at den ikke skal risikeres. Rettelsen er liten (normaliser modellnøkkel til
bokstaver+siffer uten skilletegn i `gtRadMatch`, med regresjonstester), men fortjener egen
release. **Ingen falsk katalogkobling er opprettet.**

### Sidefunn: GT-kodene er i hovedsak varenr
| GT-distinkte koder | 4 283 |
|---|---|
| treffer en katalog-**eurokode** | 294 |
| treffer bare et katalog-**varenr** | 3 682 |
| finnes ikke i katalogen | 50 |

Det forklarer hvorfor `prisKandidat()` matcher begge kolonnene. Det er verdt å merke GT-kolonnen
som «varenr eller eurokode» i neste datarydding — ikke ved å skrive om data nå.

---

## 8. Dekningsgap (ærlige, ikke feil)

| Område | Status |
|---|---|
| AUDI (alle modeller) | **0 kandidater** — merket finnes i `MERKE_ALIAS`, men ingen familie i `FAMILIER`. 1 137 Audi-rader i katalogen er altså utilgjengelige for kundesøk |
| VW CADDY 2017 | 0 — ingen familie |
| VW TRANSPORTER T6 (2016) | dør/side = 0, bak = 2 — T6-katalogdekning er tynn |
| Ventil/tak | Transporter T5 og CLA har ingen rader; hele katalogen har 418 ventil- og 39 takrader |
| RAV4 | frontrute fungerer med riktig modellnavn (§7); dør/side/bak mangler for 2018 |

---

## 9. Aktivering, overvåking og deaktivering

### Aktivering (én endring + governed deploy)
```bash
# 1. Sjekk ut release-branchen og bekreft at prod-config IKKE har flagget
git checkout release/v6.6.0-fase2
grep -n "ALL_GLASS_KANDIDATER_ENABLED" wrangler.toml    # skal gi 0 treff i [vars] (kun [env.staging.vars])

# 2. Legg flagget i produksjons-[vars]
#    [vars]
#    ENVIRONMENT = "production"
#    ALL_GLASS_KANDIDATER_ENABLED = "true"

# 3. Governed deploy — samme vei som forrige release
gh workflow run deploy.yml --ref release/v6.6.0-fase2
#    → test-gate → security-check → deploy (krever eiergodkjenning) → smoke-betatest

# 4. Verifiser at flagget faktisk er PÅ i den kjørende versjonen
curl -s -X POST https://finnbilglass.no/api/glass/kandidater \
  -H 'Content-Type: application/json' \
  -d '{"regnr":"SU18018","schemaVersion":1,"selection":{"kind":"door","side":"left","door":"front"}}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'],len(d['kandidater']),d['modus'])"
#    forventet: CANDIDATES <n> ALL_GLASS_CANDIDATES
```

### Overvåking de første 24 timene
| Signal | Kilde | Alarmgrense |
|---|---|---|
| Worker-unntak | CF GraphQL `workersInvocationsAdaptive` (`errors`) | > 0 i en 10-min-vindu |
| 5xx på `/api/glass/kandidater` | samme, `dimensions.status` | én enkelt 5xx |
| Tomme svar der det skal være treff | stikkprøve med 3 kjente biler | alle tre gir `kandidater: []` |
| Frontrute uberørt | `POST /api/frontrute` VW Transporter 2005 | ikke VERIFY med 5 kandidater |
| Tilbudsmottak | `POST /api/inquiry {}` | ikke 400 |
| /ops | `GET /ops` | ikke 302 |

Den eksisterende 5-minuttersvakten (`~/.hermes/scripts/fbg-monitor.sh`) dekker oppetid,
endepunktfeil og feilrate — den trenger ikke endres, men bør leses etter aktivering.

### Deaktivering (raskeste vei)
To uavhengige veier, begge uten datatap:
1. **Kode-rollback (sekunder):** `npx wrangler rollback --name finnbilglass-frontrute --version-id d6fb5a3b-2882-4281-b978-5dee823f1dda` — forrige produksjonsversjon har flagget av.
2. **Flagg av (governed):** fjern linjen fra `[vars]`, `gh workflow run deploy.yml`. Krever godkjenning, men er sporbar.

Ingen D1-endring er involvert: kandidatvisning skriver ingenting.

---

## 10. Risikovurdering

| Risiko | Sannsynlighet | Konsekvens | Tiltak |
|---|---|---|---|
| Feil kroppsvariant i listen (coupé/cab for sedan) | Middels | Kunden ber om tilbud på feil glass; manuell kontroll fanger det | Manuell kontroll er obligatorisk; kroppstype-spørsmål er neste steg |
| Kunden tror kandidaten er bekreftet | Lav | Feil forventning | Teksten «Krever kontroll før bestilling» står på hvert kort; ingen pris, ingen EXACT |
| Lange lister virker overveldende | Middels | Færre fullfører | Maks 3 kort, gruppert per produkt, «varianter»-tall |
| Feil i frontrutesøket av aktiveringen | Lav | Kritisk | Egen kodevei; flagget rører ikke `/api/frontrute`; regresjonstest hver E2E |
| Ytelse: katalogspørring per søk | Lav | Treg respons | Merkebegrenset spørring, `LIMIT 5000`, målt < 100 ms i staging |
| Dekningsgap oppfattes som «finnes ikke» | Middels | Tapt salg | MANUAL_REVIEW-tekst + tilbudsskjema i alle klasser |

---

## 11. GO/NO-GO

| Element | Status |
|---|---|
| Kodekvalitet (tester) | **502 tester / 495 PASS / 0 FAIL / 7 skipped**, `tsc` grønn |
| Chrome E2E staging | **23/23 reiser, 0 feil** (alle klasser, mobil + desktop) |
| Kandidatkvalitet (målt matrise) | **0** feil i 126 kall; **0 av 113** topp-3-kort for annen navnemodell |
| Ubekreftet-merking, EXACT, priser | ✅ ingen EXACT, ingen priser, alltid «Krever kontroll» |
| Nulltreff | ✅ MANUAL_REVIEW + tilbudsskjema i alle klasser |
| Frontrutesøk | ✅ uendret (regresjon grønn) |
| **Aktivering i produksjon** | **NO-GO nå** — venter på eierbeslutning på kroppsvariant-risikoen (§10) og på at RAV4-rettelsen (§7) får egen release |

**Anbefalt neste steg, i rekkefølge:**
1. Eier bestemmer om kroppsvariant-risikoen er akseptabel med dagens manuelle kontroll (den er
   dokumentert og merket på hvert kort).
2. RAV4-modellnormalisering (lag 2 i §7) som egen liten release med regresjonstester — den gir
   PINPOINT i stedet for FALLBACK for en bil som allerede finnes i katalogen.
3. Kroppstype-spørsmål i kundeflyten (nytt spørsmål: coupé / sedan / stasjonsvogn / cabriolet)
   fjerner den største gjenværende feilkilden.
4. Deretter aktivering etter runbooken i §9.

---

## Vedlegg — reproduksjon

```bash
# Kandidatkvalitet (126 kall, 18 biler × 7 klasser)
python3 ~/.hermes/cache/scratch/fbg-fase3/kvalitet.py

# Topp-3-kort: vurderer det kunden faktisk ser
python3 ~/.hermes/cache/scratch/fbg-fase3/topp3.py

# Chrome E2E (alle glasstyper, mobil + desktop)
FBG_BASE=https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev \
  node scripts/e2e-release-chrome.mjs

# Store sett: skjermbilde + kontroll av 25-lister
node ~/.hermes/cache/scratch/fbg-fase3/stor-liste.mjs
```
