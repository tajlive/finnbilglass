# Release A offentlig API-kontrakt

Kundesøk returnerer bilopplysninger, manuell status og mulighet til å be om tilbud. Offentlige svar inneholder ingen produktkandidater, interne varenummer, Eurokoder, kandidat-ID-er eller leverandørpriser. `/api/glass` returnerer `MANUAL_REVIEW` med tomme `candidates` og `questions`; det lagres ikke søkesnapshot for denne Release A-ruten. `/api/regnr`, `/api/vin` og `/api/les-skilt` beholder bilopplysninger, men resolverfeltet er `MANUAL_REVIEW` uten produkter. `/api/frontrute` returnerer ingen produktkort. `/api/accessories` gir tom liste og manuell kontroll.

Kunden kan fortsatt sende forespørsel med registreringsnummer eller manuell bilbeskrivelse, glasstype, utstyr, kontakt og valgfrie bilder. Nye `preferredCandidate`-verdier fra klienten ignoreres. Eldre lagrede preferanser blir værende i autorisert operatørvisning som kundeoppgitt og ikke verifisert. Intern resolver og operatørens SKU-beslutningsrutine endres ikke. `MULTI_GLASS_ENABLED` endres ikke.

Dette er et tilsiktet kompatibilitetsbrudd for klienter som forventer kandidatkort, produkt-ID, direkte tilbehørssøk eller tallpris i offentlig søk. Slike klienter må bruke manuell forespørsel i Release A. Release B krever verifisert serverstyrt snapshot-kobling.
