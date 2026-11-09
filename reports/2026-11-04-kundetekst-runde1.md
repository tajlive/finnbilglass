# Kundetekst — gjennomgang runde 1 (avgrenset)

**Staging:** `f3516489-1462-484f-9347-33c0588eaaf3` · **QA:** 605/605 · **tsc:** grønn
**Produksjon:** `90b8c660` (uendret — ingen produksjonssetting i denne runden)
**Utgangspunkt:** commit `c62db43`

---

## 1. Kartlagte tekstflater (fra kildekoden)

| Flate | Fil | Status |
|---|---|---|
| Forside, bilsøk, hjelpetekster | `public/index.html`, `public/app.js` | aktiv i produksjon |
| Rutevalg/plassering/utstyr | `public/app.js` + `src/glass-valg.ts` | aktiv |
| Resultatkort, prismerking | `public/frontrute-view.js`, `public/app.js` | aktiv |
| Oppsummering, kontakt, leveringssted | `public/index.html` | aktiv |
| Bekreftelse etter innsending | `public/app.js` (to steder) | aktiv |
| Ingen treff / hjelp | `public/app.js` (`visValgHjelp`) | aktiv |
| Om oss | `public/om-oss.html` | aktiv |
| Bilglass uten forsikring | `public/bilglass-uten-forsikring.html` | aktiv |
| Personvern | `public/personvern.html` | aktiv |
| Betaling | `public/betaling.html` | aktiv |
| Innlogging / Min side | `public/innlogging.html`, `public/min-side.html` | aktiv |
| 404 | `public/404.html` | aktiv |
| Kundekvittering (e-post) | `src/index.ts` → `lagKvittering()` | aktiv |
| Internt varsel ved ny sak | `src/index.ts:266` | **intern** (til support, ikke kunde) |
| Svar fra /ops | `src/ops-center-ui.ts` / `src/index.ts` | aktiv, ikke gjennomgått |

**E-postleverandør: Resend** (`src/mail.ts`, `api.resend.com`). Brevo er fjernet
(2026-11-04). Én aktiv kundevendt e-postvei: kvitteringen. Engangskode/innlogging
går via samme `sendMail`, men er ikke gjennomgått i denne runden.

## 2. Endringer gjort

| # | Før | Etter | Hvorfor |
|---|---|---|---|
| 1 | `Vi har mottatt forespørselen din (sak #47)` | `Vi har mottatt forespørselen din – sak #47` | Føringene krever en-dash-formatet for kvitteringens emne |
| 2 | `…og finner pris og levering` | `…og bekrefter pris og frakt` | «finner» antydet at prisen hentes automatisk; vi bekrefter den manuelt |
| 3 | `Takk! Vi har mottatt forespørselen (saksnummer 47). …` | `Forespørselen er mottatt – sak #47. Vi kontrollerer opplysningene og følger opp via kontaktmåten du valgte. Ingen bestilling er gjennomført.` | Samme begrep i begge innsendingsflyter; bekrefter valgt kontaktmåte og skillet forespørsel/bestilling |

## 3. Verifisert allerede i produksjon (ikke endret)

| Føring | Faktisk tekst | Status |
|---|---|---|
| Rolle | `Vi leverer glasset. Montering avtaler du selv med et verksted.` | ✅ i kvitteringen |
| Forespørsel ≠ bestilling | `Dette er en mottakskvittering, ikke en ordrebekreftelse — ingen bestilling er gjennomført.` | ✅ |
| Prismerking | `Estimert pris 3 357,81 kr` + manuell kontroll | ✅ |
| Manglende pris | `Pris på forespørsel` | ✅ |
| Knappetekst | `Send forespørsel` / `Be om tilbud` — ingen «Bestill»/«Kjøp» i forespørselsflyten | ✅ |
| Kandidat ≠ passform | «Vi har funnet flere mulige frontruter» | ✅ |

## 3b. Nye vilkårstekster (etter Toms svar)

`public/betaling.html` har fått en seksjon «Frakt, retur og reklamasjon»:

- **Frakt:** avtales i hvert tilfelle, oppgis i tilbudet. Ingen løfter om gratis frakt
  eller fast leveringstid.
- **Retur:** returfrakt betales av kunden; retur og tilbakebetaling må være godkjent
  før sending. Spesialbestilt glass returneres ikke uten slik godkjenning.
- **Reklamasjon:** ta kontakt før sending; reklamasjon følger forbrukerkjøpsloven.
- **Selger:** BLYT AS, org.nr. 929 003 292. Finnbilglass er navnet kunden møter.

Leveringssteget er presisert: «Du oppgir leveringsadresse … Vil du ha glasset til et
verksted, avtaler du det selv.» (tidligere «avtalt verksted», som kunne leses som at vi
bestiller verksted).

Verifisert i staging `345d564e` på 390 px og 1280 px: teksten vises, 0 horisontalt
overløp, 0 konsollfeil.

## 4. IKKE gjennomgått i denne runden

Dette er reelt gjenstående arbeid, ikke «antatt OK»:

- `om-oss.html`, `personvern.html`, `betaling.html`, `bilglass-uten-forsikring.html`
  er **ikke** lest linje for linje. Personvern er **ikke** kontrollert mot faktisk
  Resend-bruk.
- `/ops`-svarmaler og tilbudstekst er **ikke** gjennomgått.
- Engangskode-e-post (frist, bruk, hjelpetekst) er **ikke** kontrollert mot koden.
- Ingen e-post er sendt eller forhåndsvist visuelt i denne runden — jeg har derfor
  **ikke** sett den faktiske e-posten med syntetiske data.
- Kontaktpreferanse («ikke ring hvis kunden valgte e-post») er **ikke** sporet
  gjennom koden.
- Mobil/desktop-gjennomgang av de offentlige sidene er **ikke** gjort denne runden.
- Om oss, bilglass uten forsikring og 404 er **ikke** lest linje for linje (kun søkt etter rolle- og garantiformuleringer).

## 5. Releaseforespørsel (avgrenset)

| | |
|---|---|
| Endringer | tre tekstrettelser (emne, kvitteringstekst, bekreftelse) |
| Filer | `src/index.ts`, `public/app.js` |
| Staging | `f3516489-1462-484f-9347-33c0588eaaf3` |
| QA | 605/605 |
| Rollbackmål | `90b8c660-121d-4ba4-84c2-b7407d4f432e` |

Ingen flagg, katalog, prisregel, matching eller e-posttransport er endret.

## 6. Spørsmål som må avklares før vilkårstekst

1. Retur/reklamasjon på spesialbestilt glass: hvilken regel gjelder?
2. Frakt: alltid «etter avtale», eller finnes faste satser?
3. Personvern: hvilke lagringstider er faktiske, og hvilket behandlingsgrunnlag
   skal oppgis for Resend?
