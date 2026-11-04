# Driftsrapport — Apify, design, fakturering, frakt og /ops-rutine

**Dato:** 2026-11-04 · **Produksjon:** `cbdc2cf2-5885-48b6-93bb-3f424456a9ef` (designfikser) · katalogrelease `e57af458`
**Alt er reversibelt:** kun to CSS/JS-rettinger i frontend, ingen datamigrasjon, ingen kjøp, ingen faktura sendt.

---

## 1. Apify — status

| Spørsmål | Svar |
|---|---|
| Hva hentes | `tomarnejensen/finnbilglass-price-import` — Glavista-produktsider (eurokode, typekode, mål, utstyr, EUR-veiledningspris) |
| Siste kjente vellykkede kjøring | 2026-10-31: **50/50 produkter**, 50 unike eurokoder, idempotent re-import (`inserted=0, updated=50`) — dokumentert i `docs/apify-catalog-staging-results-2026-10-31.md` |
| Testkjøring etterpå | run `sarEkPbes0rjlcg3A`, build 1.0.18, 5/5 produkter, **$0,0023** |
| Hvor dataene ligger | **Kun i Apify-datasettene (sky) + dokumentasjon.** `apify_catalog_products` finnes **ikke** i produksjons-D1 (76 tabeller) eller staging-D1 (67 tabeller) — tabellen ble aldri migrert inn i de kjørende basene |
| Automatisert? | Nei. Actor, Task (`efh6cQo6pYdYdBX8Y`) og `scripts/apify-automation.mjs` finnes, men det er **ingen cron/schedule** — hver kjøring og import er manuell |
| Kostnad | Siste kjente: **$0,0023** for 5 produkter. Full 92-siders discovery er ikke kjørt; kostnad ikke målt |
| Blokkering | **Apify-tokenet er utløpt** (`auth.json`: `expiresAt 2026-11-01T12:25Z`, OAuth2-refresh gyldig til 2026-12-31). API svarer `user-or-token-not-found`, `apify-cli info` henger på refresh. Krever at Tom kjører `apify login` én gang |

**Viktig prinsipp holdt:** ingen Glavista-EUR-pris er skrevet inn som norsk kundepris. `apify_catalog_products.pris` er NOK-feltet og står `NULL`; EUR-kilden ligger i egne felt. Kundeprisen kommer fortsatt kun fra XLS-listepris × 0,25 × 1,25.

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
