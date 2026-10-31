# E2E-kundereise, NOK-prising og PR #6 — status

**Dato:** 2026-10-31
**Omfang:** staging. Ingen prod-deploy, ingen prod-D1-skriving, ingen merge,
ingen full katalog-crawl, ingen Pilot100/1000.

---

## Bunnlinje

| Punkt fra godkjenningen | Status | Bevis |
|---|---|---|
| 1. PR #6 renset / isolert | **DELVIS** | 1,45 M linjer fjernet (39 MB generert fil). 76 commits gjenstår — årsak funnet, se under |
| 2. E2E kundereise | **PASS** | 4/4 steg, to kjøringer, inquiry 63 og 64 |
| 3. NOK-prising spesifisert | **PASS** | `src/pricing/nok-prising.ts`, 20 tester, live endepunkt |
| `/api/glass` HTTP 500 | **FIKSET** | HTTP 200 etter resilient spørring |
| Testsuite | **PASS** | 306 tester, 299 pass, 0 fail |

---

## 2. E2E kundereise — verifisert

`scripts/e2e-kundereise-staging.mjs` kjører hele kjeden mot staging og feiler med
eksittkode 1 hvis et steg ikke holder («HTTP 200» alene er ikke bevis).

```
✔ 1. regnr-oppslag      VW TRANSPORTER 2005 · VIN WV1ZZZ7H…
✔ 2. bil → glass        PINPOINT (L0 vin_glass_overrides, 1 kandidat)
                        → 2525GYA «VW TRANSP+CARAVELLE T5 2003-»
✔ 3. glass → pris       5 490 kr (trinn) · listepris 9 980 kr
                        · eurokode 8579AGSGYAVZ1B
✔ 4. kundehenvendelse   inquiryId 64 (HTTP 201)

Resultat: 4/4 steg OK
```

Persistert i staging D1 (`beta_inquiries` 61, 62, 63, 64): `regnr`, `navn`,
`kontakt`, og `vehicle_json` (599 tegn) med frosset bil + resolver-utfall.

### Funn underveis som er verdt å vite

- **Kundereisen er VIN-drevet.** `/api/regnr` gir PINPOINT via `vin_glass_overrides`
  fordi SVV-oppslaget gir VIN. `/api/frontrute` med bare merke/modell/år gir
  FALLBACK med løse treff (VW TRANSPORTER 2005 → 5 kandidater, ingen utfall).
  E2E-skriptet bruker derfor resolver-svaret fra steg 1 — det er den ekte reisen.
- **`/api/glass` returnerte HTTP 500** fordi staging-D1 har en slankere
  `glass_prisliste` uten `typeCode`/`side`. Fikset med en spørring som først
  prøver full kolonneliste og faller tilbake til de som finnes — prod beholder
  `typeCode`/`side` (en hardkodet slank SELECT ville mistet dem i prod).

---

## 3. NOK-prising — spesifisert og testbar

Modell i `src/pricing/nok-prising.ts`, endepunkt
`GET /api/admin/pris-estimat` (Bearer), 20 tester i `tests/nok-prising.test.ts`.

**Kostnadsgrunnlag (eksplisitt):**

| Grunnlag | Kjede | Sikkerhet |
|---|---|---|
| `PRISTLISTE_NOK` | listepris × 0,60 → rund ned til trinn | **BEKREFTET** |
| `SUPPLIER_INVOICE` | fakturakostnad × påslag → rund ned til trinn | **BEKREFTET** |
| `GLAVISTA_SRP_EUR` | EUR × datert kurs | **ESTIMERT** (gir aldri kundepris) |

**Mva brytes UT, legges ikke på.** Trinnprisene er det kunden ser, inkl. mva:
5 490 kr → mva 1 098 kr / eks. mva 4 392 kr. En test låser at kundeprisen aldri
blir 5 490 × 1,25.

**Utenfor trinn = «Spesial».** Over 8 490 eller under 3 990 gir `kundePris: null`
og advarsel `UTENFOR_TRINNSPRIS_SPESIAL` — ikke en gjettet pris.

**Datert valutakurs.** `src/pricing/valutakurs.ts` henter Norges Bank
EXR/B.EUR.NOK.SP (SDMX-JSON) og lagrer **observasjonsdatoen**, ikke hentedatoen.
Kurs eldre enn 7 dager flagges; kurs i fremtiden flagges; ugyldig kurs gir
`MANGLER_VALUTAKURS` i stedet for en gjetning.

**Glavista-priser er ikke i bruk** (Tom 2026-10-31). EUR-veien ligger dormant i
modellen med tester, men er ikke koblet til noe endepunkt eller noen kundepris.
Endepunktet slår bare opp i vår egen prisliste:

```
GET /api/admin/pris-estimat?eurocode=8579AGSGYAVZ1B

prisliste: 2525GYA · «VW TRANSP+CARAVELLE T5 2003-» · 9 980 kr
beregning: BEKREFTET · raa 5 988 → kundePris 5 490
           mva 1 098 · eks. mva 4 392
```

**Regresjonsvern:** en test holder `beregnPris` ekvivalent med `matcher.tierPris`
for prisliste-grunnlag, så prismodulen ikke kan drive fra den etablerte regelen.

---

## 1. PR #6 — hva som var galt, og hva som er igjen

### Renset (gjort)

`data/glass-skus.json` var committet: **39 MB, 1 445 590 linjer** — og det er
generert output fra `scripts/migrate-glass-skus.mjs`, ikke kildekode.

- Regenerering verifisert **byte-identisk** (5 997 SKU-er, `a == b` → `True`)
- Ingen CI-workflow refererer den; eneste leser er `seed-glass-sku-attributter.mjs`
- Nå gitignored, fjernet fra git, og seed-scriptet genererer den selv hvis den mangler

| PR #6 | Før | Etter |
|---|---|---|
| Filer | 102 | 115 |
| Linjer tilført | 1 452 574 | 17 456 |
| Linjer fjernet | 241 | 1 211 |

(Flere filer fordi de tre upushede hovedlinje-commitene og mine fire nå er med i
sammenligningen — men den 1,4 millioner linjer store genererte fila er borte.)

### Årsaken til «74 commits» — og hvorfor det ikke er en feil i branchen

```
origin/main (remote)  b773695  ← 72 commits BAK lokal main
lokal main            d4c0cc1  ← hele produktlinjen, ALDRI pushet
branch HEAD           a530ba6  ← lokal main + 4 commits
```

`git rev-list HEAD..main` = **0**: lokal `main` er ancestor av branchen og kan
fast-forwardes. PR-en ser enorm ut fordi **remote main er 72 commits bak** — hele
produktlinjen (ops, evidence, UI, SKU, migrasjoner) finnes bare lokalt.

Det er ikke 76 urelaterte endringer som skal isoleres; det er produktets historie
som aldri ble pushet til `main`.

### Anbefalt vei videre (krever Tom)

1. Push lokal `main` til `origin/main` (fast-forward, 72 commits) — dette **er** en
   merge til main og krever din godkjenning.
2. Deretter er PR #6 bare de 4 commitene: 2 P1-commits fra tidligere økt + Apify
   + prising/E2E. Det er en oversiktlig review.
3. Alternativ: squash-merge PR #6 som i dag — men da forsvinner 72 commits med
   historikk inn i én commit, og de fire andre draft-PR-ene (#2, #4, #5) blir
   liggende som duplikater og bør lukkes.

**Ingenting er pushet til `main`.** Bare feature-branchen er oppdatert
(`28cdcb3..a530ba6`).

---

## Endrede filer i denne runden

| Fil | Endring |
|---|---|
| `src/pricing/nok-prising.ts` | ny: prismodell med grunnlag, påslag, mva-uttrekk |
| `src/pricing/valutakurs.ts` | ny: Norges Bank-kurs med observasjonsdato (dormant) |
| `src/routes/pris-estimat.ts` | ny: admin-endepunkt for etterprøvbar prising |
| `scripts/e2e-kundereise-staging.mjs` | ny: E2E-kundereise med ekte exitkode |
| `tests/nok-prising.test.ts` | ny: 20 tester |
| `src/discovery.ts` | resilient kolonnevalg (fikser `/api/glass` 500) |
| `scripts/seed-glass-sku-attributter.mjs` | genererer `glass-skus.json` ved behov |
| `.gitignore` | `data/glass-skus.json` |

---

## Gjenstår (krever Tom)

- Push av lokal `main` (72 commits) eller valg av squash-strategi for PR #6
- Lukking av duplikat-PR-er #2, #4, #5
- Merge til `main`, produksjonsdeploy, produksjons-D1
- Full katalog-crawl (4 621 URL-er)
- Pilot100 / Pilot1000
- Glavista-priser i NOK — ikke aktuelt før du sier fra
