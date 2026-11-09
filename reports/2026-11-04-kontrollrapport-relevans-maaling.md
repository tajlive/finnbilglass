# Kontrollrapport — relevans, salgsenhet, utstyr, måling og nettlesermatrise

**Dato:** 2026-11-04 · **Branch:** `copy/kvittering-20261103` · **Commit:** `2419fbf`
**Staging:** `c2f8f121-690e-4178-adf2-879b97a6e710` · **Produksjon:** urørt (`cbdc2cf2`)

---

## 7. Versjonsbevis før funksjonstester

Versjonen ble bekreftet **før** testene, ikke etter: en forespørsel ble sendt og notatet lest fra D1. Notatet viste tekster som bare finnes i den nye koden:

```
kontroll: ingen svar å kontrollere mot · salgsenhet: ukjent (ingen kildeopplysning om salgsenhet)
```

Det er sterkere bevis enn deploy-loggen, fordi det er svaret fra den kjørende Workeren.

**Om det uventede 201-svaret i forrige runde:** forklaringen var deployforsinkelse, men jeg hadde ikke versjonsbevis knyttet til den konkrete forespørselen. Det skal derfor leses som **sannsynlig forklaring**, ikke bevist. Det som *er* bevist: sak #42 mangler kontrollnotatet mens #43 har det, altså ble de to forespørslene besvart av ulik kode.

## 1. «Ikke relevant» skilt fra «ukjent»

`RELEVANTE_FELT` per glasstype + `feltErRelevant()`:

| Type | Relevante felt |
|---|---|
| frontrute | body |
| bakrute | side, body |
| dørrute | side, dørledd, body |
| siderute | side, body |
| ventilrute | side, plassering, body |
| takglass | — |

Manglende side på en frontrute registreres **ikke** som uavklart. Samtidig er «ingen relevante felt kontrollert» nå `ukjent` med `ingen svar å kontrollere mot` — ikke `bekreftet`. Tester: frontrute uten side, dørrute med ukjent side.

## 2. Ingen antagelse om enkeltglass

`salgsenhet()` returnerer **`ukjent`** uten positivt kildegrunnlag:

| Kildeord | Produkttype | Resultat |
|---|---|---|
| PAR/SETT | glass | `par` |
| PAR/SETT | list/tilbehør | `ukjent` — «ikke et glasspar» |
| V+H / VS+HS | glass | `ukjent` — sidedekning, ikke pakkeinnhold |
| ingen markering | glass | `ukjent` — «ingen kildeopplysning» |

Artikkelprisen holdes uendret; settepris deles aldri.

## 3. Utstyr kontrollert på serveren

| Test | Resultat |
|---|---|
| Dokumentert oppvarmet + kunde «nei» | **avvist** (400) |
| Dokumentert oppvarmet + «ja» | bekreftet |
| Dokumentert oppvarmet + «vet ikke» | ukjent |
| Ukjent produktegenskap + «ja» | ukjent |
| Endret svar etter variantvalg (ja → nei) | ja = bekreftet, nei = **avvist** |

## 4. Kandidatmåling og før/etter

`scripts/kandidat-maaling.mjs` måler de ekte endepunktene (`/api/frontrute` og `/api/glass/valg`), per bil og rutetype.

**Etter (110 biler mot staging):**

| Akse | Resultat |
|---|---|
| Tekniske feil | **0** av 220 kall |
| Frontrute | 95 biler med kandidater · 277 unike kandidat-ID-er · p50 **228 ms**, p95 891 ms |
| Valgtre | 36 biler med kandidater · 940 kandidater · 202 rutetyper · 160 steg · p50 **93 ms**, p95 163 ms |

**Før/etter på samme manifest og samme katalograder** (`scripts/valgtre-for-etter.mjs`, «før» emulerer gammel `feltVerdi`):

| Måling | Før | Etter |
|---|---|---|
| Biler | 110 | 110 |
| Endret | — | **0** |
| Steg totalt | 95 | 95 |
| Løv totalt | 252 | 252 |

**Null endring på manifestet — og det er forklarbart:** endringen treffer bare rader med «begge sider» eller flere karosserier. I hele katalogen er det **4** kandidater med `side=begge` og **91** med flere karosserier, av **2 751** KlassD-kandidater. Ingen av de 110 bilene har slike rader i sin kandidatliste.

**Målbar endring der den faktisk gjelder:** `FORD TRANSIT 2002` gikk fra **4 → 6 steg** fordi `VS+HS`-radene nå dokumenterer begge sider, så sidevalget kommer opp. BMW 3-serie 1988, Toyota Corolla 1995 og VW Passat 1990: uendret (4 steg) — deres flerkarosseri-rader gir ikke flere spørsmål fordi øvrige kandidater er enige.

## 5. Nettlesermatrise

| Flyt | 1280 px | 390 px |
|---|---|---|
| Bilsøk → valgtre | ✅ RAV4 2024 | ✅ Golf 2006 (28 varianter) |
| Svar → liste | ✅ «Ja» ga 2 oppvarmede varianter (6 070,31 / 4 643,75) | ikke kjørt |
| **Endre svar** | ✅ «Endre svar» → «Nei» → listen ble 3 357,81 | ikke kjørt |
| **Nytt bilsøk** | ikke kjørt | ✅ svaret nullstilt (0 «Du svarte», 0 priser) |
| Horisontalt overløp | 0 | **0** |
| Eksplisitt variantvalg → innsending → /ops | ✅ sak #44 (forrige runde) | ikke kjørt |
| Ukjent utstyr/side, manglende pris, sett vs enkelt | Delvis (API-nivå) | ikke kjørt |

**Manglende pris:** `estimertKundeprisInklMva` gir `null` for `null`, `0`, `-5` og `NaN`, og visningen faller til «Pris på forespørsel» (dekket av `tests/frontrute-view.test.mjs:72` og `fase52-quote-journey`). Ingen levende staging-sak kunne brukes: de eneste pris-løse radene i staging er junk/emballasje.

## 6. Faktisk sikkerhet — ikke pyntet

- **Dokumenterte fasitpar: 2** (SU18018 PROVISIONAL, AJ95429 AMBIGUOUS). 20 er ikke etablert. Det som mangler er uavhengige kilder (leverandørbekreftelse eller verifisert installasjon), ikke kode.
- **Kopien er rettet:** «dokumenterte glass for denne bilen» → **«mulige glassvarianter for denne bilen»**, og «dokumenterte frontruter» → «mulige frontruter». Kandidatmatching er ikke dokumentert passform.

## QA

| Måling | Verdi |
|---|---|
| QA totalt | **590/590** |
| Testfil for variantkontroll | 23 tilfeller |
| tsc | grønn |

## Gjenstår

1. Nettlesermatrise: mobil for svar/endre svar/eksplisitt variant, og desktop for nytt søk.
2. Ukjent utstyr og sett-vs-enkeltglass i selve UI-et (ikke bare API).
3. Dokumenterte fasitpar utover 2 — krever ekstern kilde.
4. 110-bilersettet er manifestet som finnes; «117» kan ikke reproduseres uten de 7 ekstra bilene.
