# OPS – kontroll av historiske kundesaker før produksjon

**Status:** Automatisk regresjonstest er implementert med syntetiske SQLite-data. Dette er **ikke** bevis for at en ekte staging-/prod-D1-kopi er kontrollert. Produksjonsrelease er NO-GO inntil faktisk datakontroll er dokumentert i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39) og første-salg-E2E i [Issue #52](https://github.com/tajlive/finnbilglass/issues/52).

## Hva kontrolleres

Verktøy: \`scripts/maintenance/legacy_jobs_release_guard.py\`. Det leser **bare** to lokale SQLite-kopier og lager en resultatrapport uten personopplysninger.

- \`beta_inquiries\`, \`beta_inquiry_events\`, tilbud, ordre, outbox, journal og aktivitetslogg må beholde alle historiske rader og alle gamle kolonner.
- Nye saker og nye hendelser kan legges til, men gamle rader kan ikke slettes eller endres stille.
- Eksisterende SKU-baserte tilbud støttes. Navnebaserte tilbud med intern \`UTEN-VARENUMMER\` må ha et reelt varenavn i \`equipment_json.offerProduct\`.
- Aksepterte tilbud må samsvare med ordre-ID, SKU, beløp og valuta. Betalingslenkereferanse må være til stede der betalingslenkestatus krever det.
- Ingen dump av navn, telefon, e-post, adresser eller kundemeldinger til rapport eller CI.

## Kjøre tester uten data/secrets

Fra repo-roten på riktig branch:

\`\`\`sh
python3 -m unittest discover -s tests -p 'test_legacy_release_guard.py' -v
\`\`\`

GitHub PR Verification kjører disse syntetiske testene uten Cloudflare-nøkler.

## Kjøre mot kontrollerte offline SQLite-kopier

**Dette må utføres av godkjent driftsoperatør med riktig D1-tilgang** og en kontrollert, isolert staging-rekonstruksjon. Eksporter aldri live kundedata til GitHub Actions/PR-artifakter eller til en agentlogg. Ikke legg databaser i repoet.

1. Opprett før-snapshot fra samme isolerte, uendrede datagrunnlag som du skal migrere. Sørg for at ingen kunde-/ansattoperasjoner skriver mens før-/etter-sammenligningen pågår.
2. Lag etter-snapshot ved å kopiere før-basen og kjøre **bare eksakt, godkjent additiv migrasjon** på kopien. Ikke sammenlign to løpende live-tidspunkt, for normal saksbehandling kan endre gamle statuser.
3. Kopier begge som gyldige lokale SQLite-filer i beskyttet mappe med egnede filrettigheter. Cloudflare Wrangler D1 \`export\` produserer SQL-tekst; bygg eventuelt en **separat SQLite-kopi lokalt** av godkjent SQL-eksport. Ikke gi scriptet SQL-tekst som \`.sqlite\`-fil.
4. Kjør:

\`\`\`sh
python3 scripts/maintenance/legacy_jobs_release_guard.py \
  --before /secure/offline/before.sqlite \
  --after /secure/offline/after.sqlite
\`\`\`

Utdata: \`result=PASS\` eller \`result=NO_GO\`, tellere per tabell og generiske feilkoder. Exit \`0\` = bestått, \`1\` = releaseblokkering, \`2\` = ugyldig eller uleselig kopi. To identiske filstier avvises.

5. Ved NO-GO: **ikke deploy**, ikke slett eller nullstill kundedata. Ta vare på D1 Time Travel/backup-referanse og den generiske rapporten, og løs avviket i en smal PR. Sjekk også staging UI med en eldre åpen sak, en lukket sak og et tidligere tilbud/ordre.
6. Ved PASS: legg inn i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39) kun dato, eksakt commit SHA, antall kontrollerte tabeller, generiske PASS/NO-GO og en intern backup-/rollbackreferanse – ikke rå kunde-/databasedump.

**Viktig:** **R2-inventarer for begge snapshots:** D1 kan ikke bevise at et R2-objekt finnes. Dersom `evidence_case_images` har referanser, må en autorisert operatør samle en komplett, tidskonsistent liste av tilgjengelige R2-objektnøkler fra riktig bucket i to **separate beskyttede, lokale** UTF-8 filer (én nøkkel per linje, inkl. miniatyrnøkler). Disse filene skal aldri publiseres i GitHub/CI. Ved eksport/migrasjon uten R2-snapshot på samme tidspunkt kan resultatet ikke brukes til GO. Kjør:

```sh
python3 scripts/maintenance/legacy_jobs_release_guard.py \\
  --before /secure/offline/before.sqlite \\
  --after /secure/offline/after.sqlite \\
  --r2-inventory-before /secure/offline/r2-before-keys.txt \\
  --r2-inventory-after /secure/offline/r2-after-keys.txt
```

Verktøyet returnerer `R2_INVENTORY_REQUIRED` hvis bilder finnes uten tilhørende inventory, eller `R2_MISSING_OBJECT_REFERENCES` dersom objekter mangler. Ingen faktiske R2-kall utføres. Dette er en kontroll av **referert objekt-eksistens**, ikke en verifikasjon av bildekvalitet eller byteinnhold. Den utvidede verifiseringen inkluderer også `ops_messages`, `ops_mail_sync_state`, `evidence_cases`, `evidence_case_images`, `evidence_case_review_events` og andre historiske tabeller med beskyttede prefikser.

Verktøyet er en *nødvendig, men ikke tilstrekkelig* kontroll. En grønn syntetisk CI-test er ikke det samme som full staginghandel, autentisert ansatt-E2E eller betalingsverifisering.

## Videre produksjonsgate
- [ ] Godkjent rollback- og D1-backupstrategi; eksakt oppdatert kandidat-SHA.
- [ ] Offline datadiff på kopi av **reelle** historiske saker/tilbud/ordre.
- [ ] Gammel åpen + lukket sak og eksisterende tilbud vist i autentisert staging.
- [ ] Manuell første-salg-flyt fra forespørsel til etterprøvbar ordre.
- [ ] Ingen ordre før aksept; manuell Kustom Portal-lenke; ingen fiktiv eller automatisk betaling.
- [ ] Gmail Workspace/alias-/personverngate samt ansattrolle/revokasjon verifisert.
- [ ] Grønn komplett QA, stagingdeploy, rollbackbevis og skriftlig GO/NO-GO før produksjonsdeploy.
