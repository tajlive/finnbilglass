# Servervalidering og stagingverifisering — status

**Dato:** 2026-11-04 · **Branch:** `copy/kvittering-20261103` (pushes til `feat/katalogvarianter-20261104`)
**Staging:** `6817b203-7de4-4b6c-a08c-d4e34c3ec205` · **Produksjon:** urørt (`cbdc2cf2`)

---

## 1. Serverkontroll av valgt variant — levert

Ny `src/glass-variant-kontroll.ts` bruker **samme** feltvurdering som valgtreet
(`posisjonFeltVerdier` + `vurderFelt`), så skjerm og server ikke kan bli uenige.

`kontrollerVariant(rad, svar)` gir tre utfall:

| Utfall | Betydning | HTTP |
|---|---|---|
| `avvist` | dokumentert motstrid (side, dør, plassering, karosseri, utstyr) | 400 med forståelig tekst |
| `ukjent` | minst ett felt er ukjent | lagres, men som `bekreftet_bil_ukjent_plassering` — **aldri** bekreftet passform |
| `bekreftet` | alle sjekkbare felt støtter svaret | lagres med kontrollnotat |

`/api/inquiry` kaller kontrollen **før** lagring og skriver notatet på saken.

### Målt i staging (curl)

| Test | Resultat |
|---|---|
| Riktig bil + feil side (`2481LYPS4` er dokumentert venstre, kunden valgte høyre) | `400` «Du valgte høyre side, men denne varen er dokumentert som venstre…» |
| Feil dørledd (varen er bakre, kunden valgte fremre) | `400` «Du valgte fremre dørrute, men denne varen er dokumentert som bakre…» |
| Pyntelist som variant (`2735PYKIT`) | `400` «Valgt vare er ikke et glass…» |
| Riktig side | `201`, notat «kontroll: bekreftet mot kundens svar» |

**Merk:** første forsøk på feil-side-testen ga `201`. Årsak var Cloudflare-deployforsinkelse — forespørselen traff forrige versjon (sak #42 mangler kontrollnotatet, mens #43 har det). Testen ble kjørt på nytt etter propagering og ga korrekt `400`. Sak #42 er en artefakt fra gammel kode.

## 2. Plassering skilles fra pakkeinnhold — levert

`rad_type` er **upålitelig**: `2735PYKIT «PYNTELIST KIT V+H»` står som `glass` i produksjonsbasen. Derfor klassifiseres produkttype nå fra navn og varenr:

| Funksjon | Regel |
|---|---|
| `produkttype()` | `list`/`tilbehor`/`glass` — fanger PYNTELIST, PYLIST, YTTERLIST, KLIPS, PAKNING, `PY`/`GU`-varenr |
| `salgsenhet()` | `par` bare ved uttrykkelig PAR/SETT; `V+H` gir **`uklar`** med grunnlag «sidedekning, ikke bekreftet pakkeinnhold»; ellers `enkel` |

Salgsenhet skrives på saken (`· salgsenhet: enkel (…)`). Settepris deles aldri automatisk, og et sett fremstilles ikke som ett venstre glass.

## 3. Karosseri — mekanisme, ikke automatikk

`dokumentertKropp` er en **inngang** i `byggValgTre`, ikke automatisk gjenkjenning. SVV-svaret vi leser (`src/svv.ts:89`) har `merke`, `handelsbetegnelse` og `rFarge` — **ingen karosseritype**. Karosseri utledes derfor fortsatt ikke fra modellnavn; i praksis kommer det fra kundens svar til en dokumentert kilde kobles inn.

## 4. Staging: komplett reise gjennomført

`DS 30475` → Toyota RAV4 2024 → valgtre (Frontrute 4 · Dørrute 2 · Bakrute 2 · Ventilrute 2 = 10 dokumenterte glass) → Frontrute → 3 varianter (6 070,31 / 4 643,75 / 3 357,81) → svarte **Nei** → valgte 3 357,81 → skjema → **sak #44**.

Lagret på saken:

```
Valgt variant: 8432AGAC:8432AGACMV1L «TOYOTA RAV 4 22- FR AKU LDW»
listepris 10745 eks. mva · estimert kundepris 3357,81 kr inkl. mva
tilhørighet: bekreftet_bil_ukjent_plassering · kontroll: side
salgsenhet: enkel (ingen par-markering i varenavn)
```

`/ops` viser samme data (skjermbilde `reports/staging-verifisering/sak-44.png`). At side står som *uavklart* er korrekt: frontruten har ingen dokumentert side, og saken lagres derfor ikke som bekreftet passform.

## 5. QA

| Måling | Verdi |
|---|---|
| QA totalt | **580/580** |
| Nye tester denne runden | **13** (`tests/glass-variant-kontroll.test.mjs`) |
| tsc --noEmit | grønn |

Testdekning per fil er innarbeidet i `qa`-kjeden (nytt script `test:glass-variant-kontroll`), slik at filen faktisk kjøres — feilen fra forrige runde er ikke gjentatt.

## 6. Ikke fullført i denne runden

| Punkt | Status |
|---|---|
| 117-bilers før/etter på samme manifest | **Ikke kjørt.** Krever to bygg (før/etter) og ~117 kall per bygg mot resolver + valgtre. `scripts/pilot-kjoring.mjs` kaller `/api/regnr` med `lookupOnly` og måler ikke kandidater/spørsmål — eget målescript må skrives før sammenligningen kan gjøres |
| ≥20 dokumenterte fasitpar | Ikke etablert. Historisk finnes 2 fasitbiler (SU18018 PROVISIONAL, AJ95429 AMBIGUOUS); ingen nye uavhengige par er etablert i denne runden |
| Mobil/desktop full matrise (endre svar, tilbake, nytt søk, sett vs enkeltglass) | Bare desktop-reisen over er kjørt |
| Produksjon | Ikke satt, per instruks |
