# FinnBilGlass — varig OPS-utviklings- og produksjonsplan

**Oppdatert:** 11. november 2026  
**Plassering i repo:** `docs/OPS_RELEASE_PLAN_FinnBilGlass_2026-11-11.md`  
**Status:** Committet til `main` 11.11.2026 som `ccfc1ca55c4745af4403bb3fd439ed628735bd39`. OPS-produksjonsrelease fortsatt **NO-GO** inntil første-salg-E2E og kontroll av eksisterende jobber er dokumentert.  
**Prinsipp:** Få første salg i produksjon så raskt som mulig, uten å miste gamle jobber eller kompromittere kunde-, e-post- eller betalingsdata.

> **Kilde til sannhet:** Denne committede filen er beslutnings- og releaseplan. GitHub Issues (og eksisterende GitHub Project hvis aktivt) styrer oppgavene. Oppdater status ved hver PR og deploy. Grønn QA eller grønn deploy av `main` beviser **ikke** at draft OPS-kandidat #57 er lansert.

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

## 7. Verifisert GitHub-status og neste steg (11.11.2026)

1. **Hovedplan er allerede lagret:** [GitHub-commit `ccfc1ca`](https://github.com/tajlive/finnbilglass/commit/ccfc1ca55c4745af4403bb3fd439ed628735bd39). Ikke opprett en konkurrerende planfil.
2. **Release og gamle jobber:** Fortsett i eksisterende [Issue #39](https://github.com/tajlive/finnbilglass/issues/39): staging-/prod-D1-backup, kontroll av eldre saker/tilbud/ordre, eksakt SHA, rollback og GO/NO-GO.
3. **Første salg:** Fortsett i [Issue #52](https://github.com/tajlive/finnbilglass/issues/52): kundeforespørsel → kontrollert glassvalg → tilbud → dokumentert aksept → ordre → manuell Kustom-referanse. Reell betalingsstatus verifiseres manuelt.
4. **Tilgang og e-post:** Gjenbruk eksisterende Issues [#38](https://github.com/tajlive/finnbilglass/issues/38), [#37](https://github.com/tajlive/finnbilglass/issues/37) og [#36](https://github.com/tajlive/finnbilglass/issues/36). Ikke dupliser arbeidsoppgaver.
5. **OPS-kandidat:** [draft PR #57](https://github.com/tajlive/finnbilglass/pull/57) på `staging/first-sale-20261110`. Sist kontrollerte commit: `b55e8c2f825341bcefcd031c8575f02145ef0b08`. [QA #42945069626](https://github.com/tajlive/finnbilglass/actions/runs/42945069626) var grønn, men **full første-salg-E2E og live legacy-data er ikke dokumentert**.
6. **Produksjon:** [Deploy #42958729574](https://github.com/tajlive/finnbilglass/actions/runs/42958729574) og [nightly #42959468766](https://github.com/tajlive/finnbilglass/actions/runs/42959468766) var grønne for `main` på `ccfc1ca`. Det betyr **ikke** at #57 er slått sammen i produksjon.
7. **Legacy-kontrollscript:** Versjon 2 er testet lokalt med syntetiske SQLite-fixtures; tillater nye rader, men stopper slettede/endrede historiske rader. **Ikke lagt i repo, og ikke kjørt på ekte databasekopier**. Neste steg: legg scriptet i en liten egen PR, test på offline eksport før/etter, og bekreft visning i autentisert staging.
8. **Gratis GitHub-fart/AI:** Se [docs/GITHUB_FREE_SETUP.md](GITHUB_FREE_SETUP.md) for eksisterende CI, Dependabot, Copilot Free og GitHub Settings. Hold AI-API-kostnad og produksjonsdeploy avskrudd som standard.
9. **GitHub Projects:** Repo-metadata viser at `has_projects=true`, men dette er **ikke** bekreftelse på at et Projects V2-brett finnes. Gjenbruk ett eksisterende brett hvis funnet; legg eksisterende Issues og PR-er inn der. Prosjektbrettstatus må kontrolleres i GitHub-grensesnittet.
10. Oppdater denne filen med eksakt status, commit, QA-run og produksjonsbevis når hver milepæl er dokumentert.

### Tydelige beslutninger tatt underveis

- Brukervennlighet først: færre klikk, flere funksjoner på samme sak.
- Manuell vare skal alltid være mulig selv uten katalogtreff.
- Gamle saker, tilbud, ordre og kundehistorikk skal ikke slettes eller nullstilles.
- Produksjon ønskes **raskt**, men ikke ved å hoppe over validering av kundedata og betalingsstatus.
- GitHub-planen, ikke samtaleminnet, skal fungere som varig fremdriftslogg.
