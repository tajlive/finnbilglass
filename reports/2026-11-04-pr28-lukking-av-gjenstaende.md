# PR #28 — lukking av de tre gjenstående punktene

**Dato:** 2026-11-04 · **Branch:** `feat/katalogvarianter-20261104`
**Staging:** `c592d92b-132b-4b43-8ece-0c0a278315cd`
**QA:** 549/549 · **typecheck:** grønn

---

## 1. Visuell kontroll i `/ops` — venter på Access-innlogging

`https://ops-staging.finnbilglass.no/` er åpnet i Toms Chrome og står på Cloudflare Access
(«Log in to FinnBilGlass Operations Staging» — Google eller e-postkode). Siden er kontrollert
på nytt etter siste deploy: **fortsatt ulogget**. Ingenting er omgått; admin-rutene er i
tillegg bevisst sperret på `*.workers.dev` (403).

**Klar til å kjøres i det øyeblikket innloggingen er gjort** (én kommando per sak):

| Sak | Skal vise |
|---|---|
| #36 (mobil, eldre) | `TOYOTA RAV 4 22- FR AKU LDW`, `8432AGAC` / `8432AGACMV1L`, leveringssted Trondheim, utstyrssvar `{"oppvarmet":"nei"}`, **historisk prisgrunnlag: listepris 10 745 (uten estimatfelt)** |
| #39 (desktop, eldre) | samme variant; historisk notat uten estimat |
| #40 (ny) | **estimert kundepris 3 357,81 kr inkl. mva**, listepris 10 745 eks. mva, `tilhørighet: bekreftet` |
| #41 (ny, eksplisitt valg) | `8432AGACHMV30`, estimert 4 643,75 kr, «WS GN ACO LDW» |

Eldre saker endres ikke: notatet er append-only tekst, og estimatfeltet ble innført
2026-11-04. Det er verifisert på datanivå (D1) for alle fire.

## 2. Priskontroll på hele katalogen + 117-settet

### 2a. Invariant for alle rader (nytt verktøy `scripts/pris-invariant-sjekk.mjs`)

| Måling | Resultat |
|---|---|
| Rader kontrollert | **30 937** |
| Positive XLS-priser | **26 703** |
| Uten pris (NULL/0) | **4 234** |
| Faktor | **0,3125** (0,25 × 1,25) |
| Avvik fra `listepris × 0,3125` avrundet til øre | **0** |
| Avvik der pris mangler men likevel vises | **0** |
| Avvik i mva + eks. mva = kundepris | **0** |
| `sikkerhet` ikke `ESTIMERT` for XLS-pris | **0** |

Verktøyet kan kjøres på nytt: `node --import tsx scripts/pris-invariant-sjekk.mjs [dump.json]`.

### 2b. Fitment-utfall på 117 biler etter prisendringen

| | Før prisendring | Etter |
|---|---|---|
| PINPOINT | 15 | **15** |
| VERIFY | 78 | **78** |
| FALLBACK | 24 | **24** |
| Kandidater totalt | 291 | **291** |
| Endrede fitment-utfall | – | **0** |
| Tekniske feil | 0 | **0** |
| Latens | – | p50 **339 ms**, p95 **1 074 ms**, maks 1 353 ms |

Prisendringen påvirker bare `pris`-feltet; `pinpointTillatt` krever fortsatt pris > 0, og
ingen rad har fått eller mistet pris. Begrunnelsen for å hoppe over hele settet var for
snever — nå er det faktisk kjørt, og likheten er målt, ikke antatt.

## 3. Flere kandidater — eksplisitt valg og automatisk valg

**Før:** «Velg dette glasset» fantes bare i glassliste-flyten (dør/bak/ventil), ikke på
frontrute-siden. Der var det ingen måte å peke på en bestemt av flere viste varianter.

**Nå:** hver frontrute-kandidat har en egen knapp:

- Hovedkortet og hver rad under «Andre mulige varianter» har **«Velg dette glasset»**.
- Valgt rad merkes **«Valgt»** (`aria-pressed=true`) og følger oppsummering, innsending og sak.
- **Automatisk valg** beholdes: gjenstår nøyaktig én kandidat, er den valgt uten klikk.
- **Eksplisitt valg vinner** så lenge varianten er blant de synlige kandidatene. Forsvinner
  den fra listen (nytt svar, nytt søk eller endret kandidatsett), nullstilles valget — ingen
  skjult gammel variant kan sendes inn.
- Et nytt utstyrssvar nullstiller et tidligere eksplisitt valg, fordi grunnlaget er endret.
- Serveren validerer fortsatt `variantId` mot bilens kandidatsett (400 ved feil).

**Målt (390 px, 3 varianter):** 3 knapper · klikk på nr. 2 → «Valgt» · innsending
`variantId = 8432AGAC:8432AGACHMV30` · **sak #41** med «TOYOTA RAV 4 22- WS GN ACO LDW».
Automatisk valg verifisert separat: svar «Nei» → én kandidat → innsending uten klikk
(sak #40, `8432AGACMV1L`, 3 357,81 kr).

## 4. Produksjonsplanen kontrollert mot samme commit

Rehearsal kjørt på nytt fra **HEAD-artefaktene** (samme filer som skal publiseres):

| Steg | Fil (sha256, 16 tegn) | Rader etter |
|---|---|---|
| 0 | prod-kopi | 29 627 |
| 1 | `0048_glass_prisliste_variant_id.sql` (`a9b780da203eb187`) | 29 627 · 29 627 unike `variant_id` |
| 2 | `0048c_variant_id_normalisering.sql` (`4fcd2a09892dcc5f`) | 29 627 · konflikter **15** |
| 3 | `variant_upsert_00` (`67561f8a6cf93a13`) | 30 125 (+498) |
| 4 | `variant_upsert_01` (`9ea1d949e6dcb875`) | 30 625 (+500) |
| 5 | `variant_upsert_02` (`77f2482f0cd6356b`) | **30 937** (+312) |
| 6 | RAV4 `8432AGAC` | **8 varianter** |
| 7 | tilbakeføring (legg bort ny tabell, gi backupen navnet tilbake) | **29 627** |

**Korrigert radtall:** 29 627 → **30 937** (+1 310), ikke 30 940 (+1 313). De tre rader som
ikke settes inn er identiske duplikater som `ON CONFLICT(variant_id) DO NOTHING` fanger —
det er samme mekanisme som gir 15 konflikter i `v_variant_konflikt`. Tallet i den forrige
rapporten var en sum av forsøkte rader, ikke faktisk innsatte.

**Tilbakeføringsrekkefølge (uendret, prøvd):** kode tilbake **først**, deretter data.
Ny kode mot gammelt skjema feiler på `variant_id` (fanges, men gir 400 «Ukjent variant» for
varianter som forsvant). Saker laget i mellomtiden forblir lesbare fordi variant og pris
ligger som tekst i saken.

## 5. Gjenstår

1. **`/ops`-visuell kontroll** — krever Toms Access-innlogging (siden ligger åpen).
2. 318 frontruter uten pris — «Pris på forespørsel», aldri PINPOINT, leverandørliste ikke sendt.
3. 3 junk-rader i prod — ryddes separat.
4. GT lagrer fortsatt varenr — konservativ PINPOINT-regel.
