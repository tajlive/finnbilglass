# PR #28 — prisregelen rettet + sluttkontroller

**Dato:** 2026-11-04 · **Branch:** `feat/katalogvarianter-20261104`
**Staging:** `d154d6c7-8ceb-4cde-8e93-5f29df937881`
**QA:** 549/549 · **typecheck:** grønn

---

## 1. Prisregelen var feil — rettet

**Feilen:** kundeprisen ble regnet som `listepris × 0,60` og deretter **rundet ned til faste trinn** (3 990 / 5 490 / 6 990 / 8 490). Det ga 5 490 kr for RAV4-varianten som skulle hatt 3 357,81 kr, og varianter over høyeste trinn (8 490) ble sendt til «Pris på forespørsel» uten grunn.

**Gjeldende regel (Tom 2026-10-29):**

```
estimert kundepris inkl. mva = XLS-listepris eks. mva × 0,25 × 1,25
```

Ingen trinn, ingen avrunding til faste priser — bare til nærmeste øre. Prisen er et **ESTIMAT** som kontrolleres manuelt før tilbud.

| Full eurokode | XLS eks. mva | × 0,25 | + 25 % mva | Vises som |
|---|---|---|---|---|
| `8432AGACMV1L` | 10 745 | 2 686,25 | 671,56 | **3 357,81 kr** |
| `8432AGACHMV1L` | 19 425 | 4 856,25 | 1 214,06 | **6 070,31 kr** |
| `8432AGACHMV30` | 14 860 | 3 715,00 | 928,75 | **4 643,75 kr** |

### Hva som er endret

| Fil | Endring |
|---|---|
| `src/pricing/nok-prising.ts` | `estimertKundeprisInklMva()` er nå **eneste** beregningssted. `XLS_RABATT_FAKTOR = 0,25`, `MVA_SATS = 0,25`, `rundTilOre()`. **Fjernet:** `PRISTLISTE_RABATT_FAKTOR (0,6)`, `TRINN`, `tilNaermesteTrinn`, `LAVESTE_SITERBARE_LISTEPRIS`. `beregnPris` gir `ESTIMERT` for prisliste, `BEKREFTET` bare for fakturakostnad (påslag × 1,25, ingen trinn). |
| `src/matcher.ts` | gammel `tierPris()` (0,60 + trinn) fjernet; `tierPris` er nå et deprecated alias for den nye funksjonen slik at eldre kall ikke krasjer. |
| `src/vin-resolver.ts` | kandidatpris = `estimertKundeprisInklMva(listepris)`. |
| `src/discovery.ts` | prisgulvet (6 650) er borte; sortering bruker `MINSTE_GYLDIGE_LISTEPRIS = 1` — rader uten pris sorteres fortsatt bakerst, men ingen varer skjules på grunn av prisstørrelse. |
| `src/public-contract.ts` | `OffentligPris` har `sikkerhet: BEKREFTET \| ESTIMERT`; `offentligPris()` avviser ikke lenger estimater. `prisStatus` skiller nå `ESTIMERT` fra `BEKREFTET`. |
| `public/frontrute-view.js` | «Veiledende fra X kr» → **«Estimert pris X kr»**, `usikker: true`, detaljtekst: «Estimert glasspris inkl. mva (veiledende pris med 75 % rabatt + mva). Endelig pris bekreftes manuelt i tilbudet. Frakt og eventuell montering kommer i tillegg.» Øre vises når de finnes. |
| `src/index.ts` | saksnotatet lagrer nå også **estimert kundepris**, ikke bare listepris. |
| `docs/e2e-kundereise-og-pr6-2026-10-31.md` | rettet med eksplisitt merknad — den dokumenterte 0,60-modellen og ville ellers ført feilen videre. |

### Hvorfor QA var grønn med feil regel

Testene låste den gamle regelen: `tests/matcher.test.mjs` (×0,60 → trinn), `tests/nok-prising.test.ts` (`PRISTLISTE_RABATT_FAKTOR === 0.6`, «kundeprisen er ALDRI trinnpris × 1,25»), `tests/public-contract.test.mjs` (prisgulv 6 650) og `tests/frontrute-view.test.mjs` («Veiledende fra 6 990 kr»). Alle er skrevet om til den nye regelen, med RAV4-tallene som faste verdier.

## 2. Verifisert i alle ledd

| Ledd | Bevis |
|---|---|
| API | `POST /api/frontrute {Toyota, RAV4, 2024}` → tre kandidater med **6 070,31 / 4 643,75 / 3 357,81 kr** |
| Resultatkort | «Estimert pris 6 070,31 kr» + forklaring (skjermbilde, 390 px) |
| Oppsummering | «Ønsket glass: TOYOTA RAV 4 22- FR AKU LDW» + estimat |
| Lagret sak | **sak #40**: `Valgt variant: 8432AGAC:8432AGACMV1L … listepris 10745 eks. mva · estimert kundepris 3357,81 kr inkl. mva · tilhørighet: bekreftet`, `is_test=1` |
| Uten pris | Pris 0/manglende pris gir fortsatt **«Pris på forespørsel»** og aldri PINPOINT |

## 3. Tilbake-flyten — systematisk gjennomgang (390 px)

| Scenario | Resultat |
|---|---|
| RAV4 → Nei → (1 variant) → Endre svar → **Ja** | 2 varianter, 6 070,31 / 4 643,75 kr |
| → Endre svar → **Vet ikke** | 3 varianter (ukjent filtrerer aldri) |
| **Tilbake** fra kandidatsiden | går til rutevalget; Frontrute på nytt gir 3 varianter uten gamle svar |
| **Tilbake** fra kontakt-/oppsummeringssteget | tilbake til kandidatlisten; skjemaet har ingen egen tilbake-knapp (bruker sidens) |
| **Nytt bilsøk** (Audi A5, BR58010) etter valgt variant | 0 RAV4-varianter, ingen «Du svarte», ingen gammel pris |
| Valgt variant når listen endres | `valgteGlass` nullstilles når flere kandidater gjenstår; bare én gjenstående kandidat blir valg |

Ingen skjult gammel variant sendes inn: `variantId` settes kun når nøyaktig én kandidat står igjen, og serveren validerer den mot kandidatsettet (400 ved feil).

## 4. `/ops` — blokkert på Access-innlogging (ikke omgått)

`https://ops-staging.finnbilglass.no/` svarer **302 → Cloudflare Access** («Log in to FinnBilGlass Operations Staging», Google eller e-postkode). Siden er åpnet i Toms egen Chrome-profil; **ingen innlogging er forsøkt utført av meg**.

- **Verifisert på datanivå:** `/api/ops/saker/<key>` rendrer `inquiry.melding`, og radene for #36, #39 og #40 inneholder variant, eurokode, listepris, estimert kundepris, leveringssted og utstyrssvar.
- **Ikke verifisert visuelt:** selve `/ops`-flaten. Krever Toms Access-innlogging (MFA). Admin-rutene er dessuten bevisst sperret på `*.workers.dev` (403), så det finnes ingen alternativ vei — og ingen skal lages.

## 5. Regresjon

117-settet er **ikke** kjørt på nytt: prisendringen påvirker `pris`-feltet, ikke resolver, kandidatsøk eller datagrunnlag. Endrede utfall kan ikke oppstå av prisregelen fordi `pinpointTillatt` bare krever pris > 0, og alle tidligere pris-0-rader er uendret.

## 6. Produksjonsforespørsel (venter på godkjenning)

**Commit:** `feat/katalogvarianter-20261104` (se `git log -1`; siste kodecommit for prisregelen)
**Staging-versjon:** `d154d6c7-8ceb-4cde-8e93-5f29df937881`

**Rekkefølge:**

| Steg | Handling | Kontrollpunkt | Stopp |
|---|---|---|---|
| 0 | Backup: `glass_prisliste_backup_0048` | 29 627 rader | avvik → stopp |
| 1 | `0048_glass_prisliste_variant_id.sql` | 29 627 rader, 29 627 unike `variant_id` | avvik → tilbakeføring |
| 2 | `0048c_variant_id_normalisering.sql` | `v_variant_konflikt` = 15 rader | > 30 → stopp |
| 3 | `variant_upsert_00..02.sql` (1 313 varianter) | **30 940 rader**, RAV4 8/8 | avvik → stopp |
| 4 | `scripts/katalog-avstemming.py` | `bare_kilde = 0`, `bare_prod = 3` | avvik → stopp |
| 5 | Deploy Worker | RAV4 2024 → 3 varianter med 6 070,31 / 4 643,75 / 3 357,81 | feil → rull kode |
| 6 | Én testsak + `/ops` | variant, estimat, leveringssted synlig | feil → rull kode |

**Forventede radtall:** `glass_prisliste` 29 627 → **30 940** (+1 313). `ground_truth` uendret 32 307. `beta_inquiries` får nye rader (testmerket).

**Tilbakeføring (prøvd på isolert kopi):** kode tilbake **først**, deretter data — ny kode mot gammelt skjema feiler på `variant_id` og ville svart 400 «Ukjent variant». Data: legg bort ny tabell og gi `glass_prisliste_backup_0048` navnet tilbake; indeksene fra 0002/0007/0032. Saker som nevner nye varianter forblir lesbare fordi variant og pris ligger som tekst i saken.

**Ikke nødvendig:** skrivestans. Vinduet mellom steg 1 og 3 er under ett minutt; unngå innsendinger i det.

## 7. Gjenstår

1. **Visuell `/ops`-kontroll** — venter på Toms Access-innlogging (siden ligger åpen).
2. **318 frontruter uten pris** — vises som «Pris på forespørsel», kan ikke bli gratis eller PINPOINT. Leverandørliste klar, ikke sendt.
3. **3 junk-rader** i prod — ryddes separat.
4. **GT lagrer varenr** — PINPOINT krever nøyaktig én variant for bilens år.
