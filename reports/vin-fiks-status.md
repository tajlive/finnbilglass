# VIN-fiks — isolert arbeidstre

**Arbeidstre:** `/tmp/fbg-vinfix` · **Basis:** `0e7573b2` (produksjonskode) · **Commit:** `c41b73bf` (cherry-pick av `c423787d`)
**Diff:** 2 filer, 21 innsettinger — `src/vin-resolver.ts`, `tests/vin-modellaar.test.mjs`
**Staging:** `f943e902-06bf-477e-ac1b-ce8efcd0b9ab`

## Produksjonsbasen inneholder tidligere rettelser

| Markør | Finnes i basis |
|---|---|
| `bekreftet_bil_ukjent_kontroll` | ✅ `src/index.ts` |
| `erTilbehorVare` | ✅ 3 filer |
| Tilbake i frontruteflyten | ✅ `public/app.js` |
| `kontrollerVariant` | ✅ |

## ZZ33141 på staging (etter fiks)

`/api/regnr` → `VERIFY`, **6 kandidater**, alle `5508…` (GLE Coupé). W203 er borte.
`/api/frontrute` uten VIN → **samme 6**. Med og uten VIN gir nå samme svar.

## 616-settet: IKKE gyldig som bevis

- **0 av 616 biler har VIN** i manifestet (`regnr, merke, modell, aar` er alle feltene).
- **0 biler fikk endret år.** Fiksen kan derfor ikke påvirke disse kallene.
- 25 biler fikk likevel andre kandidater. Det skyldes at produksjon og staging har
  **ulike D1-databaser**, ikke kodeendringen. Sammenligningen er derfor forurenset
  og kan ikke brukes som før/etter.

## Årsregelen

Tiårsgrensen er en **plausibilitetsregel**, ikke en kalibrert modell:
- Forkastet VIN-år → faller tilbake til registreringsåret.
- Gjelder bare siffer-grenen (2001–2009). Bokstav-grenen er uendret fordi
  hintet velger mellom 1980- og 2010-syklusen.
- Importbiler (K/hint 2024 → 2019) virker som før.
- Et forkastet VIN-år omtales ikke som sikkert modellår; systemet bruker registreringsåret.

## Hvorfor W203 ble akseptert (eget tiltak, ikke rettet)

```
tokens for «GLE 350 DE 4MATIC COUPE» → ['DE4','GLE','DE','COUPE']
ordTreffKandidat('W203 2D COUPE 01-02 -NB-', tokens) → true
```

`modellTokensAv` beholder karosseriordet COUPE, og `ordTreffKandidat` godtar **ett**
treff. Med feil år (2001) passerte W203 både modell- og årssjekken. Med riktig år
(2021) ville årsvinduet stoppet den. Svakheten er latent, ikke utløsende.

## Gjenstår før produksjon

1. Før/etter på **samme database**: to staging-deploys (basis og fiks) mot samme D1.
2. Testsett **med VIN**: hent VIN for de 499 berikede bilene, ellers prøves ikke feilklassen.
3. Kundereise med utstyrsvisning (tom. 4 i ordren) før samlet «ferdig».
