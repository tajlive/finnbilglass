# Runde: Tilbake, dekningsanalyse og PINPOINT-utvalg

**Staging:** `ba35ee51-be7b-4b18-ada1-358b5b10bf1c` · **Commit:** `d8c858a` · **Produksjon:** `7ae6d2a6` (urørt)

---

## 1. Tilbake i frontrute-flyten — rettet og verifisert

`#btn-glass-back` ble bare vist når `valgBak.length > 0`, altså etter valg i valgtreet.
Frontruten går via resolveren og la ingenting der, så knappen var alltid skjult.

**Endret i `public/app.js`:**
- knappen vises når en rutetype er valgt (gjelder også frontrute)
- `valgTilbake()` med tom `valgBak` nullstiller `frontruteSvar`, valgt variant,
  resultatkort og spørsmålsboks, og går tilbake til rutevalget
- `searchGeneration` økes, så en pågående forespørsel ikke kan overskrive tilstanden

**Verifisert i staging:**

| | Mobil 390 | Desktop 1280 |
|---|---|---|
| Tilbake synlig etter rutevalg | ✅ | ✅ |
| Tilbake → rutevalg (4 ruter) | ✅ | ✅ |
| Gammelt svar («Du svarte») | **0** | **0** |
| Gamle priser | **0** | **0** |
| Gammel valgt variant | **nei** | **nei** |
| Ny rute + «Ja» gir nye varianter | – | ✅ 6 070,31 / 4 643,75 |

## 4. Golf Plus 2011 og Hilux 2025 — utelukkelsen er korrekt

| Bil | Hva katalogen har | Vurdering |
|---|---|---|
| **Toyota Hilux 2025** | 2 familierader, begge `HILUX 4 RUNNER 89-` | Moderne Hilux finnes ikke i katalogen. **Korrekt utelukket** — en 1989-rute er ikke riktig glass til en 2025-bil |
| **VW Golf Plus 2011** | 380 Golf-rader, **0** med PLUS i navnet | `NÆRMODELL` krever PLUS for Golf Plus. Golf-ruter er en annen bil. **Korrekt utelukket** |

Begge er katalog-/datahull, ikke matchingfeil. Filtreringen er ikke svekket.

## 5. Dekning per rutetype

«Minst én kandidatvei» (545 av 616) er **ikke** dekning for alle glass til bilen.
Frontruten står for nesten hele dekningen:

| Vei | Biler med kandidater |
|---|---|
| Frontrute (resolver) | **534** |
| Valgtre (dør/side/bak/ventil/tak) | **157** |
| Begge | 146 |
| Bare frontrute | 388 |
| Bare valgtre | 11 |

Rutetypefordelingen i valgtreet er dokumentert i `reports/bred-kontroll-616-v2.json`
per bil (`typer`, `kandidater`, `dekning`).

## 2–3. PINPOINT-utvalg for uavhengig kontroll — ikke gjennomført

Av de 87 PINPOINT-resultatene er **ingen** uavhengig bekreftet i denne runden.
Å gjøre det krever oppslag per bil i leverandørkilder (ihrautoglas/Glavista/OE),
og det er ikke gjort. Resolverens eget svar er ikke brukt som fasit.

**Fasitpar står fortsatt på 2** (SU18018 PROVISIONAL, AJ95429 AMBIGUOUS).
87 PINPOINT er konsistens, ikke dokumentert passform.

## 6. Regresjonssettet

616 biler er nå fast. Ingenting er lagt til i denne runden. Merkingen er intakt:
- **reelle biler:** 616 (hvorav 3 syntetiske testplater)
- **konstruerte regresjonstilfeller:** 6 tester i `tests/glass-valg.test.mjs`
- **uavhengig bekreftede fasitpar:** 2

## Avgrensning holdt

Ingen scraping, ingen masseberiking, ingen flaggaktivering, ingen migrasjon.
Produksjonsforespørselen for tilbehørsrettingen og statusordlyden står uendret og
separat fra dette testarbeidet.
