# Driftsrapport — Apify, design, fakturering, frakt og /ops-rutine

**Dato:** 2026-11-04 · **Produksjon:** `cbdc2cf2-5885-48b6-93bb-3f424456a9ef` (designfikser) · katalogrelease `e57af458`
**Alt er reversibelt:** kun to CSS/JS-rettinger i frontend, ingen datamigrasjon, ingen kjøp, ingen faktura sendt.

---

## 1. Apify — status

| Spørsmål | Svar |
|---|---|
| Actor | `tomarnejensen/finnbilglass-price-import`, id **1QF8RbAZ6ewBALyYj**, build 1.0.18, privat |
| Task | **`efh6cQo6pYdYdBX8Y`** — «Finnbilglass Typekode Pilot 5» (4 kjøringer) |
| Hva hentes | **auto-glass.no** — `/varer/nettbutikk/autoglass/`, forhandlerlogin på `/min-konto/` (`finnbilglass-price-import/src/main.js:10-11,30,98`) |
| Modus | `typekodeOnly=true` gir **kun varenr + posisjon**; pris- og lagerfelt er tomme (`src/extract.js:68,179`) |

### Kjørt — resultater lest fra Apify-konsollen (innlogget nettleser)

| Kjøring | Run-ID | Tid | Omfang | Kostnad | Datasett |
|---|---|---|---|---|---|
| **Typekode-pilot** | `sarEkPbes0rjlcg3A` | 2026-11-01 12:59, 1 m 38 s | **5 varer**, 0 priser, 0 lager | **$0,003** | `T0E4YhoQlmD4stRnt` |
| Full priskjøring | `3BH4i16MJdDAvT19a` | 2026-11-01 06:37, 10 m 5 s | **92 varer** (9 sider) | **$0,068** | `MMuS1bGw2agb0D0Td` |

Begge datasettene er lastet ned til `reports/apify/`. Kontosaldo etter kjøringene: **$0,58 av $5,00** (Creator-plan, ingen ny kostnad ved gjenbruk).

**Ingen ny Apify-kjøring var nødvendig:** den avtalte piloten (≤5 sider, ≤10 produkter, tak $0,50) er allerede kjørt via Task `efh6cQo6pYdYdBX8Y`, og datasettet ble gjenbrukt i stedet for å brenne nye kreditter.

### Validering mot importveien (målt)

| Kontroll | Resultat |
|---|---|
| Pilot (5 varer) → `glass_typekode` | 4 rader **uendret** (identisk med staging), **0 nye**, 1 blokkert konflikt |
| Blokkert rad | `29730YP` — `sideConflict: true` (kilden sier DRIVER, tidligere rapport PASSENGER uverifisert), `automaticOrderAllowed: false` |
| **Skrevet til staging** | **0 rader.** Ingenting manglet, og konfliktraden skal ikke auto-importeres |
| Posisjonstekst → kode (92 varer) | **90 stemte** med eksisterende `glass_typekode`, **2 avvek** |
| Avvikene | `27411GN` og `27412GN` — speilvendt side (DB: DPF/DFF, kilden: DFF/DPF) → rapportert, ikke overskrevet |
| 92-vare-datasettet som typekode-import | **Avvist (92/92)** fordi det inneholder `listPriceValue` — det er en priskjøring, ikke typekode. Kildene blandes ikke |

**Funn som endret planen:** aktøren gir **posisjonstekst** («BAKRUTE», «DØRRUTE FREMRE FØRERSIDE»), mens `glass_typekode` bruker **18 korte koder** (F, B, DFF, DPF, DFB, DPB, DFFV, DPFV, DFBV, DPBV, SFB1-3, SPB1-3, BP, BF). Uten oversettelse ville importen fylt tabellen med et annet vokabular og brutt plasseringslogikken. Mapperen oversetter nå, avviser ukjent tekst og blokkerer sidekonflikter.

### Klar for kjøring: typekode-mapper med validering

`scripts/apify-typekode-import.mjs` validerer et Apify-datasett før noe skrives:

| Kontroll | Resultat på syntetisk fixture |
|---|---|
| Manglende varenr | avvist (rad 3) |
| Manglende typekode | avvist (rad 4) |
| Prisfelt i typekode-datasett | avvist (rad 5: `pris`) |
| Duplikat varenr, lik typekode | slått sammen (6 → 2 rader) |
| Samme varenr, ulik typekode | rapportert som konflikt, ikke overskrevet (test 2) |
| Utdata | idempotent SQL mot `glass_typekode` (varenr PK) |

Merk: `glass_typekode` finnes i **staging** (0047), ikke i produksjon. Import går derfor til staging til 0047 er godkjent.

## 2. Design — rettet og publisert

**Rotårsak:** SVVs handelsbetegnelse inneholder merket selv («TOYOTA RAV4»), og tre steder la merket til i tillegg.

| Sted | Før | Etter |
|---|---|---|
| Resultatbilde (`public/app.js`) | «Toyota **Toyota** RAV4 2024» | «Toyota RAV4 2024» ✅ |
| Saksoverskrift `/ops` (`public/ops-admin.js`) | «TOYOTA **TOYOTA** RAV4 2024» | «TOYOTA RAV4 2024» ✅ |
| Saksdetalj `/ops` (`src/ops-center-ui.ts`) | «TOYOTA **TOYOTA** RAV4 2024» | «TOYOTA RAV4 2024» ✅ |

Verifisert i produksjon: desktop 1400 px, mobil 390 px (ingen horisontal overløp: 390 = 390) og i `/ops` sak #41.
Priskrift og knapper er kontrollert og konsistente: «Estimert pris X kr» + «Endret pris bekreftes manuelt», «Velg dette glasset», «Be om uforpliktende tilbud», «Send forespørsel».

**Systematisk sjekk av offentlige sider** (desktop 1400 px + mobil 390 px, 2026-11-04):
`/`, `/om-oss`, `/personvern`, `/logg-inn` — alle HTTP 200, 0 konsollfeil, 0 horisontalt overløp, riktig `<h1>`.
Interne lenker på forsiden: 5 stk, alle svarer 200 (`/betaling.html` → 307 → `/betaling` 200, ufarlig redirect).
Ingen døde lenker, ingen tomme seksjoner funnet.

**Gjenstående, ikke rettet (krever Toms valg):**
- ~~`support@finnbilglass.no` mangler postkasse~~ **RETTET 2026-11-04:** adressen **mottar e-post** — MX `loke.domene.no` er Domeneshop sin e-posttjeneste (bekreftet av Tom). Min tidligere påstand om manglende postkasse var en slutning fra en mislykket Brevo-leveranse og er trukket. En SMTP-probe fra maskinen var intetsigende (port 25 blokkert lokalt, samme timeout også for `tom@finnbilglass.no` som er kjent fungerende). Interne varsler går fortsatt til `tomarnejensen@gmail.com` — Toms valg (alternativ C).
- «Logg inn / Min side» i bunnteksten er en lenke uten funksjon for privatkunder.

## 3. Fakturering — anbefaling

**SumUp Fakturaer: 0 kr/mnd, ingen kort kreves, 2,75 % kun når kunden betaler med kort; bankoverføring er gratis.** Bra for privatkunder.

**Men EHF er ikke dokumentert hos SumUp.** Fra **1. januar 2027** må bokføringspliktige sende e-faktura (EHF) til bedriftskunder som står i ELMA-registeret. Verksteder er typisk slike kunder. Derfor:

| Løsning | Månedspris | EHF |
|---|---|---|
| **SumUp Fakturaer** | 0 kr | Ikke dokumentert — må bekreftes i appen |
| Visma eAccounting Faktura | 0 kr i 12 mnd, deretter 119 kr | 4 kr pr. EHF |
| Fiken | 219 kr | Inkludert |
| DNB Regnskap Mini | 129 kr | Inkludert |

**Anbefaling:** SumUp nå (privatkunder), og velg EHF-kapabel løsning før første bedriftskunde etter 2027 — eller med en gang hvis verkstedene skal faktureres.

**Juridisk selger er avklart (2026-11-04):** FinnBilGlass drives av **BLYT AS**, org.nr **929 003 292 MVA**, Tempevegen 31, 7031 Trondheim (stiftet 24.02.2022, næring 46.720 engroshandel med deler og utstyr for motorvogner, MVA-registrert). Betalingskonto **1506.25.52843**. Verifisert mot Enhetsregisteret 2026-11-04. Kladden er nå komplett og ligger som `reports/faktura-kladde-2026-11-04.html` + `.pdf` (én side).

### Fakturakladd (mal, ikke sendt)

```
Selger:        BLYT AS  ·  Org.nr 929 003 292 MVA  ·  Tempevegen 31, 7031 Trondheim
Bank:          1506.25.52843    ·  MVA-registrert: ja (verifisert i Enhetsregisteret)
Fakturanr:     [tildeles av programmet — aldri manuelt]
Fakturadato:   2026-11-04    Forfall: 2026-11-18    Referanse: sak #41

Kunde:         Testkunde Hermes (syntetisk) · test@example.invalid

Linje 1  Frontrute Toyota RAV 4 22- FR AKU LDW
         varenr 8432AGAC · variant 8432AGACMV1L · kontrollert manuelt
         1 stk · 3 357,81 kr  (grunnlag: XLS-listepris 10 745 eks. mva × 0,25 × 1,25)  3 357,81
Linje 2  Frakt, stykkgods til verksted                                                     [___]
Linje 3  Tilbehør (list/klips) — kun hvis bekreftet inkludert                      0,00

Sum eks. mva        2 686,25
MVA 25 %              671,56
Sum inkl. mva       3 357,81

Merknad: Prisen er et estimat kontrollert manuelt. Ingen bestilling er gjennomført.
```

Frakt og betaling er **etter avtale** (Toms valg 2026-11-04): fraktlinjen står med 0,00 kr og egen merknad, og betalingsbetingelsen er «etter avtale». Krav som gjenstår før dette blir en ekte faktura: fortløpende nummer fra fakturaprogrammet, KID, og at glass + pris + levering er **godkjent av et menneske**. Et søkeestimat blir aldri en faktura automatisk.

## 4. Frakt — enkleste flyt

**AVGJORT 2026-11-04 (Tom, alternativ A): leverandøren sender direkte** til kunde/verksted. Vi formidler ordren og bestiller ingen transport selv. Det betyr at Mybring-avtale **ikke** er nødvendig nå.

Flyten ved leverandørdirekte sending:
1. Kunden har akseptert tilbudet i saken.
2. Vi sender ordren til leverandøren med varenr, full eurokode/variant og mottakeradresse (verksted eller kunde).
3. Fraktpris **etter avtale** — legges på fakturaen som egen linje når den er bekreftet, aldri et påslag vi gjetter.
4. Sporingsnummer mottas fra leverandøren og føres på saken i `ordre.sporingsnummer`; leverandørens ordrereferanse i `ordre.leverandor_ref` — **begge feltene finnes i dag**, så `0050` er ikke nødvendig for denne flyten.
5. Levering bekreftes ved at kunden/verkstedet kvitterer; `ordre.ordre_status` settes til levert.

Alternative løsninger (Bring stykkgods i Mybring) er dokumentert under, men ikke valgt:

Hvis Finnbilglass bestiller transport selv: **Bring stykkgods til bedrift** — maks 1 200 kg pr. kolli, 9 999 kg totalt, bestilles i Mybring, sporing og leveringsvarsel inkludert. En emballert frontrute (~20–30 kg, ca. 150 × 100 × 20 cm) passer, men **Norgespakke (maks 120 × 60 × 60 cm) er ikke aktuelt** — den går ikke.

Ikke gjort: ingen frakt kjøpt, ingen henting bestilt. Bring-konto/avtalenummer mangler.

## 5. Arbeidsrutine i /ops (eksisterende felt)

| Steg | Hvor det registreres | Status i dag |
|---|---|---|
| Forespørsel | `beta_inquiries` (status NEW) | ✅ i drift |
| Glass kontrollert | `case_glass_choice` (varenr, eurokode, utfall, valgt_av) | ✅ finnes |
| Pris/tilbud | `glass_quotes` (versjon, pris_kr, pris_type VEILEDENDE/BEKREFTET, gyldig_til) | ✅ finnes |
| Kundens aksept | `inquiry_commercial_events` (stage OPEN→BOOKED) + `beta_inquiry_events` | ✅ finnes |
| Faktura | **mangler eget felt** — `ordre` har `betalings_status`, `ordre_status`, `leverandor_ref`, men ikke fakturanummer | ⚠️ hull |
| Betaling | `ordre.betalings_status` / `betalings_metode` | ✅ finnes |
| Sendt / sporing | `ordre.sporingsnummer`, `ordre.skade_sjekk` | ✅ finnes |

**Anbefalt manuell rutine nå:** sak → godkjenn glass i /ops → skriv tilbud i `glass_quotes` (BEKREFTET) → kunde aksepterer (svar lagres på saken) → lag faktura i SumUp med saksnummer som referanse → før fakturanummeret inn i saksnotatet → oppdater `ordre.betalings_status` → legg inn `sporingsnummer` → lukk saken.

**Klar, ikke kjørt:** `migrations/pending/0050_ordre_faktura.sql` legger til `faktura_nummer`, `faktura_sendt_at` og `transportor` i `ordre`, pluss indeks på `faktura_nummer`. Rent additivt (ingen rad skrives, ingen kolonne endres), uavhengig av 0048. Krever Toms godkjenning fordi det er produksjonsskjema.

**Apify kjøreklar:** `docs/apify-kjoreklar-2026-11-04.md` — eksakte kommandoer for status, pilotkjøring (kostnadstak $0,50), import til staging og kostnadsbilde. Alt er klart bortsett fra `npx apify-cli login`.

## 6. Rapportrettelse: +1 313 eller +1 310?

Begge tall er riktige, men måler forskjellige ting:

- **1 313** = antall rader i de tre importfilene (`changes` fra D1 per `INSERT`-setning: 499 + 501 + 313).
- **1 310** = antall rader som faktisk ble satt inn (`created_at` 2026-11-04 12:21: 499→498, 501→500, 313→312).

**Årsak:** importsettet inneholder **tre `variant_id` som forekommer to ganger** (én i hver fil). `ON CONFLICT(variant_id) DO NOTHING` hoppet over de tre duplikatene. Netto +1 310 = 29 627 → 30 937. Ingen rad ble overskrevet, ingen informasjon gikk tapt — duplikatene er identiske rader fra to katalogføringer.

---

## Hva Tom må gjøre (kun det som faktisk mangler)

| # | Handling | Hvorfor |
|---|---|---|
| 1 | ~~Org.nr + bankkonto~~ **LØST**: BLYT AS 929 003 292 MVA · 1506.25.52843 | — |
| 2 | `apify login` (én gang) | Token utløpt 2026-11-01; API og CLI er stengt. Deretter kjøres pilot (Tom-valg 5A) |
| 3 | Fakturaprogram — **AVVENT** (Tom 2026-11-04) | Kladden står klar; velges når du er klar |
| 4 | ~~Fraktflyt~~ **AVGJORT**: leverandøren sender direkte (alternativ A) | Mybring ikke nødvendig |
| 5 | ~~Godkjenne 0050~~ **AVVENT** (Tom-valg 4C) — venter på fakturaprogram | Ikke nødvendig for leverandørdirekte flyt |
| 6 | ~~Supportadresse~~ **AVGJORT**: adressen mottar e-post; varsler fortsatt til Gmail (alternativ C) | — |

---

## Beslutning 2026-11-04: XLS er eneste prisgrunnlag

| Regel | Status |
|---|---|
| Prisgrunnlag = XLS-listepris eks. mva | ✅ eneste kilde; `src/pricing/nok-prising.ts` |
| Regel `× 0,25 × 1,25` (= × 0,3125), avrundet til øre, merket estimat | ✅ uendret |
| Manglende/ugyldig pris → «Pris på forespørsel» | ✅ `nok-prising.ts:57`, `frontrute-view.js:99` |
| Automatisk prisoppslag mot auto-glass.no | ❌ finnes ikke — 0 kjøretidskall (kun kommentarer/proveniens i koden) |
| Scraping for prisoppdatering | ❌ ikke startet, ikke planlagt |
| Apify kun ved konkrete mangler i produktdata | ✅ dokumentert i skill-referanse `prisgrunnlag-og-apify-grenser.md` |
| Manuell kontroll av glass, pris og frakt før tilbud | ✅ kundeteksten sier dette; innsendt forespørsel = ikke bestilling |

**Målt etterlevelse mot produksjons-D1 (2026-11-04):** 30 937 rader · **26 703** med positiv pris · **4 234** uten pris · faktor 0,3125 · **0 avvik** i hele katalogen. Samme resultat i staging (`scripts/pris-invariant-sjekk.mjs`, exit 0).

**Ingen kodeendring nødvendig** — dagens oppførsel er allerede den besluttede. Endringen er dokumentasjon og låsing av regelen, ikke ny logikk.
