# V6.2 — posisjonsfilter: målte resultater

Alle tall er hentet fra faktiske kjøringer mot staging 2026-11-02. Ingen anslag.

## 1. Bulk-skann

| Måltall | Resultat |
|---|---:|
| Koblede prislisterader (forventet) | 14 793 |
| Analysert | **14 793** |
| Avvik | **0** |
| Uten konflikt | 5 376 (36,34 %) |
| Typekonflikt | **84** (0,57 %) |
| Eurokodekonflikt | 5 (0,03 %) |
| Front/bak-konflikt | 5 (0,03 %) |
| Ventil/dør-konflikt | **0** |
| Ukjent typekode | **0** |
| Ikke-glass (lister/klips) | 27 (0,18 %) |
| Usikker fysisk side (styretype ukjent) | **9 296** (62,84 %) |

Ekte konflikter: **94 rader (0,64 %)**. Resten er enten rene eller uavklarte —
ikke feil.

## 2. Hva som faktisk endret seg i koden

| Endring | Effekt |
|---|---|
| `utfallFor()` kan ikke lenger returnere EXACT | Katalogsøk gir maks PROVISIONAL |
| `handleGlassValg()` avviser EXACT fra klienten | Lagres som PROVISIONAL med merknad når evidens mangler |
| `fraTypekode()` antar ikke lenger venstrestyring | `fysisk_side = null` + `fysisk_side_krever_avklaring = true` |
| Karosseritype setter ikke lenger dørledd | `dorLedd = null` uten typekode |
| `typekodeKonflikt` i resultat og API | 94 rader kan ikke lenger se «rene» ut |
| Katalogfilter (klasse, side, dørledd, ventil, siderute) | Filtrering skjer i SQL før LIMIT |
| Fallback uten typekodetabell | Katalogsøk virker også i produksjon før migrering |

## 3. EXACT før/etter

| Flate | Før | Etter |
|---|---|---|
| Katalogsøk, 1 treff med pris + egenskaper | `EXACT` | `PROVISIONAL` |
| Katalogsøk, flere treff | `AMBIGUOUS` | `AMBIGUOUS` |
| Manuelt glassvalg med `utfall=EXACT` | akseptert som EXACT | lagret som PROVISIONAL uten serververifisert evidens |
| Kundesøk (resolver) | uendret policy | uendret policy |

**Falske EXACT i regresjonstester: 0** (testen «katalogsøk kan aldri gi EXACT»
feiler hvis noen gjeninnfører den kodeveien).

## 4. Hva som IKKE er målt, og hvorfor

**Resolverfilter: ingen målt effekt.** `prisKandidat()` i `vin-resolver.ts` slipper
bare gjennom frontruter (`erFrontrute`-sjekken på linje 205), og salgspolicyen er
fortsatt frontrute-only. Det finnes derfor ingen dør-, ventil- eller siderutekandidater
i resolveren å filtrere bort. Filterfunksjonen `filtrerPaPosisjon()` er skrevet og
enhetstestet, men har foreløpig null kandidater å virke på.

Det er en ærlig måling, ikke en implementering: verdien av posisjonsfilteret ligger
i Admin og katalogsøket nå, og i resolveren først når flere glasstyper blir salgbare.

**Admin-visning: ikke visuelt verifisert.** Feltene er i API-et og i UI-koden,
men staging-innlogging blokkerer ende-til-ende-test i nettleser.

## 5. Teststatus

| Suite | Resultat |
|---|---|
| `npm run test:typekode` | 15 tester, 15 pass |
| `npm run qa` | se sluttrapport |
| `npx tsc --noEmit` | 0 feil |
| Bulk-skann | 14 793 / 14 793 analysert |

## 6. Produksjon

Uendret. `glass_prisliste` 29 627 rader, `glass_catalog` 33 215 rader,
ingen `glass_typekode`-tabell. Ingen produksjonsimport, ingen produksjonsdeploy.
