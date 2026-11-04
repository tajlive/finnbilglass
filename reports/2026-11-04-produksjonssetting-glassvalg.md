# Produksjonssetting — glassvalg og serverkontroll (2026-11-04)

**Produksjons-URL:** https://finnbilglass.no
**Deployversjon:** `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d`
**Commit:** `e03d5ec` (tag `release/glassvalg-20261104`) + sluttfiks for utstyrskontroll
**Rollbackmål:** `cbdc2cf2-5885-48b6-93bb-3f424456a9ef`

---

## 1. Produksjonsavhengigheten: ingen — deploy uten 0047

Kjørt mot **isolert kopi av produksjonsgrunnlaget** (`scripts/isolert-kopi-sjekk.mjs`):
lokal SQLite med produksjonens faktiske `glass_prisliste`-skjema og alle **30 937 rader**
(30 937 unike `variant_id`), og **uten** `glass_typekode`.

| Kontroll | Resultat |
|---|---|
| Tabeller i kopien | `glass_prisliste`, `sqlite_sequence` — ingen `glass_typekode` |
| TOYOTA RAV4 2024 | 10 kandidater · 4 rutetyper · dekning GOD |
| FORD TRANSIT 2002 | 32 kandidater · 5 rutetyper · 6 steg (VS+HS-fiksen) |
| VW PASSAT 1990 | 14 kandidater · 4 rutetyper · 6 steg |
| Spørring mot `glass_typekode` | `no such table` — fanges av `hentTypekode()`, gir `null` |
| Admin-katalogsøk | har eksplisitt fallback uten join (`admin-katalog.ts:247`) |
| `eksaktErDokumentert` | try/catch → `false` (konservativt) |

**Konklusjon: PASS — releasen kjører uten 0047.** Ingen migrasjon kjørt.

**Presisering om metoden:** et fullt `wrangler d1 export` (98 MB) ble forsøkt
importert til en lokal D1 for å kjøre `wrangler dev`. Importen skrev ingenting på
fem minutter og ble stoppet av meg (`IMPORT_EXIT=143`, SIGTERM) — den bakgrunnsjobben
som senere meldte «exit code 0» er wrapperen, ikke importen. Verifiseringen ble
derfor gjort på en isolert kopi av **den tabellen releasen faktisk leser**
(`glass_prisliste`, prod-skjema + alle 30 937 rader) uten `glass_typekode`.
Det dekker releasens dataavhengighet, men ikke alle 76 tabellene i produksjon.

## 2. Sluttfiks funnet i produksjonsverifiseringen

Første deploy (`aba64d08`) svarte **201** der utstyrsmotstrid skulle avvises. Årsak:
variant-oppslaget i `/api/inquiry` hentet ikke `kommentar`, så
`featuresFraKommentar()` fikk alltid tom streng og kontrollen kunne aldri utløses.

Rettet: `kommentar` tas med i SELECT, og en vakt-test feiler hvis kolonnen forsvinner
fra spørringen. Ny versjon `7ae6d2a6` deployet. Etter fiksen avvises motstrid korrekt.

## 3. Etterkontroll i produksjon

| Kontroll | Resultat |
|---|---|
| Aktiv versjon | `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d` (100 %) |
| Bilsøk (resolver) | RAV4 2024 → 3 kandidater: 6 070,31 / 4 643,75 / **3 357,81** |
| Rutevalg | `/api/glass/valg` svarer `MANUAL_QUOTE` — `ALL_GLASS_KANDIDATER_ENABLED` er **bare satt i staging** (uendret, ikke rørt) |
| RAV4 «Nei» | **PASS** — listen avgrenses til 3 357,81 kr |
| Feil side | **PASS** — `400` «…dokumentert som venstre» |
| Dokumentert utstyr + «nei» | **PASS** — `400` «…dokumentert med oppvarmet» |
| Samme vare + «ja» | `201` (går til manuell kontroll) |
| Ukjent variant | **PASS** — `400` «Ukjent variant» |
| Tilbehør som variant | **PASS** — `400` «ikke et glass» |
| «Vet ikke» | **PASS** — 3 varianter før og etter (filtrerer ikke) |
| Mobil 390: Endre svar / Vet ikke / Tilbake | Endre svar ✅ · Vet ikke ✅ (filtrerer ikke) · **Tilbake mangler** (`#btn-glass-back` har `hidden`) |

## 4. Merket produksjonstestsak

**Sak #45** — «Testkunde Hermes PROD», `tomarnejensen+fbgtest@gmail.com`, DS 30475,
opprettet 4.11.2026 15:59:56 via den ekte kundereisen.

Lagret og verifisert i `/ops` (skjermbilde `reports/prod-verifisering/sak-45.png`):

```
Valgt variant: 8432AGAC:8432AGACMV1L · listepris 10745 eks. mva
estimert kundepris 3357,81 kr inkl. mva
tilhørighet: bekreftet_bil_ukjent_plassering
kontroll: ingen dokumenterte egenskaper å kontrollere svaret mot
salgsenhet: ukjent (ingen kildeopplysning om salgsenhet)
Ønsket leveringssted: Trondheim · utstyrssvar {"oppvarmet":"nei"}
```

Variant, svar og pris er identiske i kvittering, lagret sak og `/ops`.
**E-postlevering er ikke påstått** — adressen er en testmottaker, og sendeloggen
alene beviser ikke levering.

## 5. Testartefakter i produksjon

| Sak | Årsak |
|---|---|
| #42, #43 | Opprettet av feilen i punkt 2 (utstyrsmotstrid ble ikke avvist) |
| #44 | API-test av utstyr «ja» etter fiksen |

Alle er merket som test i navn/melding. Slettes på forespørsel.

## 6. Gjenværende, ikke del av denne releasen

- `ALL_GLASS_KANDIDATER_ENABLED` er av i produksjon → kunden får manuell rute per i dag.
- `0047` (`glass_typekode`) er ikke kjørt — releasen krever den ikke.
- 15 variantkonflikter er ikke avklart og ikke rørt.
- 2 uavhengige fasitpar — dokumentert som begrenset dekning.
- `Tilbake` mangler på mobil etter svarsteget (kosmetisk/UX, ikke blokkerende).
- Tekniske produktnavn («TOYOTA RAV 4 22-») er en senere tekstforbedring.

## QA

**596/596 pass**, `tsc --noEmit` grønn. 25 tester i variantkontroll-fila, inkludert
vakt-testen for at `kommentar` hentes.
