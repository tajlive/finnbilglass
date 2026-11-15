# Eurokode-kryssreferanse uten Glavista — isolert forskningsmodul

Dato: 2026-11-15 · Issue: #86 · Status: **research-only / ingen produksjonsintegrasjon**

## Formål

Sammenligne et lite, manuelt etterprøvbart sett Eurokode-observasjoner fra Steklo-Lux med FinnBilGlass sine **egne kandidater**, uten Glavista-katalog, Glavista-API, web scraping, D1 eller Worker-endringer.

Tjenesten tar inn data som argumenter. Den henter ingenting selv. Formålet er bedre intern kontroll av kandidatidentitet, årsintervall og utstyrsvarianter — **ikke** at en katalog bestemmer glasset på et registreringsnummer.

## Levert kode

- `src/fitment-v1/crossref/offline.ts`: ren `compareEurocodeCandidates(...)` med felter for bil, egne produktkandidater, kildeobservasjoner, proveniens og lisensstatus.
- `tests/eurocode-crossref.test.mjs`: 12 avgrensede tester for identiske koder, prefikslikhet, 1B/1T, facelift/generasjon, elbilvariant, ufullstendig kode, null/ukjent og uten eksterne kataloger.
- `package.json`: `npm run test:eurocode-crossref` er lagt inn i `npm run qa`.

Testkommandoer:

```bash
npm ci
npm run test:eurocode-crossref
npm run test:fitment:golden
npm run qa
npx tsc --noEmit
```

OBS: En test som bruker eksempeldata fra et nettsted kan bekrefte at vår **kode** fungerer. Den er ikke et komplett live-fasitbevis. Oppføringer kan bli endret eller ha mangler.

## Åtte undersøkelsescaser

| Case | Avgrenset observasjon | Regelen testen kontrollerer |
|---|---|---|
| Mitsubishi ASX 2011 | `5689AGNV` | Identisk kode i forskning = katalogoverlapp, aldri EXACT for bil |
| VW Transporter T5 2005 (SU18018) | Steklo `8579AGNGYAV` vs intern golden `8579AGSGYAVZ1B` | Samme 8579-familie er ikke samme glass |
| Mercedes CLA 2016 (AJ95429) | 1B/1T-varianter som sikkerhetsfixture | Versjonssuffiks beholdes; AMBIGUOUS oppgraderes aldri |
| VW up! 2018 | Kontrafaktisk 2019+-referanse | Ingen feilkobling over produksjonsgrense |
| Fiat 500 Electric | Forbrenningsvariant av Fiat 500 er ikke Electric-bevis | Ulik drivlinje må ikke likestilles |
| Mercedes Vito W447 2015 | `5382AGNGYA` og `5382AGNGYCP` | To varianter beholdes; kamerautstyr må bekreftes |
| Mazda CX-5 2017 | `5179AGNGY` og `5187AGNPV` | Første og andre generasjon må ikke kollapses |
| VW Transporter 2015 | T5/T6-grense | Årsmodell alene velger ikke generasjon |

CLA, up!- og Electric-negative tester er sikkerhets-fixtures og **ikke** Steklo-produktbevis for disse modellene. Den tidligere sammenligningen i Issue #86 var en avgrenset manuell kildetest; disse testene skal **ikke** omtales som ny 8/8-match eller som målt forbedret dekning.

## Kilder

- Steklo-Lux, offentlig frontrutekatalog: https://steklo-lux.com/our-products/laminated-glass-for-foreign-passenger-cars/
  - T5 / T6: VW Transporter-radene mot slutten av siden (merk at oppføringen for T6 sier 2016-, ikke at enhver 2015-T6 er dekket).
  - ASX: 5689AGNV; Vito: 5382AGNGYA / 5382AGNGYCP; CX-5: 5179* og 5187*.
  - Enkelte oppføringer, blant annet Hyundai Elantra 2016-, har `AGNGYV` uten modellidentifikator; derfor må ufullstendige koder flagges.
- ARGIC opphavsrett/databaserett: https://www.argic.org/aboutus
- Intern sikkerhetsfasit: `data/fitment-golden.json`.
- Lokal kandidatgenerator: `src/fitment-v1/catalogue-candidates.ts`.

## Grensene for denne endringen

- Ingen eksport, automatisk crawling, API-kall eller bulkimport fra Steklo-Lux.
- Ingen bilder, prisoppføringer eller fullstendige tredjepartskataloger kopieres. Små, manuelt transkriberte kodereferanser brukes kun som forsknings-/regresjonsfixtures.
- En Eurokode-kollisjon betyr **ikke** uavhengige kilder til sannhet dersom leverandørene baserer seg på samme ARGIC-kode.
- `licenseState=RESEARCH_ONLY` eller `UNVERIFIED` er ikke en produksjonslisens. Ekstern data må ha dokumentert lovlig bruksgrunnlag før permanent produktdatabase/import.
- Ingen kobling fra dette resultatet til statusen `EXACT`; `existingVerificationState` returneres uendret.
- Ingen endringer i egne varepriser, kundesaker, D1, Access, Kustom, e-post, API-ruter eller produksjonsflagg.
- All videre bruk i Operations Center krever separat PR, og ansatt må journalføre fysisk/OE-verifikasjon.
- Den tidligere C7.5-rapporten målte 29 % **kandidatdekning** på et historisk korpus, ikke 29 % EXACT. Ingen nye produksjonsdekningsmålinger er gjort her.

## Neste prioritering

1. Samle lokale GT-Auto-/prisliste-kandidater gjennom dagens `buildClassDCandidates()`; bruk kun rader med avklart bruksrett.
2. Utvid generatorens familiealiaser for ASX, CX-5, Fiat 500 og VW up! med konservativ års-/generasjonskontroll (egen PR).
3. Legg leverandørnøytrale OE- og feature-felter **additivt** til `Candidate`, uten å bryte gamle Glavista-fixtures.
4. Bruk modulens read-only-rapporter til å identifisere spørsmål som faktisk skiller flere kandidater.
5. Test med 8 interne cases og et større anonymisert korpus; rapportér relevante treff, motstrid, fasit-uendret, feilfiltrering og manuelt arbeid.
