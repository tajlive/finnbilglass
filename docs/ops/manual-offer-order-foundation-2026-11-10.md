# Operations Centre – manuell ordre etter kundens aksept

**Produktbeslutning 10. november 2026:** FinnBilGlass er en nettbutikk med manuell kontroll av glass, tilbud og ordre. Kustom Portal sender betalingslenken manuelt. Det skal ikke finnes automatisk checkout, capture, refund eller betalingspolling i denne løsningen.

## Datakontrakt i dette arbeidet

Den foreslåtte, **ikke anvendte**, SQLite/D1-migrasjonen `migrations/proposed/0040_ops_manual_offer_order.sql.proposed` oppretter:

- `ops_manual_offers`: én versjonert pris og spesifisert SKU per tilbud, referanse til fitment-bevis, utstyr og frakt. Tilbudet er `DRAFT` → `SENT` → `ACCEPTED` eller `DECLINED`.
- Kundens aksept må dokumenteres med dato, kanal og identifiserbar bevisreferanse (for eksempel ID til en e-post i saken). Uten dette kan tilbudet ikke bli `ACCEPTED`.
- `ops_manual_orders`: maks én ordre per akseptert tilbud og henvendelse. En database-trigger nekter ordre uten akseptert tilbud og korrekt SKU, total og valuta. Tilbud og ordrevilkår låses etter aksept.
- `ORDER_CREATED` → `PAYMENT_LINK_SENT` → `PAYMENT_VERIFIED_MANUALLY` er **administrative statusregistreringer**, ikke noen Kustom API-handling. Betalt-status krever separat portalreferanse, tidspunkt og hvem som kontrollerte betalingen.

## Gjenstående før API/UI kobles til

1. **Krever verifisert innlogging og roller:** eksisterende Support-token i `main` er ikke tilstrekkelig som eneste kontroll ved nye ordre. Kombiner med eksisterende Cloudflare Access/ansattroller og tilgangs-/MFA-test fra Operations Centre-grenen.
2. Første tilbud skal opprettes fra manuelt kontrollert SKU med riktig utstyr og bekreftet pris inkl. mva./frakt. Frys pris- og glassvalg i versjonert tilbud.
3. Tilbudsutsendelse og aksept skal registreres via reell e-posthistorikk eller dokumentert manuelt svar fra kunden. Ikke bruk en statusknapp alene som bevis på kundeaksept.
4. Lag sikkert API med idempotens, test av konkurrerende forespørsler, ukjent/utgått tilbud, feil rolle og avbrutt transaksjon.
5. Synliggjør ordre i Operations Centre etter aksept, men hold knappen for Kustom som «Åpne Kustom Portal», uten API-automatikk. Registrer Payment Link-referanse manuelt i saken.
6. Avstem manuelt betaling i Kustom Portal. **Ikke** sett betalt basert på utsendt lenke eller checkout-autorisasjon.
7. Avklar migrasjon mot faktisk staging D1 med backup og rollback før flytting fra `proposed/`. Ingen produksjonsmigrasjon er tillatt fra denne PR-en.

## Testing og avgrensning

`tests/ops-manual-order-sqlite.test.mjs` bruker ekte SQLite med utenlandsnøkler slått på. Den prøver å omgå aksept- og betalingsreglene direkte via SQL. Ingen kjøring krever Kustom-nøkler, gjør pengeoperasjoner eller skriver til Cloudflare.

**Denne leveransen er datakontrakt og kvalitetssikring, ikke en aktiv ny salgsfunksjon.** Den skal vurderes sammen med OPS-tilgang og e-posthistorikk før staging-E2E.
