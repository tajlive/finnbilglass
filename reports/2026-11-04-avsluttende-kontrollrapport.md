# Avsluttende kontrollrapport — måling, regresjon, nettlesermatrise

**Dato:** 2026-11-04 · **Commit:** `HEAD` etter denne runden · **Staging:** `c2acda6c-3a9e-4fd9-9b45-0d923ab10b8a`
**Produksjon:** urørt (`cbdc2cf2`)

---

## 1. Før/etter — nå med ekte kode, ikke emulering

Forrige måling var ugyldig. `gammelKandidat()` delte `varenavn` på mellomrom, så
`SED+STV` ble stående som ett ord og aldri fjernet — den simulerte «før» beholdt
feilen vi skulle måle.

**Rettet:** `scripts/_old/glass-valg-OLD.ts` er den faktiske filen fra `dfbc86b`
(git blob `d8d70cfc…`), med uendret logikk. Begge byggere kjøres mot **identiske
frosne kandidatdata** (`reports/valgtre-kandidater-frosset-20261104.json`,
SHA-256 `eda1188f…`). Sammenligningen dekker hele valgstien: stier, alternativer,
automatiske verdier og kandidatantall per node.

| Måling | Verdi |
|---|---|
| Manifest | `data/finn-100.jsonl` — **110 biler** (SHA-256 `d407e6dc…`) |
| Biler med kandidater | 21 |
| Uendret | **101** |
| Endret | **9** |
| Stier før / etter | 310 / 310 |

**De 9 endrede bilene** (alle i karosserigrener):

| Bil | Endring |
|---|---|
| BMW 116i 2015 | `body=cabriolet` 3 → 2 kandidater, `auto` får `body` |
| BMW 320d 2008 | `cabriolet` 3 → 2, `coupe` 4 → 3 / 5 → 4 |
| Toyota Corolla 2023 (×2) | `body=suv` 4 → 3 (venstre), 5 → 3 (høyre) |
| Toyota Corolla Cross 2024 (×5) | samme mønster |

**Retning:** færre kandidater i grener raden *ikke* dokumenterer (en `SED+STV`-rad
ble før tilbudt som cabriolet/SUV-alternativ fordi dens karosseri ble behandlet som
ukjent), og mer autofyll der alle gjenværende er enige. Ingen bil fikk nye,
udokumenterte alternativer.

## 2. Baseline og regresjonstilfeller

Manifestet har **110 biler**. De 7 som mangler til 117 er ikke samlet inn og ikke
erstattet. Fire navngitte regresjonstilfeller er lagt til i `tests/glass-valg.test.mjs`
og merket som **konstruerte** — de er ikke uavhengige fasitbiler:

| Test | Låser |
|---|---|
| `regresjon: «begge sider» (VS+HS)` | sidevalg vises når VS+HS dokumenterer begge |
| `regresjon: SED+STV …` | begge karosserier dokumenteres, ukjent dokumenterer ingen |
| `regresjon: ukjent plassering` | tilbys aldri som valg, telles |
| `regresjon: kildekonflikt` | gir aldri autofylt side |

**Kandidatidentitet i målingen:** valgtreet eksponerer ikke kandidat-ID-er, bare
antall per node. Målingen rapporterer derfor antall, ikke ID-er, og bruker aldri en
syntetisk nøkkel som kan slå sammen ulike varianter. Manglende `variantId` telles
som `varenr:eurokode` og merkes som manglende identitet.

## 3. Nettlesermatrise

| Flyt | Desktop 1280 | Mobil 390 |
|---|---|---|
| Bilsøk → valgtre | ✅ RAV4 2024 | ✅ RAV4 2024 (overflow 0) |
| Svar → filtrering | ✅ «Ja»: 2 oppvarmede (6 070,31 / 4 643,75) | ✅ «Nei»: 1 (3 357,81) |
| Endre svar | ✅ → «Nei» → 3 357,81 | ikke kjørt |
| Vet ikke | ✅ 3 varianter (filtrerer ikke) | ikke kjørt |
| Tilbake | ✅ tilbake til kandidatlisten | ikke kjørt |
| Nytt bilsøk | ✅ alt nullstilt, ny bil Golf 2006 → 28 varianter | ✅ nullstilt |
| Eksplisitt variantvalg → innsending | ✅ sak #44 | ✅ **sak #46** |
| /ops | ✅ #44 | ✅ #46 (via DB) |

**Ny kopi verifisert live:** «28 **mulige glassvarianter** for denne bilen» og
«9 **mulige frontruter**» — kandidatmatching kalles ikke lenger dokumentert passform.

## 4. Salgsenhet presisert

| Kildeord | Produkttype | Verdi |
|---|---|---|
| PAR / 2-PAK | glass | **`par`** — dokumentert to glass |
| SETT | glass | **`sett`** — antall glass ikke dokumentert |
| V+H / VS+HS | glass | `ukjent` — sidedekning |
| ingen markering | glass | `ukjent` — ingen kildeopplysning |
| PAR/SETT | list/tilbehør | `ukjent` — ikke glasspar |

Ingen prisdeling; XLS-prisregelen er urørt.

## 5. Hva kontrollen beviser

Saksnotatet sier nå **«svar samsvarer med registrerte produktegenskaper (ikke fysisk
passform)»** i stedet for «bekreftet». Ukjent informasjon lagres som
`bekreftet_bil_ukjent_plassering`.

**Om versjonsbevis:** notattekst viser at den aktuelle kodeveien ble kjørt, men er
ikke eksakt versjonsbevis. Forskjellen mellom #42 og #43 er *sannsynlig* forklaring
på ulike deployversjoner, ikke bevis. Eksakt versjon er nå bekreftet separat via
`wrangler deploy` sin versjons-ID (`c2acda6c…`).

## 6. Tilstand

| | |
|---|---|
| QA | **595/595** |
| tsc | grønn |
| Uavhengig dokumenterte fasitpar | **2** (SU18018 PROVISIONAL, AJ95429 AMBIGUOUS) — 20 er ikke etablert |
| Staging | `c2acda6c-3a9e-4fd9-9b45-0d923ab10b8a` |

**Konkrete feil som fortsatt hindrer produksjon:**

1. `0047` (`glass_typekode`) er ikke kjørt i produksjon — plasseringsdata finnes bare i staging.
2. 15 variantkonflikter (`varenr` + eurokode med ulikt navn) er ikke avklart med leverandør.
3. Bare 2 uavhengige fasitpar — for tynt til å hevde dekning.
4. `det vises «TOYOTA RAV 4 22-» som produktnavn` — kosmetisk, men kunden ser katalogspråk.
