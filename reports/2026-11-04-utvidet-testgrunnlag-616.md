# Utvidet testgrunnlag — 616 biler

**Dato:** 2026-11-04 · **Staging:** `9fe7f0d9-d017-41ba-ace9-7b48879a26b5` · **Produksjon:** uendret (`7ae6d2a6`)

---

## Viktig: ingen FINN-scraping

FINN.no forbyr crawling (`robots.txt`: «Crawling FINN.no is prohibited unless you have
written permission»). Nye kjennemerker er derfor **ikke** hentet fra FINN.

De er hentet fra **våre egne D1-logger**: `regnr_logg` har **2 599 unike kjennemerker**
fra kunders egne søk i tjenesten. Det er data vi allerede eier, ikke innsamling fra tredjepart.

## Slik ble grunnlaget utvidet

| Steg | Resultat |
|---|---|
| Unike plater i `regnr_logg` | 2 599 |
| Nye utenfor eksisterende manifest | 2 480 |
| Beriket via **staging** `/api/regnr` med `lookupOnly: true` (logger ikke) | **499 av 500** |
| Feilet | 1 (ingen SVV-treff) |
| **Samlet manifest** | **616 unike biler med merke/modell/år** |

Metode: sekvensielle kall med 450 ms pause, kun mot staging, ingen saker, ingen e-post.
Manifest: `data/testgrunnlag/manifest-samlet.json`, SHA-256 `2ea5c5ab…`.

**Manifestene er bevisst ikke i git:** `data/testgrunnlag/` er gitignorert fordi filene
inneholder ekte kjennemerker (personopplysninger). De ligger på disk med kjent SHA-256,
og rapporten er den sporbare delen — ikke platene.

**Fordeling:** 57 merker · BMW 94 · VW/Volkswagen 113 · Volvo 57 · Toyota 53 · Mercedes 41 ·
Ford 33 · Audi 31. År: ≤2010 **189**, 2011–2019 **309**, ≥2020 **118**.

## Bred kjøring på 616 biler

| Måling | Resultat |
|---|---|
| Biler testet | 616 |
| Med katalogkandidater | 142 |
| Uten kandidater | 474 |
| Kandidater totalt | 3 672 |
| Løvnoder | 859 |
| **Feil etter retting** | **0** |

Katalogsnapshot: 30 937 rader, SHA-256 `c221fb6c…` (samme for alle biler).

### Feil funnet i denne runden (begge rettet)

1. **`3182S «VOLVO XC90 5D SUV 12- SENSORGEL»` ble tilbudt som glasskandidat.**
   `SENSORGEL`/`SENSORTAPE` fantes i `produkttype()` men ikke i `erTilbehor()` — to
   filtre som var uenige. Rettet, regresjonstest lagt til. Ramte 6 rader i kjøringen.
2. **Falsk positiv i måleskriptet:** `VALG_AVVIST` ble rapportert for kandidater som
   *riktig* var filtrert bort fra løvet. Skriptet sjekket alle bilens kandidater, ikke
   bare løvets medlemmer. Rettet med `posisjonFeltVerdier`.

## Hva dette beviser — og ikke beviser

- **Beviser:** kandidatgenerering, valgtre, serverkontroll og prisregel er selvkonsistente
  over 616 biler og 3 672 kandidater, uten tilbehørslekkasje, uten kapping, uten
  år-/modellmotstrid, og med ukjente data som aldri bekreftes.
- **Beviser ikke:** at glassene passer. Fasitpar er fortsatt **2**. 616 rene kjøringer er
  konsistens, ikke dokumentert passform.

## QA

**603/603 pass**, `tsc` grønn. Nye tester: SENSORGEL-regresjon, integrasjonstest av
inquiry-handleren (5 tilfeller), vakt for `kommentar`-kolonnen.

## Gjenstår

1. 1 plate kunne ikke berikes (ingen SVV-treff) — ubetydelig, men udokumentert hvilken type bil.
2. 474 av 616 biler har ingen katalogkandidater — dekning, ikke feil.
3. `Tilbake` i frontrute-flyten (mobil/desktop) er fortsatt ikke rettet.
4. Produksjonsdeploy av denne runden krever egen godkjenning.
