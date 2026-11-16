# Privat kjøretøykorpus → testkandidater (uten Glavista)

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

## Hensikt

Bruk registreringsnummer/VIN-korpuset til:
1. Å undersøke merke-/modellfordeling og kvalitetsfeil i bilidentitet
2. Å velge **opptil 30** kandidater for innsamling av **uavhengig OE-/build-/foto-/montørbevis**
3. Å få 20 utviklings- og 10 holdout-oppgaver *uten* å merke noen som VERIFIED
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
  --sample /sikker/utdata/30-kandidater.json
```

Ingen fil lastes opp eller hentes fra internett. `--input` kan brukes flere ganger. Bare JSONL/NDJSON med minst ett REG/VIN-felt og merke, modell, år støttes. Verktøyet lager 0600-filer og **nekter å overskrive** gamle utdata. `--sample` inneholder pseudonym ID, modell/år, stratum, utvikling/holdout og `NOT_VERIFIED`; *ingen* rå reg/VIN.

Det finnes **ikke** en offentlig koblingsnøkkel fra pseudonym ID tilbake til det rå registreringsnummeret. Finn faktisk bil og hent tillatt bevis **inne i et tilgangsbeskyttet privat miljø** med samme HMAC-nøkkel. Hold nøkkel og rådata adskilt fra PR, rapporter og logger.

Personvern: HMAC-pseudonymer er fremdeles **personopplysninger** når man kan knytte dem til fysisk bil. Ikke kall dem anonymisert. Oppbevaring, formål, behandlingsgrunnlag, tilgang og sletting må gjennomgås, særlig for historisk Finn.no/SVV-korpus; lovlig opprinnelig innsamling innebærer ikke automatisk rett til en ny bruk. Ikke start ny scraping eller bulk-SVV-oppslag via verktøyet.

## Begrensninger og sikkerhet

- Kildene er ikke verifisert gjennom en ny privat kjøring i denne PR.
- Automatiske rapporter inneholder kun aggregat. `--sample` er fortsatt privat data som må beskyttes.
- Pseudonym deduplisering bruker VIN når til stede, ellers REG; det kan gi dobbeltregistrering hvis samme bil finnes på én kilde med bare reg og en annen med bare VIN. Ikke oppgi 100 % korrekt deduplisering.
- Klassifiseringsgruppene er bare heuristikker for **utvelgelse til manuell kontroll**, aldri generasjon eller utstyrsfakta.
- En «30-bilers kø» betyr **30 planlagte bevisinnsamlinger**, ikke 30 verifiserte fasiter.
- Den statiske utviklingssalt-en i eldre `scripts/c6-vehicle-intelligence.mjs` er ikke egnet til hemmelig pseudonymisering; denne nye modulen krever separat hemmelig HMAC-nøkkel.

## Neste arbeidssteg (Issue #91)

- Tilgangsbegrenset datakilderevisjon med rettighetsgrunnlag.
- Kjør hele korpuset med samme godkjente inputs og frys inputversjon/dato.
- Be en glassfaglig kontrollør samle 20–30 reelle bilspesifikke dokumentasjonssett, inkludert negative varianter.
- Kjør beslutningsport på disse, inkl. holdout og sikkerhetskritiske moteksempler. Mål falske EXACT og riktig glass i kandidatsett, ikke bare antall.
- Kjør `shadow-mode` før eventuelle produksjonsaktiveringer. PR #95 hindrer allerede historiske overrides/score fra å automatisk bevise korrekt glassvalg i tekstmatcheren.
