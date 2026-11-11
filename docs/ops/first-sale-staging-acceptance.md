# FinnBilGlass OPS – første-salg: staging-akseptanse

**Status 11.11.2026:** Sjekkliste, ikke godkjent staging-bevis. Aktiv kandidat er draft PR #57. Produksjon = NO-GO inntil alle P0-porter er dokumentert.

## 1. Automatisert, helt syntetisk bevis

På samme kandidat-SHA kjøres:

```sh
npm ci
npm run test:ops-first-sale-integrated
npm run test:ops-reply-upgrade
npm run qa
python3 scripts/maintenance/staging-migration-rehearsal.py
```

Den integrerte prøven kontrollerer forespørsel → DRAFT → én mock-utsendelse → SENT → dokumentert aksept → nøyaktig én ordre → manuell Kustom-referanse. Status skal forbli PAYMENT_LINK_SENT, aldri betalt. Gammel lukket sak og hendelse skal være uendret. Oppgraderingstesten kontrollerer at usikre gamle QUEUED/FAILED-rader blir REVIEW og at SENT/andre gamle rader bevares. Alle nettverkskall til Resend er erstattet med lokal mock; ingen live D1, Gmail eller Kustom.

**Begrensning:** Disse testene beviser ikke Cloudflare Access, faktisk e-postleveranse, stagingbindinger eller gjenoppretting. Resultatet må ikke alene gi produksjons-GO.

## 2. Staging- og data-gate (Issue #39)

1. Dokumenter aktuell SHA, staging-Worker-versjon, Cloudflare-konto, EU-D1-binding, R2-bucket og migrasjonsledger, uten secrets eller kundedata i GitHub.
2. Verifiser gjenopprettbar backup/Time Travel og rollback-ansvar før noen databaseendring.
3. Kontroller om tabellen ops_reply_attempts finnes. Om den mangler: gjennomgå og anvend **bare** godkjent additiv migrasjon 0046 i riktig staging-D1. Ikke kjør alle pending eller proposed-migrasjoner.
4. Ta konsistente, beskyttede offline før/etter-kopier av samme datagrunnlag. Kjør legacy_jobs_release_guard.py med private R2-inventarer. Kontrollér gammel åpen og lukket sak, historisk tilbud og ordre i autentisert OPS. Se docs/ops/legacy-data-release-gate.md.
5. Tidligere usikre svarforsøk i REVIEW må avstemmes manuelt. Ikke lag nye requestId-er eller send på nytt uten en kontrollert avgjørelse. Se docs/ops/reply-send-reconciliation.md.

## 3. Autentisert ende-til-ende salgsreise (Issue #52)

| Kontroll | Forventet resultat |
|---|---|
| To inviterte ansatte | Access JWT og medlemskap fungerer, REVIEWER/tilbakekalt ansatt kan ikke skrive |
| Offentlig forespørsel | Én uforpliktende sak, ingen ordre, ingen automatisk betaling |
| Riktig bilglass | Faglig dokumentasjon (OE/foto), ingen ubegrunnet EXACT |
| Tilbud i NOK | Lagret produktnavn/SKU, pris, mva., frakt og vilkår; én sikker Resend-utsending |
| Kundesvar | Riktig postboks og saksjournal, ingen duplikat ved timeout/retry etter 25 timer |
| Aksept | Verifiserbar referanse før ordren, CAS-konflikt gir 409 uten feil historikk |
| Ordre | Én ordre fra akseptert tilbud og atomisk revisjonsspor |
| Kustom | Lenke lages/sendes manuelt i Portal, OPS får PAYMENT_LINK_SENT – ikke PAID |
| Feilinjeksjon | Manglende audit eller D1-feil ruller tilbake, aldri skjulte salgsendringer |
| Gjenoppretting | Dokumentert Worker rollback og D1-restore i isolert miljø |

Bruk godkjent testpostboks og testansatte. Ikke send syntetiske meldinger til eksisterende kunder. Ikke kopier privat e-post eller kundeinnhold inn i CI, Issues eller PR-er.

## 4. Workspace (Issue #38)

Verifiser riktig Workspace-bedriftskonto, alias, mottak, samtykke og gyldige refresh tokens. Behold GMAIL_SYNC_ENABLED=false til autorisert gjennomgang er fullført. Alternativ for første manuelle salg er en faktisk testet manuell mottaks- og journalføringsrutine.

## 5. Signoff

Logg bare aggregert PASS/NO-GO, eksakt SHA, Actions-run, staging-Worker-versjon, migrasjonsnummer, intern backupreferanse og eventuelle tekniske blokkeringer i Issues #39/#52/#38. **Ikke** merk PR #57 produksjonsklar bare fordi GitHub QA er grønn. Hold draft og ingen produksjonsdeploy til alle avtalte porter er oppfylt.
