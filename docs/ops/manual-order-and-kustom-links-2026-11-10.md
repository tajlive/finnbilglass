# FinnBilGlass – manuell salgs- og betalingsflyt (besluttet 10.11.2026)

## Produkteierens beslutninger

- Full nettbutikk som på sikt viser alle glassalternativer for **eksakt bil** og lar kunden avgrense med relevante utstyrsvalg. Ingen automatisk godkjenning av glass uten dokumentert treff.
- Kunden sender først en **uforpliktende forespørsel** til Operations Centre (OPS).
- Ansatte bruker etablerte søk-/produktkilder til å verifisere riktig glass, priser og levering. Priser på kundesiden følger **eksisterende regelverk**.
- Ansatte sender kontrollerbart tilbud. **OPS-ordre opprettes først etter at kunden aksepterer tilbudet**.
- Betalingslenke opprettes og sendes **manuelt**, ingen automatisk checkout, capture eller refund fra FinnBilGlass.
- Kundene kan betale med **Vipps, Klarna, Visa og Mastercard** (bekreftet aktive av produkteier).
- E-posthistorikk inngår fra første dag. Fakturaintegrasjon og automatisk fraktbestilling er utsatt.
- **Fase 1** er forside med betalingslogoer. OPS/produktavgrensning er egen fase, ikke del av denne statiske forside-PR-en.

## Valgt operativ betalingsløsning: Kustom Portal / Payment links

Kustoms egen brukerstøtte (oppdatert september 2026) beskriver oppretting og sending av
betalingslenker **uten integrasjon**:
https://help.kustom.co/en/articles/418365-how-to-create-and-track-orders-in-the-kustom-portal

Sikker operatørprosedyre:

1. Motta kundeforespørselen i OPS. Kontroller bil, glassvariant/utstyr, pris inkl. mva., frakt og vilkår.
2. Send et skriftlig tilbud. Registrer **kundens aksept** med tidsstempel og tilbudsversjon.
3. Opprett **én** OPS-ordre fra akseptert tilbud, lås totalsum og tildel entydig OPS-ordre-ID.
4. Åpne https://portal.kustom.co og gå til **Payment links**. Verifiser riktig butikknavn/store ID.
5. I **Configuration**: legg inn gyldig offentlig vilkårslenke, for eksempel https://finnbilglass.no/vilkar.html.
6. Opprett manuelt en Payment link: mottakers e-post/SMS, land, og eksakte varelinjer med antall, pris, mva., frakt og evt. rabatt. Sett **Merchant Reference 1 = OPS-ordre-ID**. Ikke opprett en andre OPS-ordre i betalingsportalen.
7. Velg **ikke automatisk capture** ved oppretting dersom operativ prosess krever manuell capture; kontroller og godkjenn capture separat i Kustom Portal ved riktig tidspunkt. Ikke anta at autorisasjon = innbetalt.
8. Kustom Portal sender betalingslenken via e-post eller SMS. Registrer lenkereferanse, dato, mottaker og utsendelseskanal i OPS-saken; unngå dobbeltutsendelse fra to systemer.
9. Kontroller status i **Payment links → History / Orders** manuelt før utlevering. Match butikk, beløp, valuta og **Merchant Reference 1** mot OPS-ordre. Ikke marker `PAID` bare fordi lenken er opprettet eller kunden har åpnet den.
10. Kustom oppgir **48 timers** gyldighet. Ved utløpt eller kansellert lenke: bruk Portal **Duplicate** når det er tillatt; registrer ny lenkereferanse i samme OPS-ordre, ikke opprett en ny kundeordre.
11. Endringer etter utsending: kanseller lenken og opprett korrigert lenke med samme OPS-referanse etter ny tilbudsaksept om totalsum endres.
12. Manuelle refusjoner og avvik håndteres bare av autorisert personell i Kustom Portal. Ingen automatiske pengeoperasjoner aktiveres i FinnBilGlass.

## Ikke inkludert i første release

- API-opprettelse av Kustom/HPP, automatisk betalingsstatus, auto-capture/refund og cron-avstemming.
- Fakturasystem og fraktbestillingsintegrasjon.
- Automatisk aksept av OE/glasskandidat; utilstrekkelig evidens betyr kontroll hos OPS.

## Frontend- og utgivelsesregel

- `public/index.html` viser de fire statiske akseptlogoene likestilt ved søket.
- Ingen Kustom Elements-klient, betalings-widget, checkout-skjema eller nøkler i klient-HTML.
- `public/betaling.html` forklarer tilbud → aksept → OPS-ordre → manuell lenke.
- Betalingstilgjengelighet i den faktiske lenken avhenger av Kustom-avtale, kunde og valg; logoer er en generell akseptopplysning, ikke en garanti for hvert finansieringsvalg.
- **OPS-kode fra draft PR #50 skal ikke merges ukritisk**, fordi den inneholder betalingsautomatisering utenfor den nye bestillingen.

## Kilder

- Kustom, opprette og spore Payment Links:
  https://help.kustom.co/en/articles/418365-how-to-create-and-track-orders-in-the-kustom-portal
- Kustom Portal produktoversikt:
  https://www.kustom.co/products/portal
- Vipps merkeretningslinjer:
  https://developer.vippsmobilepay.com/docs/knowledge-base/design-guidelines/
- Mastercard godkjente akseptmerker:
  https://www.mastercard.com/brandcenter/us/en/brand-requirements/mastercard.html
