# Oppgave 6 — Analyse: dekningsdrevet katalogutvidelse

**Dato:** 2026-08-19 · **Status:** ANALYSERAPPORT (ikke kode) — venter på beslutning 6a (kode) vs 6b (prosess/bevis)
**Kilder:** `data/fasit-live.json` (118 saker), `data/fitment-challenge.json` (24 caser), `data/glass-skus.json` (1 916 SKU-er fra glavista+GT+fasit), `data/gt-ekspansjon/gt-generert.sql` (34 393 GT-regler)

---

## 0. Bunnlinje

**110 needs_verification-saker i fasit-live. Ingen av dem kan løses ved å «bare lese flere attributter fra glass-skus.json»** — katalogattributtene skiller 0 saker. Men analysen avdekket **tre konkrete, ulike tiltak** med høy effekt:

| # | Tiltak | Type | Saker påvirket |
|---|---|---|---|
| 1 | **Fjern liste-koder (PY/GU/K) fra fasit-live-korpuset** | Dataendring (rensing) | **14 saker blir entydige → approved** |
| 2 | **Bygg GT-baserte SKU-er i glass-skus.json** (i dag knyttes GT-regler kun til glavista-SKU-er — veteran-koder faller ut) | Kodeendring (migrasjon) | 14/16 korte koder finnes i GT, mangler i glass-skus |
| 3 | **La matcher lese glavista-attributter** (cameraBracket 1 159 SKU-er, rainLightSensor 694, acoustic 426, heating 210, hud 9) | Kodeendring (matcher) | Moderne variantfeller (challenge B: T5 SU18018) |

---

## 1. Topp-10 missingAttributes-kombinasjoner

Blant de 110 needs_verification-sakene (2+ gyldige koder) er fordelingen **ekstremt skjev**:

| # | Kombinasjon | Saker | Forklaring |
|---|---|---|---|
| 1 | **(ingen skillende attributter i katalogdata)** | **110/110** | Katalogattributtene skiller aldri — se §2 hvorfor |

Det finnes altså **ingen spredning av attributt-kombinasjoner** i fasit-live-korpuset — én dominerende årsak: kandidatene er ikke skillbare med dataene vi har **for disse bilene** (stort sett veteranbiler 1951–1997 der glavista ikke har attributt-data, eller liste-koder som ikke er glass).

## 2. Rotårsaker (verifisert med tall)

### 2a. Liste-forurensning i fasit-live (13 koder) — datakvalitet
`1199GU, 1411PY, 1491PYC, 1598PY, 1923PY, 2036PY, 2072PY, 2077PY, 2244PY, 2288PY, 2459PY, 2898PY, 685GU` = **pyntelister/gummilister, ikke glass** (Toms egen PY*/GU*/K-regel). Eksempel: SUZUKI VITARA 1989 → `1598PY / 8010AKMR` — 1598PY er en list. **14 saker blir entydige (1 kandidat → approved) når lister fjernes.** Samme feilklasse som gt-oppryddingen (1979PY-lærdommen). Krever Tom-godkjenning (fasit-integritet).

### 2b. Migrasjonsgap: GT-regler knyttes kun til glavista-SKU-er (kodeendring)
glass-skus.json bygges fra **glavista-nøkler**; GT-regler beriker bare SKU-er som allerede finnes. Veteran-koder (16C, 377C, 9020ACL…) har ingen glavista-SKU → **GT-reglene for dem havner ingensteds**. Verifisert: **14/16 korte fasit-koder finnes i gt-generert.sql** (med make/model/year/verified_by) — dataen finnes, men glass-skus.json har den ikke. Fiks: migrasjonen bygger også SKU-er direkte fra GT-rader (eurocode fra GT, vehicleRules fra GT).

### 2c. Attributt-data finnes i glass-skus.json, men matcher.ts leser den ikke (kodeendring)
| Attributt | SKU-er med verdi i glass-skus.json | matcher.ts i dag |
|---|---|---|
| cameraBracket | 1 159 | ✗ leses ikke |
| rainLightSensor | 694 | ~ (via eurokode M) |
| heating | 210 | ~ (via H/navn) |
| acoustic | 426 | ✗ leses ikke |
| hud | 9 | ✗ leses ikke |
| antenna | 45 | ~ (via A/navn) |

Challenge-caser som B-01 (T5 SU18018: 2 kandidater, «2525GYA via OE 7H0845101H») er nettopp der glavista-attributtene skiller — men matcher bruker dem ikke.

### 2d. Ekte kataloggap (dataendring)
- **89/110 saker**: ingen av sakens koder finnes i glass-skus.json (glavista dekker ikke veteran). 2/16 korte koder (180C, 685GU) mangler også i GT → **krever ny katalogdata** (varekort-scrape/GT-utvidelse) eller manuelle overrides.
- 95 AGS-format-koder uten glavista-treff (kataloggap for moderne biler i fasit-settet).

## 3. Klassifisering per kombinasjon (beslutningsgrunnlag)

| Kombinasjon | Saker | Løses med eksisterende katalogdata (kodeendring)? | Anbefaling |
|---|---|---|---|
| Liste-koder blant gyldige koder | 14 (av 110) | **Ja — rensing** (data finnes, feilklassifisert) | **6a-lite: rensescript + fasit-integritet-oppdatering** (Tom-godkjent) |
| Veteran-koder uten glavista-SKU, men med GT-regel | 14 koder / ~85 saker | **Ja — GT-baserte SKU-er i migrasjonen** | **6a: migrasjonsutvidelse (kode)** |
| Moderne variantfeller (challenge B/C) | challenge: 6 flereKandidater + 3 sensor/kamera | **Ja — matcher leser glavista-attributter** | **6a: matcher-integrasjon (kode)** |
| Ekte kataloggap (ingen GT, ingen glavista) | 2 korte koder + 95 AGS + veteran uten GT | **Nei** | **6b: ny katalogdata / manuell override via /ops/sku** (allerede bygget i oppgave 3–4) |
| Attributt-ukjent på moderne biler (HUD/kamera) | challenge C-kategorier | **Nei — krever kunde-/fotobevis** | **6b: bevisinnhenting (glass_marking/mirror_sensor — allerede bygget)** |

## 4. Anbefaling

1. **6a først (kode, høy effekt, null risiko):**
   - Migrasjonsscriptet bygger GT-baserte SKU-er (lukker 2b) → veteran-sakene får vehicleRules i glass-skus.json.
   - matcher.ts leser glavista-attributter for skillende kandidater (lukker 2c) → moderne variantfeller kan skilles uten spørsmål.
2. **6a-lite (rensing, krever Tom-OK pga fasit-integritet):** fjern 13 liste-koder fra fasit-live → 14 saker approved.
3. **6b (prosess/bevis):** de resterende ekte gappene håndteres av det allerede bygde /ops/sku + override + bevisinnhenting (oppgave 3–4) — ingen ny kode nødvendig.

**Ingen ny ekstern API-tilkobling foreslås.** Estimert effekt hvis alt gjennomføres: 14 (rensing) + ~30–50 % av veteran-sakene (GT-SKU-er) + moderne variantfeller får katalog-skille — resten går via operatørflaten som da har verktøyene.

*Rapporten er analyse — ingen produktkode er endret i denne oppgaven.*
