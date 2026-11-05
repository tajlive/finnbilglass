# Driftsenter, CRM og fakturagrunnlag — produksjonskontroll

Dato: 2026-11-05. Godkjent ramme: bruker ba om ferdigstillelse frem til produksjon; ingen nye abonnementer, eksisterende inkluderte kvoter. Fakturaprogram og faktisk fakturering avventer fortsatt.

## Aktiv leveranse

- Arbeidsflate: https://ops.finnbilglass.no/ops . Google/Cloudflare Access for eksisterende tillatt bruker er bevart og kontrollert i nettleseren.
- Hoved-Worker: `1f203159-681d-4bd2-a6b3-b36a56477205`, deployment `f352ddcd-b6ad-4e37-a01a-5ec89432621a`, 100 % trafikk.
- Kilde: `ba385d209146d56322e0955deef2c93f41dd995b` (inkluderer `5cf2b310`, `f701358b`, `715d5ef`). Isolert gren `feat/ops-free-workbench-20261105` i `/tmp/fbg-architect`.
- Gammel root-/ops-Worker: `8be108a8-cfdb-4b67-857a-1b1efaef3d07`, deployment `40ad798a-e796-4b23-83ed-ab00b0e1a0d5`, 100 %. Eksisterende to eksakte ruter beholdt; de sender nå til riktig Access-vert i stedet for å rendre gammelt tokenpanel.
- Root-adressen kontrollert med innlogget Chrome: `https://finnbilglass.no/ops` ender på `https://ops.finnbilglass.no/ops`. Uinnlogget root går fortsatt gjennom eksisterende Access før redirect; ingen sikkerhetspolicy er svekket.
- Tidligere katalog/adminpanel: https://ops.finnbilglass.no/ops?legacy=1 . Render og Access-identitet kontrollert.

## Produksjonskoden bevart

Lastet ned faktisk Worker før endring og sammenlignet med bygg fra hovedtreet. Bundlene var identiske bortsett fra den kjente lokale VIN-plausibilitetsrettingen. De 16 kontrollerbare endrede offentlige filene og fakta-siden var byte-like med produksjon. Min-side.html er sesjonsbeskyttet og sender uten innlogging til innloggingssiden. Samme kilde/vern er bevart.

Bare disse identifiserte produksjonsendringene ble kopiert inn i det isolerte arbeidstreet. Hovedtreets øvrige arbeidsfiler og Hermes-arbeidstreet ble ikke endret. VIN-/karosserigaten og samme kandidatgrunnlag ved innsending følger med.

## CRM og fremtidig fakturering

- Prioritert arbeidsliste; ansvarlig, neste handling, frist og historikk med verifisert operatør.
- Opprinnelig forespørsel, glassvalg og eldre tilbud/historikk beholdes. Salg, betaling og levering følges separat.
- Kunde-/firmanavn, kundetype, org.nr., faktura-e-post, adresse, postnummer, poststed, landkode og referanse lagres med versjonskontroll.
- E-postmaler, lagrede/gjenåpnbare utkast, mottakerkontroll og eksplisitt utsending via eksisterende Resend.
- Manuelt kontrollerte, faste tilbudsversjoner med glass, frakt, utstyr, levering, vilkår og beløp i øre. Kundeaksept gjelder én bestemt versjon. Ingen automatisk leverandørbestilling.
- Fakturagrunnlag lastes ned som JSON fra den aksepterte tilbudsversjonen. Leverandørens senere katalogpris endrer ikke historiske beløp.
- Eksporten angir `INVOICE_BASIS`, `invoiceCreated:false`, hva som mangler, og om saken er klar. Testsaker kan ikke bli fakturaklare. Ingen fakturanummer tildeles, ingen faktura utstedes og ingen betaling tas.
- Dette er egen saksoppfølging og et definert eksportgrunnlag. Ingen ekstern CRM-/regnskapsintegrasjon eller nytt fakturaprogram er aktivert.

## Migrasjon og backup

Full produksjons-D1 eksportert lokalt før endring (beskyttet fil med rettighet 0600); faktisk Worker og konfigurasjon sikkerhetskopiert uten å hente ut hemmelige verdier.

Kun `migrations/pending/0051_ops_workbench.sql` og `0052_ops_customer_handoff.sql` kjørt på produksjonens inquiry-DB `finnbilglass-db`. Begge prøvd to ganger på samme ferske dump i isolert SQLite; integritet OK og gamle radantall uendret. Ingen andre pending-migrasjoner, ingen 0050, ingen katalogimport.

Før/etter: katalog **30 937**, ground_truth **32 307**, forespørsler **18**. De nye tabellene var tomme før merkede driftskontroller. Eksisterende saker ble ikke konvertert/slettet. Én eksisterende merket testsak fikk syntetiske kunde-/oppfølgingsdata og ett usendt e-postutkast.

## E-postkobling og kostnad

Produksjon har egne tilbudslenkenøkler og faktisk signing secret for den nye Resend-webhooken, lagret som Cloudflare-secrets. Verdier finnes ikke i kildekode/rapport.

Resend-webhook: `ddd71bed-c16e-4442-9196-1ba2c1c0eea5`, endpoint `https://finnbilglass.no/api/webhooks/resend`, enabled. Bare seks hendelser valgt: sent, delivered, delivery_delayed, failed, bounced, suppressed. Eksisterende deaktivert Klarpakke-webhook er urørt. Ingen oppgradering eller betalingsmetode lagt til.

- Usignert produksjonskall: 401.
- Signert syntetisk produksjonshendelse: 200, samme event-ID gjentatt: 200, bare én hendelsesrad lagret.
- Dette beviser signaturkontroll/deduplisering mot det publiserte endepunktet. Det beviser ikke faktisk e-postlevering; ingen ny e-post ble sendt under produksjonskontrollen.
- Kundesvar går fortsatt til support@finnbilglass.no. Postkassen er ikke automatisk synkronisert med arbeidsflaten; dette står uttrykkelig i panelet. Ingen MX- eller videresendingsendring.
- Ingen nye abonnementer. Eksisterende Workers-plan og Resend Free beholdt. Panelet har grense 50 utsendingsreservasjoner/24t; global Resend-kvote deles også med innlogging/kvitteringer.

## Kontroller

- `npm run qa`: exit 0, **646 PASS**, 0 FAIL, 0 SKIP. **31** målrettede workbench-tilfeller inngår.
- Typekontroll, JS-syntaks og diff-kontroll: PASS.
- Uavhengig kodegjennomgang: ingen P1-blokker. To P2-funn rettet og regresjonstestet: landkode valideres før avkorting; e-postfeil sorteres etter sending/reservasjon, ikke utkastets opprettelsestid.
- Nettleser i produksjon: Access, kø, gammel historikk, syntetisk kunde på merket sak #45, oppfølging, e-postutkast/gjenåpning/forhåndsvisning, eksport og gammelt katalogpanel: PASS. Ingen Send-knapp eller kundeaksept klikket.
- Eksport fra #45: `invoiceCreated:false`, `ready:false`; mangler «Akseptert tilbud» og «Testsak kan ikke faktureres», som forventet.
- Mobil: 390 CSS-piksler, scrollWidth 390. Desktop kontrollert på faktisk nettleserbredde 1422. Bilder i `reports/screenshots/ops-production-{mobile,desktop}.png`.
- `/health`, forside, om oss, betaling, fakta-side, pilotstatus: 200. `/min-side`: 302 til innlogging uten sesjon. Admin er fortsatt Access-beskyttet.
- GLE SUV: VERIFY/3, riktige mulige 5503-produkter. GLE Coupé: VERIFY/6, mulige 5508-produkter. Katalogkonsistens er ikke uavhengig fysisk passform.

## Tilbakeføring og videre bruk

Hoved-Worker kode tilbake til `ddfe04c8-c6b6-44eb-b2ba-95c81aeb7667` (rett før releasen, samme gamle kode som `f6d4bc15`, med nye secrets bevart), eller slå av OPS_WORKBENCH_ENABLED. Behold nye tilbud, aksepter, meldinger og kundedata; ikke dropp tabellene. Katalog- og legacy-panel berøres ikke av å skru av arbeidsflaten.

Ops-entry kan tilbakeføres til `75206370-a4e9-464f-883f-dbde10e96412`, men direkte ops-vertsadresse bør brukes; gammel versjon rendrer det utdaterte panelet. Eksisterende Access-regler og Google-bruker er ikke endret.

Videre aktivering: velg fakturaprogram når brukeren gjenåpner dette. Bekreft eventuell supportpostkasse-synkronisering separat før virkelige innkommende kundemeldinger rutes. Første virkelige tilbud sendes manuelt etter glass-, pris-, frakt- og leveringskontroll. Ingen automatisk kundekontakt eller påminnelser er aktivert.

Kilde, rapport og tag er lagret lokalt. Repoet er offentlig; denne grenen med eldre rapporthistorikk er ikke pushet automatisk, for å unngå å publisere kundebasert testhistorikk. Produksjonskoden er identifisert med eksakt SHA over og Cloudflare-versjonen, ikke omtalt som merge til main.
