# Privat kjøretøykorpus → full dokumentasjonskø og første kontrollsett (uten Glavista)

Status: **offline forsknings- og datakvalitetsverktøy**. IKKE integrert i produksjons-Worker, og genererer **IKKE** `EXACT`-godkjenninger.

## Hva vi allerede har

Historisk C6-rapport (`docs/finnbilglass-vehicle-intelligence-platform-c6.md`) oppgir **3 076** unike kjøretøy, **96,8 %** VIN-dekning og 735 modellfamilier. Dette er målt i august 2026; det er **ikke** nyopptalte poster fra en live database.

Kildene ble dokumentert som:

| Kilde (historisk) | Rader |
|---|---:|
| `data/finn-modeller/svv-verifisert.ndjson` | 656 |
| `data/test-500-gt-detaljer.jsonl` | 500 |
| `data/finn-100.jsonl` | 110 |
| Lokal privat `bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson` | 2 396 |
| Dedupliserte unike kjøretøy | 3 076 |

Tallene over beskriver en historisk kjøring. **De tre første filene er ikke alle tilgjengelige i nåværende offentlige GitHub-main; den private filen er ikke montert her.** Man må verifisere faktisk plassering, kilde og oppdatert antall før ny kjøring. `finn-100.jsonl` i repo er kun et lite delsett.


## 16.11.2026 – Hele korpuset gjennom den reelle kandidatmotoren (stacked PR)

Sammenkoblet forskningsgren bygger på PR #89/#92/#93 og bruker **den faktiske** `buildClassDCandidates`/`matchClassDCandidates`, `ApplicationResolver` og den delte Eurokode-parseren. Ingen Glavista kreves. Alle gyldige, pseudonymiserte kjøretøy får:

- kandidatantall, unike Eurokoder, antall applikasjonskandidater og mulige generasjoner (kun inferert)
- faste nulltreffårsaker og advarsler om identitetskonflikt, uklassifisert posisjon, flerkandidat og utstyr
- en prioritet begrunnet i **forekomst i korpuset**, avklaringsrisiko og manglende data; dette er ikke et målt markedstall
- neste kontrollhandling (for eksempel modellnormalisering, kontrollert OE og utstyrsbekreftelse)
- obligatorisk `NEEDS_INDEPENDENT_HUMAN_EVIDENCE`, `NOT_VERIFIED` og `autoExact=false`

Bilens fakta alene er ikke et bevis på riktig rute. Felles produktkatalog kan inneholde flere like/ukjente varianter; ingen valgt Eurokode godkjennes. `C6`-korpuset fra 2026 er fortsatt historisk, ikke en verifisert aktiv database.

### Én kommando med to private kontrolltrinn

```bash
# Gi prosessen en sterk, hemmelig FBG_CORPUS_HMAC_KEY fra godkjent hvelv.
npm run corpus:full -- \
  --input /sikker/lagring/svv-finn-broad-results.ndjson \
  --input /sikker/lagring/andre-svv-kjoretoy.jsonl \
  --output-dir /sikker/rapporter/korpus-2026-11-16
```

Output-mappen må være privat (0700); alle rapportfiler skrives med 0600 og overskrives aldri. Den inneholder `audit-aggregates.json`, `queue-all-vehicles.json`, `frozen-first30.json`, `fitment-aggregates.json` og `priority-evidence-queue.json`. Bare aggregerte tall skrives til konsollen; identifikatorer skal ikke skrives til offentlig GitHub eller sendes i chat.

**Viktig:** Når flere biler kommer til i en senere kjøring, kan ny sampling velge andre kontrollbiler. Bruk derfor det opprinnelige holdout-settet igjen:

```bash
npm run corpus:full -- \
  --input /sikker/lagring/oppdatert-korpus.ndjson \
  --output-dir /sikker/rapporter/korpus-ny-versjon \
  --frozen-sample /sikker/rapporter/korpus-2026-11-16/frozen-first30.json
```

Verktøyet nekter å bruke en holdout-ID som mangler eller er feil, fremfor å fylle inn et nytt og utestet sett. Deduplisering kobler sammen REG-only og VIN-poster bare når registreringsnummeret kan knyttes til **nøyaktig én** VIN i de tilgjengelige datakildene. Gjenbrukte kjennemerker eller metadata som strider mot samme VIN merkes **IDENTITY_CONFLICT**; det gis aldri automatisk autoritet.

### GO/NO-GO

- GO for **offline kandidatdekning og planlegging av OE/foto-/montørkontroll** etter syntetisk CI.
- NO-GO for automatisk `EXACT`, pris/ordre, offentlig eksponering av koder, produksjons-D1 eller live-aktivering.
- Dokumentert lisensgrunnlag og faktisk tilgang til den private basen kreves før reell kjøring og bruk av katalogresultatene.
- En selvrapportert eller hypotetisk `noNetwork=true` er ikke en faktisk integrasjonstest av produksjonsporten. Test `matcher.ts`/`vin-resolver.ts` separat med sikre negative tilfeller og uavhengig OE/fotofasit.

## Hensikt

Bruk registreringsnummer/VIN-korpuset til:
1. Å undersøke merke-/modellfordeling og kvalitetsfeil i bilidentitet
2. Å opprette en dokumentasjonskø for **samtlige gyldige kjøretøy** – ingen vilkårlig 30-bilersgrense
3. Å velge 20 utviklings- og 10 holdout-tilfeller som et **første evalueringsutvalg**, samtidig som alle andre kjøretøy beholder status `NOT_VERIFIED` i fullkøen
4. Å sammenligne **kandidatdekning på identisk, fryst input** når #89/#92/#93 samordnes

**Ikke:** Bruk antall registreringsnummer eller maskinelt SVV-oppslag som fasit for glassmontering. VIN bekrefter bilidentitet, ikke nødvendigvis montert frontrute og utstyr. 43R/DOT-merker er heller ikke bilspesifikk OE-evidens.

## Kjøring på eget, godkjent privat datalager

Kjør med Node 22 eller nyere i isolert arbeidsmiljø (ikke på Cloudflare production og ikke i GitHub Actions med reelle data):

```bash
# Sett en tilfeldig, sterk hemmelig nøkkel uten å skrive den i kode/GitHub/terminalhistorikk
# Eksempel: hent nøkkelen fra godkjent passordhvelv med hemmelig prosessmiljø.
# FBG_CORPUS_HMAC_KEY må være minst 32 UTF-8 bytes.

node scripts/private-vehicle-corpus-audit.mjs \
  --input /sikker/lagring/svv-finn-broad-results.ndjson \
  --input /sikker/lagring/andre-svv-kjoretoy.jsonl \
  --report /sikker/utdata/korpusrapport.json \
  --queue /sikker/utdata/alle-kjoretoy-til-beviskontroll.json \
  --sample /sikker/utdata/30-testbiler.json
```

Ingen fil lastes opp eller hentes fra internett. `--input` kan brukes flere ganger. Bare JSONL/NDJSON med minst ett REG/VIN-felt og merke, modell, år støttes. Verktøyet lager 0600-filer og **nekter å overskrive** gamle utdata. `--queue` inneholder **alle gyldige og dedupliserte biler** med pseudonym ID, modell/år og `NOT_VERIFIED` – *ingen* rå reg/VIN. `--sample` inneholder bare det første 30-bilers evalueringsutvalget (20 utvikling, 10 holdout); dette begrenser ikke fullkøen.

Det finnes **ikke** en offentlig koblingsnøkkel fra pseudonym ID tilbake til det rå registreringsnummeret. Finn faktisk bil og hent tillatt bevis **inne i et tilgangsbeskyttet privat miljø** med samme HMAC-nøkkel. Hold nøkkel og rådata adskilt fra PR, rapporter og logger.

Personvern: HMAC-pseudonymer er fremdeles **personopplysninger** når man kan knytte dem til fysisk bil. Ikke kall dem anonymisert. Oppbevaring, formål, behandlingsgrunnlag, tilgang og sletting må gjennomgås, særlig for historisk Finn.no/SVV-korpus; lovlig opprinnelig innsamling innebærer ikke automatisk rett til en ny bruk. Ikke start ny scraping eller bulk-SVV-oppslag via verktøyet.

## Begrensninger og sikkerhet

- Kildene er ikke verifisert gjennom en ny privat kjøring i denne PR.
- Automatiske rapporter inneholder kun aggregat. `--sample` er fortsatt privat data som må beskyttes.
- Pseudonym deduplisering bruker VIN når til stede, ellers REG; det kan gi dobbeltregistrering hvis samme bil finnes på én kilde med bare reg og en annen med bare VIN. Ikke oppgi 100 % korrekt deduplisering.
- Klassifiseringsgruppene er bare heuristikker for **utvelgelse til manuell kontroll**, aldri generasjon eller utstyrsfakta.
- **Alle** gyldige kjøretøy kan få egne bevisoppgaver; 30 er bare startsettet for målbar evaluering, ikke noen databegrensning. Før fysisk kontroll av hver bil er status `NOT_VERIFIED`.
- Den statiske utviklingssalt-en i eldre `scripts/c6-vehicle-intelligence.mjs` er ikke egnet til hemmelig pseudonymisering; denne nye modulen krever separat hemmelig HMAC-nøkkel.

## Neste arbeidssteg (Issue #91)

- Tilgangsbegrenset datakilderevisjon med rettighetsgrunnlag.
- Kjør hele korpuset med samme godkjente inputs og frys inputversjon/dato.
- Be en glassfaglig kontrollør samle 20–30 reelle bilspesifikke dokumentasjonssett, inkludert negative varianter.
- Kjør beslutningsport på disse, inkl. holdout og sikkerhetskritiske moteksempler. Mål falske EXACT og riktig glass i kandidatsett, ikke bare antall.
- Kjør `shadow-mode` før eventuelle produksjonsaktiveringer. PR #95 hindrer allerede historiske overrides/score fra å automatisk bevise korrekt glassvalg i tekstmatcheren.
