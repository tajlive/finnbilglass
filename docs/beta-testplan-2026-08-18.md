# Finnbilglass — betatestplan

Dato: 18. august 2026
Eier: Finnbilglass produktteam
Status: Klar for kontrollert betatest

## Formål og avgrensning

Betaversjonen verifiserer at en kunde kan identifisere bilen med kjennemerke,
komme til frontrutevalg og få et trygt neste steg. Systemet skal aldri velge
glass eller opprette en bestilling automatisk.

Dette er med i beta:

- Forside, informasjonssidene og personvern.
- Kjennemerke skrevet inn manuelt og, på mobil, fotografering av kjennemerket.
- Oppslag mot Statens vegvesen og kandidat-/spørsmålsflyt for frontrute.
- Trygg kontakt-/handoff når bilen eller riktig variant ikke kan avklares.
- Intern lesetilgang til Operations Center.

Dette er ikke med i beta:

- Kundeopplasting av bilder av frontrute eller sensorområde.
- Chat, tale eller AI-observasjoner i kundereisen.
- B2B-innlogging, ordre eller montørflyt.
- Automatisk glassvalg, prisforpliktelse eller bestilling.
- Endring av supportstatus i produksjon.

## Testgjennomføring

Bruk minst én mobil og én desktop-nettleser. Testeren skal bruke sin egen bil
eller et på forhånd godkjent testkjennemerke. Kjennemerke og VIN skal ikke
legges i en offentlig feilrapport.

| Test | Forventet resultat | Bestått når |
| --- | --- | --- |
| Manuelt kjennemerke | Bilen vises eller kunden får tydelig kontaktsteg | Ingen tom side, feil eller automatisk ordre |
| Mobilfoto av kjennemerke | Teksten leses eller kunden får en ærlig feilmelding | Samme trygge flyt som manuelt søk |
| Ugyldig kjennemerke | Tydelig valideringsmelding | Ingen oppslag eller rå systemfeil |
| Ukjent bil | Kontakt-/handoff vises | Ingen påstått glassmatch |
| Flere glassvarianter | Relevante spørsmål vises | Ingen kandidat blir valgt automatisk |
| Lenker og informasjon | Om oss, personvern og "Bilglass uten forsikring" åpner | Alle sider er lesbare på mobil og desktop |
| Sikkerhetsgrense | Bildeopplasting/chat/tale er ikke synlig i kundereisen | Produksjons-API for kundebilder avslår forespørsler |

## Feilrapportering

Registrer for hver feil:

1. Tidspunkt, enhet og nettleser.
2. Stegene som ble utført, uten rått kjennemerke eller VIN.
3. Forventet og faktisk resultat.
4. Skjermbilde hvis det ikke inneholder personopplysninger.

Klassifiser feil slik:

- **P0:** dataeksponering, feil automatisk glassvalg eller nettstedet utilgjengelig.
- **P1:** kjernereisen stopper uten trygt kontaktsteg.
- **P2:** forståelig funksjonsfeil med mulig omvei.
- **P3:** tekst, layout eller mindre forbedring.

P0 og P1 stopper utrulling. P2 og P3 prioriteres i neste betarunde.

## Godkjenning for å avslutte beta

Betaversjonen kan gå videre først når alle følgende er dokumentert:

- Ingen åpne P0/P1-feil.
- Manuelt kjennemerke er testet på mobil og desktop med dokumentert resultat.
- Minst én sak med variantspørsmål er gjennomgått uten automatisk valg.
- Ukjent/ugyldig inndata gir et forståelig og trygt neste steg.
- Produksjonshelse og kjerneendepunkter er verifisert etter release.
- Avgrensningene over er fortsatt aktive.

## Drift og tilbakeføring

Produksjonslinjen er `main`. Hver release får en ren commit, en verifisert tag
og en direkte kontroll av den publiserte versjonen. Ved P0/P1 rulles siste
verifiserte Worker-versjon tilbake før videre feilsøking. Staging-katalogens
kompatibilitetsmigrering ligger i `migrations/staging/` og skal aldri kjøres
mot produksjonsdatabasen.
