# ID.4/ID.5-avklaring og 500-bilers grunnlag (2026-11-04)

Svar på Hermes-ordren «lokal ID.4/ID.5-avklaring og 500-bilers stagingkjøring».

**Kort:** ID.4/ID.5 er avklart så langt lokale data rekker, og svaret er at kandidatlisten er beheftet med en konkret feil: en **ID.3-frontrute tilbys til ID.4 og ID.5**. 500-bilers kjøringen er **stoppet før eksterne oppslag** fordi det lokale grunnlaget er **117 biler**, ikke 500 — og oppdiktede eller gjenbrukte kjennemerker er ikke tillatt.

---

## 1. Utgangspunktet (verifisert før arbeid)

| Kontroll | Resultat |
|---|---|
| Branch / commit | `copy/kvittering-20261103` / `f5e0b2d` |
| Arbeidskopi | Ren sett bort fra tre urelaterte, untracked filer (`.worktrees/`, `data/fasit-utvalg-resultat.json`, `docs/v6-4-6-access-diagnostics.md`) — urørt |
| Staging `/health` | 200, `katalogRader: 29627` |
| Staging kjørende versjon | `016521d3-fbcc-4371-994a-b698e6be6f5d` (deployet 2026-11-04T00:06:01Z) |
| Kjørende kode er branchens kode | **Bekreftet adferdsmessig:** RAV4 2005 gir `VERIFY` med 2 kandidater (2572GN/8323AGN75, 2572GY/8323AGNGYV1B) — det er PR #26-fiksen |
| Pilotverktøyet | `scripts/pilot-kjoring.mjs`: kun `POST /api/regnr`, `lookupOnly: true` på hvert kall (`:75`), sekvensiell løkke med 400 ms pause (`:99`, `:156`), timeout 20 s, ingen retry, ingen skriving/henvendelse/e-post/opplasting |

Alle fire forutsetningene holdt. Eksterne kall utført i denne ordren: **4** (2 forutsetningskontroller + 2 ID-evidenskontroller), alle `lookupOnly` mot staging.

---

## 2. ID.4 / ID.5 — evidensrapport

### 2.1 Ground truth (lokal fixture, 32 307 rader)

GT har **tre** VW ID-rader totalt:

| make | model | year | frontrute_eurocode | confidence |
|---|---|---|---|---|
| VW | ID.3 (EL) | 2020 | `8652AGACMVZ` | 0,85 |
| VW | ID.4 (EL) | 2021 | `8658AGACMVZ` | 0,85 |
| VW | ID.7 (EL) | 2023 | `8668ACKCKMUVZ` | 0,85 |

**GT avgjør ingen av de fire testbilene:** ingen ID.5-rad, ingen GTX-rad, og ID.4-raden gjelder 2021 mens bilene er 2023. GT kan derfor verken bekrefte eller avkrefte kandidatene.

### 2.2 Katalogen (staging `glass_catalog`, `brand='VW'`, frontrute, modell med «ID»)

**7 rader — 3× ID.3, 4× ID.4, 0× ID.5, 0× GTX:**

| eurokode | modell | år | beskrivelse |
|---|---|---|---|
| 8652AGABCMUVZ | ID.3 5D HBK | 2020–2030 | WS GN ACO RHD CAMERA |
| 8652AGACMUVZ | ID.3 5D HBK 2020- | (år i streng) | WS GN ACO CAMERA BRA |
| 8652AGACMVZ | ID.3 5D HBK 2020- | (år i streng) | WS GN ACO CAMERA BRA |
| 8658AGACMVZ | ID.4 SUV | 2020–2030 | WS GN ACO CAMERA BRACKET |
| 8658AGACMUVZ | ID.4 SUV | 2020–2030 | WS GN ACO CAMERA BRACKET |
| 8658ACKCKMVZ | ID.4 SUV | 2020–2030 | WS CK CAMERA BRACKET RS |
| 8658ACKCKMUVZ | ID.4 SUV | 2020–2030 | WS CK CAMERA BRACKET RS |

De tre kandidatradene som faktisk vises har `oem_numbers = []`, `supplier = Pilkington`, `source = pilkington-irl`, `adas = 1`, `camera = 1`.

### 2.3 Hva de fire testbilene faktisk får

| Test-ID | SVV-modell | Utfall | Kandidater |
|---|---|---|---|
| FBG-T-0091 | VW ID.4 GTX 220 KW 2023 | VERIFY | 8652AGAC (ID.3), 8658AGAC (ID.4 GN ACO), 8658ACKC (ID.4 CK RS) |
| FBG-T-0093 | VW ID.4 PRO 4MOTION 195 KW 2023 | VERIFY | samme tre |
| FBG-T-0096 | VW ID.5 PRO 150 KW 2023 | VERIFY | samme tre |
| FBG-T-0097 | VW ID.5 (2023) | VERIFY | samme tre |

**Alle fire får identisk kandidatliste** — også ID.5, som ikke finnes i katalogen i det hele tatt.

### 2.4 Avgjør kildene ID.4 vs ID.5 og GTX vs vanlig ID.4?

| Skille | GT | Katalog |
|---|---|---|
| ID.4 vs ID.5 | Nei — bare ID.4-rad (2021) | **Nei** — ingen ID.5-rad; ID.5 får ID.4-deler |
| GTX vs vanlig ID.4 | Nei | **Nei** — begge ID.4-radene sier bare «ID.4 SUV 2020–2030» |
| ID.4 vs ID.3 | Ja (egne rader) | Ja (egne modellstrenger) — men skillet brukes ikke i matchingen, se 2.5 |

### 2.5 Rotårsak til at ID.3-delen dukker opp (målt)

```
modellTokensAv('ID.4',   'VW') → ["ID"]
modellTokensAv('ID.5',   'VW') → ["ID"]
modellTokensAv('ID.4 GTX','VW') → ["ID","GTX"]
```

- `modellTokensAv` (`src/vin-resolver.ts:130`) forkaster tokens kortere enn 2 tegn — derfor forsvinner «4» og «5» fra modellnavnet.
- `ordTreff` (`:157`) returnerer sant når **minst ett** token finnes i katalograden.
- Følgen: `ID` alene matcher ID.3, ID.4, ID.5 og ID.7. Katalograden for **ID.3** (`8652AGACMUVZ`, modellstreng «ID.3 5D HBK 2020-») passerer både token- og årskontrollen og blir kandidat for ID.4 og ID.5.

Dette er ikke forårsaket av PR #26: L2-laget (`lagPilkington`, `:564`) bruker `modellTokensAv` + `ordTreff`, ikke `gtRadMatch`. Koden er uendret mellom `ded654d` og `7c20d1ad`.

### 2.6 Kan den tidligere PINPOINT bekreftes eller avkreftes?

**Uklart — og det kan ikke avgjøres med dagens data.** Tre grunner:

1. Den forrige staging-byggen var ikke branchens kode: deployments-listen viser `16925eb9` (Secret Change), `48204cb9`, `42a44d44` fra 2026-11-03, før vår `016521d3`. Hvilken commit `42a44d44` kom fra, er ikke sporbart i Git.
2. Pilotrapporten fra før registrerte `utfall` og `kandidatantall`, men ikke kandidat-ID-er. Vi vet derfor ikke *hvilket* glass den gamle PINPOINT pekte på.
3. L2-koden er uendret av PR #26, så endringen kan ikke tilskrives merge-commiten alene.

Det som **kan** fastslås: dagens svar er forklarlig, og det inneholder en dokumenterbart feil familie (ID.3-delen).

### 2.7 Konklusjon per variant

| Variant | Konklusjon |
|---|---|
| **ID.4 GTX 2023** | Katalogen skiller ikke GTX fra vanlig ID.4. Kan ikke bekreftes. Behold `VERIFY`. |
| **ID.4 (PRO/4MOTION) 2023** | To ID.4-ruter er dokumentert i katalogen med samme årsspenn; de skiller seg på farge/akustikk (`GN ACO`) og på `CK … RS` (regnsensor). Riktig glass avhenger av utstyr kunden må bekrefte → `VERIFY` er korrekt. |
| **ID.5 2023** | **Ingen ID.5-rad finnes.** Kandidatene som vises er ID.3- og ID.4-deler. `VERIFY` er for generøst; riktig svar er `MANUAL_REVIEW`/`FALLBACK` inntil katalogen har ID.5. |

**Ingen endring gjort** i resolver, ground truth eller testforventninger.

---

## 3. Grunnlag for 500 biler — kartlagt og stoppet

### 3.1 Inventar over kjennemerker i repoet

| Kilde | Kjennemerker | Merknad |
|---|---|---|
| `data/finn-100.jsonl` | 110 | offentlige finn.no-annonser (finnkode + merke/modell/år) |
| `data/fixtures/self-test-50-cars.json` | 50 (6 unike utover finn-settet) | fast regresjonskohort, versjon 1, 2026-08-19 |
| `data/fasit-utvalg.csv` | 2 (1 unik utover settet) | SU18018 + AJ95429 |
| **Sum brukbart, unike** | **117** | = dagens `testgrunnlag v1` |
| Testskilt i kode/rapporter | 5 (`JD79487`, `XD84921`, `EL21939`, `UR67407`, `KE42110`) | ekte-format, men uten dokumentert merke/modell/år — kan ikke bli testrader uten oppslag |
| Syntetiske plassholdere | 16 (`AA12345`, `ZZ00000`, `XX99999`, `DD67890` …) | **ikke brukbare** |
| Katalog-plassholdere i prisliste-import | 9 (`FD23776`–`FD23779`, `FW00214`, `FW02364`, `FB04355`, `DD09693`, `DQ10753`) | ikke ekte biler, ikke brukbare |

**Maksimalt forsvarlig grunnlag: 117 biler.** Med de 5 testskiltene som en hypotetisk utvidelse: 122. **Ikke 500.**

### 3.2 Skjevheter i det som finnes

- Merkefordeling i finn-settet (110): Volkswagen 46, Toyota 29, BMW 7, Volvo 4, Mitsubishi 4, Kia 3, Nissan 2, Audi 2, Peugeot 2, Mazda 2, og 1 hver av Hyundai, Polestar, Isuzu, Ford, Lotus, Cupra, Porsche, Jaguar, Land Rover.
- **Helt fraværende:** Mercedes, Skoda, Seat, Tesla, Renault, Citroën, Opel, Fiat, Dacia, Honda, Subaru, Suzuki, Mini og alle kinesiske merker.
- Årgang: 1983–2026; 24 ≤ 2010, 35 ≥ 2023.
- Elbiler: 10 i selvtest-kohorten + Polestar/Lotus/Cupra i finn-settet.

### 3.3 Beslutning

Å nå 500 krever **ny innsamling av kjennemerker** (finn.no-skraping, slik de 110 opprinnelig ble hentet). Det er ikke gjort og ikke godkjent i denne ordren.

**Derfor er 500-bilers stagingkjøringen stoppet før eksterne oppslag**, i tråd med ordren §3. Ingen kjennemerker er oppdiktet, gjenbrukt eller syntetisert.

---

## 4. Datasett og delbar rapport

| Fil | Innhold | Tilgang |
|---|---|---|
| `data/testgrunnlag/testgrunnlag-v1-privat.csv` | 117 biler med kjennemerke, kilde:linje, fire forventningsfelt, fire utfallsakser | gitignored, tilgangsbegrenset |
| `reports/testgrunnlag-v1-delebar.csv` | samme rader **uten kjennemerke** (test-ID) | delbar |
| `reports/pilot-*.csv` | kjøringsresultater per bil (test-ID, aldri kjennemerke) | delbar |

Versjonering: `testgrunnlag v1`, seed `20261104`, generator `scripts/testgrunnlag-v1.mjs` (mulberry32 — identisk md5 ved gjentatt kjøring, verifisert).

---

## 5. Målinger (staging, alle kjøringer)

| Kjøring | Kall | Teknisk feil | p50 | p95 | maks | Utfall |
|---|---|---|---|---|---|---|
| `pilot-regresjon-20261104` (før) | 51 | 0 | 264 ms | 853 ms | 1 214 ms | PINPOINT 6 · VERIFY 27 · FALLBACK 18 |
| `pilot-tilfeldig-20261104` (før) | 50 | 0 | 352 ms | 1 197 ms | 1 227 ms | PINPOINT 8 · VERIFY 36 · FALLBACK 6 |
| `pilot-regresjon-20261104-etter` | 51 | 0 | 235 ms | 984 ms | 1 352 ms | PINPOINT 7 · VERIFY 26 · FALLBACK 18 |
| `pilot-tilfeldig-20261104-etter` | 50 | 0 | 356 ms | 1 135 ms | 1 187 ms | PINPOINT 4 · VERIFY 40 · FALLBACK 6 |

- **Teknisk feilrate: 0 av 101** (begge sider av endringen).
- **Katalogdekning: 77 av 101 (76 %)** — uendret etter endringen.
- **Fasitvurdering: 2 av 2 SAMSVAR** (SU18018, AJ95429) — uendret.
- **Samsvar med dokumentert forventning (selvtest-50): 50 av 50** — både før og etter.
- Sammenligning mot 101-piloten: **12 av 101 utfall endret**, dokumentert i `reports/2026-11-04-pilot-staging-resultat.md` §9.

---

## 6. Avvik, sortert etter alvorlighet

| # | Alvor | Avvik | Reproduksjon | Test-ID |
|---|---|---|---|---|
| 1 | **HØY** | **ID.3-frontrute tilbys som kandidat for ID.4 og ID.5.** `8652AGAC` / `8652AGACMUVZ` har modellstreng «ID.3 5D HBK 2020-». Å velge den til en ID.5 er feil bil. | `POST /api/regnr {"regnr":"<ID.4 eller ID.5>","lookupOnly":true}` → `resolver.kandidater[0]` | FBG-T-0091, -0093, -0096, -0097 |
| 2 | **HØY** | **ID.5 finnes ikke i katalogen, men får kandidater.** Alle 7 VW ID-frontruter er ID.3 eller ID.4. Kunden får `VERIFY` med 3 deler der ingen er dokumentert for ID.5. | samme kall som #1 med ID.5-bil | FBG-T-0096, -0097 |
| 3 | **MIDDELS** | Modelltokens kollapser til `["ID"]` for ID.4/ID.5 fordi enkelttegn forkastes, og `ordTreff` godtar *ett* token. Rotårsak bak #1 og #2. | `node --import tsx -e "…modellTokensAv('ID.4','VW')"` → `["ID"]` | — |
| 4 | **MIDDELS** | Katalograden `8652AGACMUVZ` mangler `year_from`/`year_to` (år kun i modellstrengen), mens søskenraden har 2020–2030. Ulik datakvalitet på samme familie. | `SELECT year_from, year_to FROM glass_catalog WHERE eurocode='8652AGACMUVZ'` | — |
| 5 | **LAV** | 4 av 7 VW ID-katalograder faller bort fordi de ikke har prisrad: bare `8652AGACMUVZ`, `8658AGACMUVZ` og `8658ACKCKMUVZ` finnes i `glass_prisliste` (målt). Kunden ser 3 av 7 varianter uten at det forklares. | `SELECT eurokode, varenr, pris FROM glass_prisliste WHERE eurokode LIKE '865%AGAC%' OR eurokode LIKE '8658ACKCK%'` | FBG-T-0093 |
| 6 | **LAV** | Tidligere PINPOINT for ID.4/ID.5 kan ikke etterprøves: staging-bygg før endringen er ikke sporbart til en commit, og kandidat-ID-er ble ikke logget. | `wrangler deployments list --config wrangler.staging.toml` | FBG-T-0091 … -0097 |

---

## 7. Bekreftelse: ingen produksjon, ingen saker, ingen e-post

- **Produksjon er ikke kalt.** Alle kall gikk til `finnbilglass-frontrute-staging.tomarnejensen.workers.dev`.
- **Ingen skrivinger:** `lookupOnly: true` slår av `regnr_logg`/`sok_logg` (`src/sok-logg-policy.ts:19`).
- **Ingen henvendelser:** staging-D1 `beta_inquiries` står på **34 rader, 5 merket test, siste `2026-11-03T23:02:46Z`** — uendret gjennom hele økten.
- **Ingen e-post:** piloten kaller ikke e-postendepunkter; `RESEND_API_KEY` ble aldri berørt.
- **Ingen opplastinger:** ingen R2-kall.
- **Ingen deploy, ingen migrasjon, ingen fasitendring, ingen nye merges** som del av denne ordren. (Staging-deployen `016521d3` ble gjort i forrige runde, før ordren.)

---

## 8. Anbefaling

1. **ID.4/ID.5 skal fortsette å være `VERIFY` — ikke `PINPOINT`.** Ingen av kildene skiller GTX fra vanlig ID.4, og ID.5 finnes ikke i katalogen.
2. **ID.5 bør strammes til `MANUAL_REVIEW`** (eller FALLBACK) inntil katalogen har en ID.5-rad. Det er en resolver-endring og krever egen godkjenning — ikke gjort.
3. **Fiks modelltoken-kollisjonen for VW ID-familien** før flere elbiltester: enkelttegn-forsinkelsen i `modellTokensAv` gjør at «ID.4» og «ID.5» er identiske for matchingen og at ID.3 blir kandidat. Dette er rotårsaken, ikke symptomet.
4. **500-bilers kjøringen må vente på et godkjent datagrunnlag.** Alternativene er:
   - (a) ny innsamling av kjennemerker (finn.no, som i august) — krever godkjenning og vilkårsavklaring,
   - (b) bruk av en betalt/avtalt registerkilde,
   - (c) kjøring på de 122 bilene som faktisk finnes, som en utvidelse av dagens 117.
5. **Kall- og kostnadsgrensene er ikke avklart** for et større volum: SVV-oppslagene er i dag gratis åpne data, men omfanget for 500 kall er ikke uttrykkelig godkjent. Ordren krever at jeg stopper når dette er uklart — derfor ingen kjøring.
