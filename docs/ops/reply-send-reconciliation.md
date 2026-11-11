# OPS kundesvar – varig engangsutsending og manuell avstemming

**Status:** Kun stagingkandidat. Ingen automatisk migrasjon mot produksjons-D1.

## Prinsipp

Før Resend kontaktes, opprettes en unik `ops_reply_attempts`-reservasjon i samme D1 som `ops_reply_outbox`. Hele kundesvaret – mottaker, avsender, emne, HTML, tekst, operatør, saks-ID og meldingsnøkkel – fryses.

Flyt: `QUEUED` (gammel outbox) → `SENDING` (ny attempts-tabell) → `SENT` eller `REVIEW`. `SENDING` og `REVIEW` skal **aldri** utløse automatisk nytt Resend-kall. Et krasj etter reservasjon kan derfor holde tilbake en ikke-sendt e-post, men kan ikke dobbeltsende den.

Den additive, **foreslåtte** migrasjonen er `migrations/proposed/0046_ops_reply_attempts.sql.proposed`. Den endrer ikke gamle rader i `ops_reply_outbox` og setter eksisterende usikre `QUEUED`/`FAILED` til `REVIEW` i den nye tabellen. Også en gammel `QUEUED` kan ha blitt sendt før en tidligere D1-feil; den må derfor ikke forsøkes på nytt.

## Avstemming ved `REVIEW` eller `SENDING`

1. Stans ny utsending for samme `request_id`. Ikke lag en ny meldingsnøkkel for å omgå sperren.
2. Autorisert administrator kontrollerer Resend-aktivitet og mottaker/sak mot den frosne outboxen. Undersøk om provider returnerte eller mottok meldingen; manglende provider-ID er **ikke** bevis på at den ikke ble sendt.
3. Dersom en eksisterende Resend-ID finnes, dokumenter denne i kontrollert manuell avstemming. Ved usikkert resultat må kunden ikke få en ny e-post før nødvendig avklaring.
4. En dokumentert, særskilt autorisert avstemmingsfunksjon skal senere kunne journalføre verifisert sendestatus *uten provider POST*. Ikke rediger historiske avtaler eller utløste ordre for å dekke over feil.
5. Registrer kun nøkkel, generisk status og en intern kontrollreferanse i release-issue. Ingen kundebody, e-post eller provider-secrets i GitHub.

## Release-gate

- [ ] Eksakt migrasjon kontrollert mot beskyttet staging-D1-kopi med før/etter og rollback/Time Travel-referanse.
- [ ] Kun denne migrasjonen anvendt i autorisert stagingmiljø; ikke alle `pending`/foreslåtte filer.
- [ ] Syntetisk test: to samtidige kall, provider-timeout etter mulig aksept, D1-feil etter provider-aksept, retry etter 25+ timer.
- [ ] Det sendes høyst én provider-forespørsel per `request_id`; én journalhendelse ved sikker SENT; ingen falsk SENT uten provider-ID.
- [ ] Eldre `QUEUED` og `FAILED` kan ikke sendes på nytt automatisk.
- [ ] Ansattinnlogging/Origin-kontroll og manuell RESEND-avstemming testet i autentisert staging.
- [ ] Ingen produksjonsdeploy eller ekte kundesending før GO/NO-GO i Issues #39 og #52.

Dette er tilstandssikring, ikke automatisk utgående gjenoppretting. Ingen automatisk retry, betaling, capture eller refund er innført.
