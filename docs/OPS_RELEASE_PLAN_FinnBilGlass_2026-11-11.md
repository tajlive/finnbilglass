# FinnBilGlass — varig OPS-utviklings- og produksjonsplan

**Oppdatert:** 11. november 2026  
**Foreslått plassering i repo:** `docs/OPS_RELEASE_PLAN.md`  
**Status:** Arbeidsplan. Dette dokumentet er laget uten direkte GitHub-tilgang og er **ikke** committet.  
**Prinsipp:** Få første salg i produksjon så raskt som mulig, uten å miste gamle jobber eller kompromittere kunde-, e-post- eller betalingsdata.

> **Kilde til sannhet:** Denne filen i GitHub når den er sjekket inn. Oppdater status ved hver PR og deploy. Ikke behandle en oppgave som fullført uten lenke til grønn QA/deploy eller tilsvarende konkret bevis.

## 1. Hvor vi står (sist bekreftet i prosjektarbeidet 11.11.2026)

| Område | Status | Bevis / merknad |
|---|---|---|
| Staging hovedkandidat | `staging/first-sale-20261110` → `main`, draft PR #57 | https://github.com/tajlive/finnbilglass/pull/57 |
| Gmail read-only OAuth | Samtykke lagret i staging, ikke produksjonsimport | Forventet postboks: `tomarne@finnbilglass.no`; profilkontroll påkrevd før lesing |
| Kontrollert Gmail-kodesett | Deployet og smoke-testet i staging | https://github.com/tajlive/finnbilglass/actions/runs/42942481383 |
| Utgående SENT-filter | Bare relevante en-til-en-meldinger til kjent kunde speiles; ukjente/private adresser filtreres bort | PR #59 flettet inn i staging |
| Enklere tilbudsfelt | Varenummer **og/eller** varenavn, frivillig beskrivelse, totalpris i NOK; lagret produktsnapshot | PR #60 flettet inn i staging: https://github.com/tajlive/finnbilglass/pull/60 |
| Staging av nye varefelt | Bestått deploy og helsesjekk | https://github.com/tajlive/finnbilglass/actions/runs/42944909938 |
| QA etter opprydding | Grønn | https://github.com/tajlive/finnbilglass/actions/runs/42945069626 |
| Gmail automatisk import | **Av** (`GMAIL_SYNC_ENABLED=false`), skal forbli av inntil innkommende alias og korrekt postboks er verifisert | Ingen bakgrunnssynk slås på som del av generell utrulling |
| Produksjonslansering | **Ikke bekreftet / NO-GO** | Første-salg-E2E og gamle jobber må valideres |
| Kontrollscript for historiske jobber | Utarbeidet som separat fil; ikke lagt i repo / ikke kjørt mot virkelig D1 | `legacy_jobs_release_guard.py` fra denne samtalen |

Ikke anta at senere kodeendringer, stagingflagg, migrasjoner eller produksjonsstatus er uendret uten å hente ny GitHub-/Cloudflare-status.

## 2. Produktmålet: Operations Center 2.0, enklere før større

Én arbeidsflate med fire hovedområder:

1. **Oversikt:** innbokslignende arbeidskø sortert etter ny sak, manglende informasjon, tilbud som må sendes, tilbud som venter på kunde, klar til ordre/betaling.
2. **Kundesaker:** kunde, bil, bilder, grunnlag for kontrollert glassvalg, samtale/e-post, notater og historikk i én sak. **Gamle saker vises også.**
3. **Tilbud og ordre:** produktlinjer med varenummer og/eller varenavn, eventuell beskrivelse, antall, linjepris, frakt, total og NOK inkl. mva.; manuell kundeaksept før ordre.
4. **Administrasjon:** ansatte, roller, revisjonsspor og integrasjonsstatus. Avanserte kontroller skjules fra normal arbeidsflyt.

Prioriter enkel arbeidsflyt fremfor flere dashboards.

## 3. Viktigste krav: gamle jobber skal følge med

**Ikke opprett en ny tom saksliste eller flytt/skriv om originaldata for å få ny UI til å fungere.**

- Behold gamle `beta_inquiries` (kunde, bil og status), `beta_inquiry_events`, bilder, notater, e-postlogg og aktivitetslogg.
- Behold `ops_manual_offers`, `ops_manual_orders`, `ops_offer_outbox` og betalingsreferanser uten å endre aksepterte vilkår.
- Ikke gjør status-reset av NEW/CONTACTED/NEEDS_INFO/OFFERED/CONFIRMED/CLOSED/REJECTED.
- Ny liste-/kolonnevisning skal lese **samme historiske og nye saker**, med en tydelig mapping fra gamle statuser til visning.
- Gamle enkelt-SKU-tilbud må vises korrekt uten nytt `offerProduct`-metadataobjekt.
- Tilbud opprettet med bare varenavn bruker intern `UTEN-VARENUMMER`; denne markøren må aldri vises for kunden som et reelt produktnummer.
- Senere flervarelinjestøtte må være **additiv**: frosset varelinjesnapshot i ny tabell eller kompatibelt format. Historisk `sku`, `total_minor` og aksept-/ordrelogikk må ikke endre betydning.
- Tidligere aksepterte tilbud og ordre er immutable; nytt tilbud må bli en ny versjon, ikke redigere eksisterende avtale.
- Ta databasebackup/snapshot før og etter enhver migrasjon. Kjør kontroll av antall, nøkler, priser, relasjoner og status.

## 4. Prioritert utviklingsrekkefølge (små PR-er)

- [x] **A. Manuelt tilbud med varenummer/navn/beskrivelse/NOK-pris** — PR #60, stagingdeploy og QA grønn.
- [ ] **B. Første-salg-E2E med eksisterende staging** — innkommende sak → sikker glasskontroll → tilbud → faktisk dokumentert aksept → ordre → manuell Kustom Portal-lenke → manuell verifikasjon. Ingen fiktiv betaling.
- [ ] **C. Bakoverkompatibilitet mot gamle jobber** — audit/script, stagingkopi, null endrede historiske ordrevillkår, vis eldre saker/tilbud.
- [ ] **D. Handlingsorientert oversikt** — én kø med filtre og neste handling, leser eksisterende saker; minimal datamodellendring.
- [ ] **E. Katalogsøk med autofullføring** — ansatte kan søke etter varenummer **eller** varenavn i eksisterende autoritativ katalog. Vis kvalifiserende treff, tydelig pris/kilde; fri manuell vare blir fortsatt mulig. Katalogtreff må ikke automatisk bevise fitment til bil.
- [ ] **F. Flere varelinjer** — varenummer/navn/beskrivelse/antall/enhetspris/linjesum, frakt og totalsum; nøyaktig øreberegning i API, NOK-format i UI, snapshots og versjonering. Legg til kompatibilitetsvisning av gamle enkeltvaretilbud.
- [ ] **G. Ende-til-ende regresjon før release** — gammel lukket sak, gammel aktiv sak, eldre tilbud, navnebasert ny vare, flervaretilbud, aksept/ordrekontrakt og rettigheter.
- [ ] **H. Produksjonsdeploy** — kun når kriteriene under er grønnmerket og godkjent, med backup og rollback-plan.

**Raskeste vei til markedet:** Hvis B–C og produksjonsgate er bestått, vurder å lansere eksisterende *enkle* tilbudsfunksjoner først. Ikke la et stort flervarelinjeprosjekt forsinke første salg uten forretningsmessig grunn. D–F kan lanseres iterativt etterpå.

## 5. Sikker og konkret release-gate

### Må være sant før produksjon (GO)

- [ ] GitHub QA, TypeScript, integrasjons-/SQLite-tester og staging-build er grønne for *eksakt commit* som skal deployes.
- [ ] Isolert staging D1 fungerer; alle nødvendige migrasjoner er øvd i kopi og har dokumentert backup/rollback.
- [ ] Tre ekte historiske casetyper (gammel lukket, gammel åpen, eksisterende tilbud/ordre) er gjennomgått mot pre/post-snapshot: ingen tap av data, endrede beløp eller dubletter.
- [ ] Tilgangs- og rollesjekk med autentisert medarbeider er godkjent; gamle support-token gir ikke nye ordreprivilegier.
- [ ] Reelt eller kontrollert første-salg-E2E er godkjent; sending, aksept og ordre er sporbare, og ingen ordre opprettes fra bare DRAFT/SENT uten aksept.
- [ ] Resend-send er idempotent. Usikker sendstatus avstemmes manuelt i stedet for gjentatt sending.
- [ ] Kustom-portalens betalingsreferanse er fortsatt manuell. **Ikke** marker betaling som bekreftet bare fordi lenke er sendt.
- [ ] Gmail-verifisering: riktig Workspace-postboks er kontrollert, og inbound alias/leveringsvei er verifisert **før** noen virkelig import. Behold `GMAIL_SYNC_ENABLED=false` inntil særskilt avgjørelse.
- [ ] Ingen produksjonsinnstillinger, kunde-e-poster, betalingshandlinger eller produksjons-D1 er endret gjennom QA-jobber.
- [ ] Produksjon har tydelig rollback og overvåking; deploy bekreftes av konkrete resultater.

### Hvis noe feiler (NO-GO)

Stans produksjonsdeploy. Rull eventuelt tilbake kode, men **ikke** rull blindt tilbake databasen hvis ordre allerede er skrevet. Gjennomgå differansen og dokumenter avvik.

## 6. Hva som skal testes for flere varelinjer

- Antall × pris i heltallsøre; ingen flyttallsfeil i lagret beløp; moms/frakt tydelig; API beregner totalen.
- Varenummer alene, varenavn alene, begge og ingen av dem (siste skal avvises).
- Eksisterende `sku`-baserte tilbud lastes og sendes korrekt.
- Produktlinjer fryses ved utsending/aksept; historiske ordre påvirkes ikke av senere katalognavn/prisendringer.
- Tom vare, null/negativ pris, enorme tekstfelt, race conditions og duplisert klikk avvises.
- Kunde-e-post inneholder faktiske varenavn/nummer, beskrivelse og total, ikke tekniske interne markører.
- Rettigheter, auditering og skrive-opphavssjekk beholdes.

## 7. Neste praktiske GitHub-steg

1. Legg denne planen i **`docs/OPS_RELEASE_PLAN.md`** på en egen branch og åpne en liten PR mot `staging/first-sale-20261110`.
2. Legg gjerne `legacy_jobs_release_guard.py` i `scripts/maintenance/` etter kodegjennomgang.
3. Opprett ett GitHub Issue kalt **«OPS release: gammel data + første-salg-E2E + produksjon»**, lenk denne planen og bruk sjekklisten over.
4. Oppdater dette dokumentet med dato, commit SHA, QA-run og produksjonsbevis hver gang noe er fullført.
5. Etter gjenopprettet GitHub-tilgang: hent siste repo-status før neste kodeendring.

### Tydelige beslutninger tatt underveis

- Brukervennlighet først: færre klikk, flere funksjoner på samme sak.
- Manuell vare skal alltid være mulig selv uten katalogtreff.
- Gamle saker, tilbud, ordre og kundehistorikk skal ikke slettes eller nullstilles.
- Produksjon ønskes **raskt**, men ikke ved å hoppe over validering av kundedata og betalingsstatus.
- GitHub-planen, ikke samtaleminnet, skal fungere som varig fremdriftslogg.
