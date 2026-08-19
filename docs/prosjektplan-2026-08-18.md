# Finnbilglass prosjektplan

Dato: 2026-08-18
Eier: Tom
Ansvarlig gjennomforing: Codex

## Beslutning

Bildeopplasting, kunde-chat og speech avventes. De skal ikke prioriteres videre na, og de skal ikke deployes til produksjon uten ny eksplisitt beslutning.

Dette betyr ikke at arbeidet slettes. Eksisterende staging-arbeid og dokumentasjon beholdes som grunnlag for senere fase, men hovedsporet flyttes tilbake til en enklere produksjonsklar kundeflyt.

## Hvorfor

Disse funksjonene oker kompleksiteten betydelig:

- bildeopplasting krever kvalitetskontroll, samtykke, lagring, sletting, supportprosess og referansebank
- AI-bildeanalyse krever fasitbilder, presisjonsmaling og tydelig menneskelig godkjenning
- chat krever samtalestyring, feilhandtering, fallback og support-handoff
- speech krever ekstra UX-, tilgjengelighets- og personvernvurdering

Prosjektet kommer raskere og tryggere til produksjon ved a fullfore kjernen forst.

## Aktiv plan

1. Stabiliser produksjonsflyten rundt kjennemerke.
2. Verifiser at kunden finner bil via SVV og far riktig kandidatstatus uten manuell bil-gjetting.
3. Rydd kundevendt UI slik at det er enkelt, profesjonelt og konsekvent.
4. Bruk Operations Center som intern leseflate for driftsstatus og saker.
5. Hold supportbehandling og bildekvalitetsgate i staging til ny beslutning.
6. Kjor regresjonstester og live-verifisering for hver produksjonsdeploy.

## Parkert plan

Disse fasene er satt pa vent:

- Evidence Capture / bildeopplasting fra kunde
- referansebank for glassbilder
- AI-bildeobservasjoner
- kunde-chat
- speech / tale-AI
- automatisk eller assistert bildebasert glassidentifikasjon

Nar de tas opp igjen, gjelder fortsatt hovedregelen:

Katalog og AI kan foresla. Menneske ma godkjenne. Systemet skal aldri automatisk velge glass, endre fitment eller endre kundens ordre basert pa bilder, chat eller speech.

## Neste milepal

Produksjonsklar v1 uten bilde/chat/speech:

- regnr som hovedinngang
- kamera/skiltlesing kun som lavfriksjonsinngang hvis den er stabil
- tydelig fallback nar SVV eller resolver ikke gir nok svar
- ingen nye AI-flater i produksjon
- ingen kundebildekrav
- ryddig supportkontakt ved usikkerhet

## Release-regler

- En scoped endring per produksjonsdeploy.
- Ren commit for det som deployes.
- Direkte verifisering etter deploy.
- Hermes-rapporter er innspill, ikke fasit.
- Ucommittet parallellarbeid skal ikke blandes inn i deploy.
- Produksjonsendringer som pavirker kundereisen krever eksplisitt godkjenning.

## Rollefordeling

- Tom: produkteier og endelig prioritering.
- Codex: hovedarkitekt, prosjektleder og ansvarlig implementering/verifisering i dette repoet.
- Hermes: hjelpeagent for forslag, rapporter og avgrensede arbeidsoppgaver nar Tom/Codex ber om det.
