# PR #28 — sluttverifisering før produksjonsgodkjenning

**Dato:** 2026-11-04 · **Branch:** `feat/katalogvarianter-20261104` · **Staging:** `c86cd71b-b0cf-4df9-bf94-114fa73cdde3`
**Forrige rapport:** `reports/2026-11-04-katalogvarianter-produksjonsplan.md` (pkt. 1–12)

---

## 1. Utstyrsspørsmålet — rettet

**Feil:** spørsmålsboksen ble beregnet på **alle** kandidater, ikke på dem som gjenstod etter kundens svar. Et besvart spørsmål ble derfor stående selv når én variant gjenstod (målt: «Har bilen oppvarmet frontrute?» kom tilbake etter at kunden svarte «Nei»).

**Retting (`public/app.js`):**
- `renderFrontruteSporsmaal` regner nå spørsmålene på `filtrerPaaSvar(state.frontruteKandidater, frontruteSvar)` — altså de gjenstående kandidatene.
- Når ingen spørsmål skiller lenger: boksen erstattes av en kvitteringslinje **«Du svarte: Har bilen oppvarmet frontrute? – nei. Vi kontrollerer valget før tilbud.»** med knappen **«Endre svar»** (nullstiller svarene og viser spørsmålene igjen).
- `settBilFraSvv` nullstiller `frontruteSvar`, `valgteGlass`, `state.frontruteKandidater` og `state.profil`, og skjuler forespørselsskjema/kvittering ved **nytt bilsøk**.

**Målt i nettleser (390 px og 1280 px):**

| Handling | Resultat |
|---|---|
| Utgangspunkt | 3 varianter, spørsmål vist |
| Svar **Nei** | 1 variant · kvitteringslinje · «Endre svar» |
| **Endre svar** | spørsmål tilbake · 3 varianter |
| Svar **Vet ikke** | 3 varianter (filtrerer aldri) · spørsmål står |
| Svar **Ja** | 2 varianter · kvitteringslinje |
| Nytt bilsøk | ingen gamle svar, ingen valgt variant, skjema skjult |

---

## 2. Sammenhengende kundereise

Gjennomført ende-til-ende på **mobil 390 px** (sak #36) og **desktop 1280 px** (sak #39), med syntetisk navn «Testkunde Hermes» og testpostkasse `tomarnejensen+fbgtest@gmail.com`:

søk (DS 30475) → rutevalg → frontrute → utstyrsspørsmål → variantvalg → oppsummering → innsending → bekreftelse.

**Sak #36 (mobil) — lagret i `beta_inquiries`:**

```
Valgt variant: 8432AGAC:8432AGACMV1L (8432AGAC / 8432AGACMV1L)
  «TOYOTA RAV 4 22- FR AKU LDW» listepris 10745 · tilhørighet: bekreftet
Glassvalg: {"kind":"windshield"}
Kontaktmåte: e-post
Ønsket glass: 8432AGAC TOYOTA RAV 4 22- FR AKU LDW
Ønsket leveringssted: Trondheim
Kundens utstyrssvar (må kontrolleres): {"oppvarmet":"nei"}
```

`is_test = 1` (navn som starter med «Test» markerer saken — regel utvidet i denne runden), status `NEW`, regnr `DS 30475`.
**Payload som faktisk ble sendt:** `{variantId: "8432AGAC:8432AGACMV1L", bil: {merke:"TOYOTA", modell:"TOYOTA RAV4", aar:2024}, glassRequest:{answers:{oppvarmet:"nei"}}}`.

**Sak #39 (desktop):** samme kjede, `Ja` → 2 varianter → `Endre svar` → `Nei` → 1 variant → innsending. Payload identisk.

**Konsistenskontroll (kandidat → oppsummering → sak):**

| Felt | Kandidatkort | Oppsummering | Lagret sak |
|---|---|---|---|
| Produktbeskrivelse | TOYOTA RAV 4 22- FR AKU LDW | samme | samme |
| Varenr | 8432AGAC | 8432AGAC | 8432AGAC |
| Full eurokode | 8432AGACMV1L (via variantId) | ikke vist (Tom 2026-10-31: eurokode vises ikke til kunde) | 8432AGACMV1L |
| variantId | 8432AGAC:8432AGACMV1L | sendes med | lagret i notatet |
| Prisstatus | «Veiledende fra 5 490 kr» | samme | listepris 10 745 (intern) |
| Leveringssted | – | Trondheim | Trondheim |

**Teknisk forutsetning som måtte på plass:** `/api/frontrute` projiserte bort alt unntatt `varenr/varenavn/pris/attributter`, så klienten kunne ikke sende variant. `variantId` er nå med i den offentlige projeksjonen (`src/public-contract.ts`), mens **eurokode og listepris fortsatt er interne** (uendret Tom-beslutning).

### /ops — status

Saken er **verifisert lesbar på datanivå**: `/api/ops/saker/inquiry-36` rendrer `inquiry.melding`, og raden i `beta_inquiries` inneholder variantnotatet over.
**HTML-flaten `/ops` er ikke åpnet:** `ops-staging.finnbilglass.no` svarer **302** (Cloudflare Access-login med MFA), og admin-rutene er bevisst sperret på `*.workers.dev` (**403 «Admin-ruten er ikke tilgjengelig fra dette domene»**). Gjenåpning i selve grensesnittet krever Toms Access-økt eller et Access service-token.

---

## 3. Beløpet 5 490 kr — dokumentert

| Ledd | Verdi |
|---|---|
| Variant | `8432AGAC:8432AGACMV1L` — «TOYOTA RAV 4 22- FR AKU LDW», merknad «IKKE ELEKTRISK ENDRET» |
| Kildepris (listepris i `glass_prisliste`) | **10 745 kr** |
| Kundeformel (`tierPris`, `src/matcher.ts`) | `listepris × 0,6 = 6 447` → nærmeste tier ≤ 6 447 |
| Tiers | `[3 990, 5 490, 6 990, 8 490]` |
| Resultat | **5 490 kr** |
| Betegnelse | «Veiledende fra» — tierpris er veiledning, ikke bekreftet tilbud |

De to andre variantene viser **«Pris på forespørsel»** av samme grunn: 19 425 × 0,6 = 11 655 og 14 860 × 0,6 = 8 916, begge **over høyeste tier (8 490)** → `null`. Beløpet tilhører altså riktig variant, og prisbetegnelsen er korrekt.

---

## 4. Avvikstester (staging, HTTP målt)

| Test | Resultat |
|---|---|
| a) Ukjent `variantId` (`9999XXXX:9999XXXXXX`) | **400 «Ukjent variant»**, ingen sak |
| b) Variant fra annen bil (VW ID.3-rute med RAV4-bil) | **400 «Valgt variant tilhører ikke denne bilen»** |
| c) Manipulert pris (`pris:1, listepris:1` i forespørselen) | **201**, men lagret notat viser DB-listepris **10 745** — klientpris ignoreres helt |
| d) Kandidat uten pris (`2300AGAC:2300AGACMUVZ1L`) | **201**, notat: «listepris **ukjent** · tilhørighet: **ikke_verifisert**» — vises aldri som gratis |
| e) Eldre sak uten `variantId` (sak #35) | **201 tidligere**, lesbar i dag, uten variantnotat — ingen tilfeldig variant tilordnet |

---

## 5. Tallforklaringen — måleenheter skilt

To ulike måleenheter ble blandet i forrige rapport. Presisering:

| Tall | Måleenhet | Hva det betyr | Spørring/fil |
|---|---|---|---|
| **26 023** | unike **eurokoder** | distinkte eurokoder i XLS | `katalog-uttrekk.py` → `unike_eurokoder` |
| **24 753** | unike **eurokoder** | distinkte eurokoder i prod | `SELECT count(DISTINCT upper(trim(eurokode))) FROM glass_prisliste WHERE eurokode IS NOT NULL AND trim(eurokode) <> ''` |
| **1 270** | **eurokoder** | 26 023 − 24 753 | ren differanse |
| **1 271** | **eurokoder** | eurokoder som finnes i XLS men ikke i prod | `eurokoder_bare_kilde` |
| **1** | **eurokode** | eurokode i prod som ikke finnes i XLS | `eurokoder_bare_prod` |
| **1 275** | **produktvarianter** | varianter (varenr+eurokode) hvis eurokode ikke finnes i prod i det hele tatt | `tapte_varianter.aarsaker.eurokode_finnes_ikke_i_prod` |
| **29** | **produktvarianter** | varianter hvis eurokode finnes, men under et annet varenr | `eurokode_finnes_under_annet_varenr` |
| **9** | **produktvarianter** | varianter uten eurokode som manglet | `uten_eurokode` |
| **1 313** | **produktvarianter** | summen 1 275 + 29 + 9 = antall nøkler importert | `bare_kilde` |
| **1 325** | **produktvarianter** | nye i staging etter at normaliseringen ble lik (12 nøkler byttet form) | `import.nye_varianter_i_staging` |

**Regnestykket går i null:** 1 270 eurokoder = 1 271 (bare kilde) − 1 (bare prod).
Varianttallene (1 275 / 29 / 9 / 1 313) er en **annen måleenhet** og kan ikke trekkes fra eurokodetallene.

---

## 6. De tre junk-radene

| Varenr | Varenavn | Eurokode | `rad_type` |
|---|---|---|---|
| `Prisliste sortert etter varenr` | (tom) | – | tilbehor |
| `AUTOGLASS AS` | (tom) | – | tilbehor |
| `Varenr` | `Varenavn` | `Eurokode` | **glass** |

**Hvorfor ugyldige:** de er rapportens tittel-, firma- og kolonneoverskriftslinjer som den opprinnelige importen behandlet som produkter.

**Kan de nå kundesøk?**
- `ground_truth`-referanser til dem: **0** (`SELECT count(*) … IN ('VARENR','EUROKODE','AUTOGLASS AS','PRISLISTE SORTERT ETTER VARENR')` → 0). Ingen bil peker dit.
- `/api/glass/kandidater` for RAV4 2024: 4 kandidater, **0 junk**.
- Resolveren slår opp eksakt `varenr`/`eurokode`, så de kan bare nås ved å skrive nøyaktig «VARENR»/«EUROKODE».

**Beslutning:** ingen sletting i denne releasen (ikke nødvendig for riktig glass). Foreslått som egen, avgrenset ryddejobb med backup.

---

## 7. Kontroller etter rettingen

| Kontroll | Resultat |
|---|---|
| `npm run typecheck` | grønn |
| `npm run qa` | **549/549 PASS**, exit 0 |
| Nettleser, mobil 390 px | full reise, sak #36, alle spørsmålsvarianter testet |
| Nettleser, desktop 1280 px | full reise, sak #39, Ja → Endre svar → Nei |
| 117-bilerssettet | **ikke kjørt på nytt** — resolver, kandidatsøk og datagrunnlag er uendret; endringene er UI, `variantId` i projeksjonen (nytt felt) og testmarkering. Forrige kjøring: PINPOINT 15 / VERIFY 78 / FALLBACK 24, 0 tekniske feil |

---

## 8. Gjenstår / blokkeringer

**Lukket i denne runden:** UI-feilen med gjenværende spørsmål (verifisert i begge bredder) og uprøvd innsending (sak #36 og #39, ende-til-ende).

**Gjenstår:**
1. **`/ops`-grensesnittet** er ikke åpnet — Access-MFA (302) og bevisst sperre på workers.dev (403). Krever Tom eller service-token. Datanivået er verifisert.
2. **318 frontruter uten pris** (90 nye): håndteres som «Pris på forespørsel», kan ikke bli PINPOINT og aldri 0 kr. Trenger leverandørsvar; listen ligger i `reports/pris0-frontruter-20261104.csv` (ikke sendt).
3. **GT lagrer varenr** — konservativ regel (PINPOINT kun ved nøyaktig én variant for bilens år). Leverandørbekreftelse mangler; RAV4-sperren står.
4. **3 junk-rader** i prod — ryddes separat.
5. **`Tilbake`-knappen i frontrute-steget** er ikke systematisk prøvd (den finnes og svarer, men hele sti-sekvensen er ikke gjennomgått).

**Produksjon venter på godkjenning.** Planen i `reports/2026-11-04-katalogvarianter-produksjonsplan.md` pkt. 10 gjelder uendret, med tillegg: etter steg 5 skal sak #36/#39-mønsteret gjentas mot prod-staging, og `/ops`-åpning inngår i kontrollpunkt 6.
