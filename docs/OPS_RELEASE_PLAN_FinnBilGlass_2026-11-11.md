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

## 8. Issue-opprydding 11.11.2026 – aktivt arbeidsutvalg

Gjennomgått direkte mot GitHub (ikke generert fra gammel samtaleminne). **10 åpne GitHub Issues før, 8 etter**. Ingen kode, kundedata eller produksjonsinnstillinger endret gjennom denne oppryddingen. Lukking bevarer historikk og commits; ingen hard deletion av Issues.

### Arkivert og konsolidert
- [#23](https://github.com/tajlive/finnbilglass/issues/23) **lukket som duplikat av #52**: samtlige relevante krav om åpne uforpliktende forespørsler, idempotens, botvern, rate limiting, postnummer, kill-switch og IDOR er lagt inn i hovedoppgaven #52. Foreldet Brevo-beskrivelse er erstattet av Resend. **Ingen produksjonsaktivering**.
- [#19](https://github.com/tajlive/finnbilglass/issues/19) **arkivert som historisk hendelse**. Den synlige issue-beskrivelsen er renset for unødvendige logg-/lokasjonsdetaljer. Tidligere GitHub-revisjoner kan fortsatt finnes. Ingen produksjons-D1-rader er slettet; forebygging og utrullingskontroll spores i #20.
- Eldre PR-er #15, #30, #50, #54, #55 og #56 er lukket med begrunnelser. **Ikke** bruk de gamle PR-ene som releasegrunnlag. #57 beholdes åpen for OPS.

### Åpne saker, samlet prioritering

| Prioritet | Issue | Hvorfor beholdt / avslutningsvilkår |
|---|---|---|
| P0 | [#39 Produksjonsgate](https://github.com/tajlive/finnbilglass/issues/39) | Eksakt Worker-SHA, Cloudflare/D1-backup/rollback, gammel-jobb-diff, skriftlig GO/NO-GO |
| P0 | [#52 Første manuelle salg](https://github.com/tajlive/finnbilglass/issues/52) | Offentlig forespørsel → manuelt tilbud → dokumentert aksept → én ordre → Kustom Portal-lenke, korrekt e-post |
| P0 | [#36 Auth/rolle](https://github.com/tajlive/finnbilglass/issues/36) | Atomiske rolleoppdateringer, bevar brukeren, avvis tilbakekalte sesjoner; separat tidligere PR #41 må vurderes, ikke blindmerges |
| P0 | [#35 Produksjons-smoke](https://github.com/tajlive/finnbilglass/issues/35) | Kode for ikke-skrivende Chrome-salgssmoke er oppdatert på main, men faktisk prod/staging-E2E på riktig SHA gjenstår |
| P0 | [#20 Regnr-/personvernkontroll](https://github.com/tajlive/finnbilglass/issues/20) | Kode og SQLite-test allerede grønne på main. Sist undersøkte main-Actions `42961324309`: test/security **success**, men deploy/smoke **skipped**. Først lukk etter faktisk produksjonsverifisering |
| P1 | [#38 E-post/Gmail](https://github.com/tajlive/finnbilglass/issues/38) | Korrekt historikk, sikker Gmail profil-/aliasverifikasjon og opt-in import før reell kundedata |
| P1 | [#37 Ansattinvitasjon](https://github.com/tajlive/finnbilglass/issues/37) | Invitasjon → tilgang → tilbakekalling etter autentisert staging-E2E |
| P2 | [#22 Katalog/typekode](https://github.com/tajlive/finnbilglass/issues/22) | Reell datakilde/rettigheter, varianter og korrekt glassmatching; egen backlog, ikke blokkér enkel manuell salgsstart uten ny risiko |

**Ikke lukket som «søppel»:** De åtte sakene representerer forskjellige arbeidspakker eller uavklarte tester. Stale beskrivelser kan oppdateres, men å lukke dem uten verifiserte resultater ville skjule release-risiko.

**Produksjonsstatus:** Fortsatt **NO-GO** for ny OPS-flyt i PR #57 uten dokumentert E2E, legacy-data og rolle-/betalingstester. Eksisterende grønne `main`-Actions innebærer ikke automatisk prod-Worker-deploy.

## 9. Produksjonsframdrift – 11.11.2026, etter PR #65–#67

**Siste bekreftede OPS-kandidat:** \`staging/first-sale-20261110\` på SHA \`af8193ec8d3b481ba1f77b783ce41f8f4b8f6b01\`. [PR #57](https://github.com/tajlive/finnbilglass/pull/57) er nå **mergeable=true / clean**, men fortsatt **draft**. [PR Verification #42963247530](https://github.com/tajlive/finnbilglass/actions/runs/42963247530) **SUCCESS** på eksakt SHA (typecheck, eksisterende tester, isolert migrasjonsrepetisjon, syv nye legacy-tester og sikkerhetskontroller). Dette er testbevis, **ikke** GO for produksjon.

### Faktisk utført, via GitHub
- [PR #65](https://github.com/tajlive/finnbilglass/pull/65) merget i staging: \`scripts/maintenance/legacy_jobs_release_guard.py\`, syv syntetiske tester og [kjørbar driftsprosedyre](ops/legacy-data-release-gate.md). Kontroll tillater nye saker, men stopper sletting/omskriving av historiske rader.
- [PR #66](https://github.com/tajlive/finnbilglass/pull/66) merget i staging: samlet \`AGENTS.md\` med \`main\`; beholdt tidligere OPS-beslutninger i \`docs/ops/agent-decisions-staging-20261111.md\`.
- [PR #67](https://github.com/tajlive/finnbilglass/pull/67) merget i staging: beholdt legacy-testene i eksisterende migrasjonsrepetisjon og beholdt PR-workflow byte-lik \`main\`, uten duplisert CI. Dermed er #57 teknisk mergebar.
- **Ingen** ny OPS-produksjonsdeploy, reelle betalingsoperasjoner, kundemail eller live D1-endringer utført i dette arbeidet.

### P0 – korteste vei til første sikre salg

1. **Staging-D1 og gamle jobber:** Verifiser produksjons-/staging-bindinger read-only, ta dokumentert D1 backup/Time Travel-bokmerke. Lag sikre offline før/etter-snapshots av samme kopierte grunnlag og kjør legacy-guard. Bekreft én gammel åpen og én lukket sak samt historiske tilbud/ordre i autentisert OPS UI. Dokumenter bare aggregerte bevis i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39); aldri legg kundeeksporter i PR/CI.
2. **Første-salg-E2E:** Syntetisk/avgrenset forespørsel → korrekt bil/glassgrunnlag → vare og NOK-pris → Resend-tilbud med idempotent outbox → dokumentert aksept → kun én manuell ordre → manuell Kustom Portal-betalingslenke og referanse. Ikke merk betaling godkjent uten separat Kustom-kontroll. Test ansattinnlogging, tilbakekalling og audit. Dokumenter i [Issue #52](https://github.com/tajlive/finnbilglass/issues/52).
3. **Workspace/epost:** Verifiser reell Workspace-profil og lovlige alias samt faktisk leveringsvei før første kundesvar/import. Hold \`GMAIL_SYNC_ENABLED=false\` frem til eksplisitt sikker stagingkontroll. Kontroller Google OAuth-appens varige publishing-/refresh-token-konfigurasjon; eksisterende External/Testing er ikke dokumentert produksjonsklar. Spor i [Issue #38](https://github.com/tajlive/finnbilglass/issues/38).
4. **Releasekandidat:** Knytt godkjent stagingrunde til **eksakt SHA**. Verifiser \`main\`/PR-diff og D1-migrasjonsledger uten å kjøre ukjente pending-migrasjoner. Alle auth-/rolle-, test-, mail- og glass-regresjoner samt Cloudflare Access må være grønne. Dokumentér rollback av Worker separat fra database.
5. **GO / NO-GO:** Ved alle grønne gater: gjennomgå PR #57, fjern draft, merge først da til \`main\` og utfør kontrollert produksjonsdeploy med overvåking. Ved avvik: behold NO-GO og rett kun blokkeringen. Merk ikke en grønn QA-workflow som faktisk deploy.
6. **Etter første salg:** Først da prioriteres P1 katalog-autofullføring, flerlinjetilbud og arbeidskø. Ikke bygg automatisk capture/refund/checkout nå.

**Prod-baseline ved denne kontrollen:** \`main\` på \`04dd827f72094543df1c45553d2d3a571e79a4f0\`. GitHub Actions for \`main\` kan ha grønn «deploy»-workflow selv når den faktiske Worker-deployjobben er **skipped**; dokumenter derfor deployet Worker-versjon separat.

**Status per 11.11.2026:** OPS **teknisk mergebar og kildekode-QA grønn**; produksjon **NO-GO** på grunn av uverifisert autentisert første-salg-E2E, D1-legacy-check på faktiske kontrollerte kopier og drifts-/Workspace-signoff.

## 10. Astra-revisjon 11.11.2026 – P0-rettelser lagt i OPS-staging

**Verifisert samlet kandidat:** [PR #57](https://github.com/tajlive/finnbilglass/pull/57), HEAD `d60478f6370b597fb1950439fa16492189b2b817`. [GitHub PR Verification #42990346372](https://github.com/tajlive/finnbilglass/actions/runs/42990346372) **SUCCESS** på nøyaktig SHA. PR er fortsatt **draft** og produksjon fortsatt **NO-GO**.

### Fire kodeblokkeringer behandlet – alle merget til OPS-staging

| Funn | Implementasjon og automatisk bevis | Gjenstående driftsbevis |
|---|---|---|
| 1. Uklare kundesvar kan sendes dobbelt | [#71](https://github.com/tajlive/finnbilglass/pull/71): varig atomisk sendeforsøk i `ops_reply_attempts`, komplett frosset mailpayload, `SENDING/SENT/REVIEW`, ingen automatisk resend ved timeout eller 25+ timer, idempotent journaling. Syntetiske SQLite-tester og CI grønne. | Kontrollert **additiv** `migrations/proposed/0046_ops_reply_attempts.sql.proposed` på rett isolert staging-D1. Ekte Workspace-/Resend-staging E2E og manuell avstemmingsrutine. **Ikke apply alle pending-migrasjoner.** |
| 2. Eldre OPS-skriveruter uten CSRF-port | [#69](https://github.com/tajlive/finnbilglass/pull/69): felles Origin + application/json + `X-FBG-Manual-Intent` for status, notat, kundesvar og Gmail-synk; avvisninger uten DB/provider-effekt. | Autentisert Access/rolle-testing i virkelig staging inkludert REVIEWER, tilbakekalling og legacy-bearer. |
| 3. Race og audit-hull | [#70](https://github.com/tajlive/finnbilglass/pull/70): CAS `WHERE status=?`, 409 ved tapt konkurranse, transaksjonell D1-batch med historikk og audit for status, tilbud, aksept, ordre og portalref.; SQLite race-/rollbacktester grønne. | Verifiser D1-batch-semantikk og to faktiske ansatte i kontrollert staging. |
| 4. Historiske mail- og bildereferanser manglet fra data-gate | [#68](https://github.com/tajlive/finnbilglass/pull/68): omfattende historisk table-/event-diff, `ops_messages`, evidens og bilder samt R2-inventar før/etter; 12 syntetiske Python-tester grønne. | Privat, tidskonsistent offline før/etter-D1 + R2-inventar fra **rett** konto/bucket. Åpne gamle aktive/lukkede saker og tilbud/ordre i OPS. |

Alle fire PR-ene er merget i **staginggrenen, ikke `main`**. Ingen produksjons-Worker, ekte betaling, Gmail-import eller kundedata ble endret av dette arbeidet.

### P0 GO/NO-GO – neste operasjonelle steg

1. **Staging D1 schema gate:** Verifiser faktisk schema- og migrasjonsledger, riktig EU-D1-binding og beskyttet Time Travel/backup. Kontroller og appliser **kun** den gjennomgåtte additive 0046-migrasjonen på staging etter driftssignoff. Dokumenter eksakt migrasjons-/Worker-SHA og rollback. Ingen produksjonsmigrasjon før staging verifisert.
2. **Legacy og R2:** Kjør offline legacy-verktøy med `--r2-inventory-before` og `--r2-inventory-after` på to beskyttede, konsistente snapshots. Del bare aggregerte PASS/NO-GO og intern backupreferanse i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39), aldri ekte kundedata.
3. **Autentisert første-salg-E2E:** To inviterte ansatte gjennom kundeforespørsel, dokumentert fitment, Resend-tilbud/kundesvar, aksept → eksakt én ordre → manuell Kustom Portal-lenke (ingen autobetaling). Provoser samtidighet, feil, retry og revokasjon. Send ikke reelle kundemails i syntetisk QA. Logg resultat i [Issue #52](https://github.com/tajlive/finnbilglass/issues/52).
4. **Workspace:** Verifiser riktig bedriftspostkasse og alias + leveringsvei. `GMAIL_SYNC_ENABLED=false` inntil samtykke, app-publishing/refresh-token og sikker import er etterprøvd. Alternativt avtal **manuell** mottaks-/journalføringskontroll for første salgsrelease. Se [Issue #38](https://github.com/tajlive/finnbilglass/issues/38).
5. **Produksjonsbeslutning:** Når alle porter er bevist, dokumentér eksakt SHA, D1/R2-backup, Worker-rollback, observerbarhet og GO. Først da fjernes draft fra #57, merges til `main`, og en kontrollert produksjonsdeploy utføres. En grønn PR-CI er **ikke** bevis for deploy eller første salg.

**Driftsrunbook for kundesvar:** [docs/ops/reply-send-reconciliation.md](ops/reply-send-reconciliation.md). **Runbook for gamle jobber:** [docs/ops/legacy-data-release-gate.md](ops/legacy-data-release-gate.md).

## 11. Første-salg-akseptanse og migrasjonsøvelse – 11.11.2026

**Nytt testbevis:** [PR #72](https://github.com/tajlive/finnbilglass/pull/72) er merget **til OPS-staging, ikke til main**. Squash-commit: `49a23a9f8936177d5ab2cf931dbd19453e015fd8`. Kilde-PR på SHA `7d4f2967faecb35ee54adc1b9cdc5d314845340b` fikk [grønn PR Verification #42992252674](https://github.com/tajlive/finnbilglass/actions/runs/42992252674). Oppfølgende [PR Verification #42992437136](https://github.com/tajlive/finnbilglass/actions/runs/42992437136) for **staging mergecommit `49a23a9f8936177d5ab2cf931dbd19453e015fd8` er også SUCCESS**. Dette er samlet offline QA for koden – fortsatt ikke en live staginghandel.

### Dokumentert automatisk, isolert
1. `tests/ops-first-sale-integrated.test.mjs`: simulert henvendelse → manuelt utarbeidet tilbud DRAFT → én Resend-mock som gir SENT → sporbar kundeaksept → én ORDRE → registrert manuell Kustom Portal-referanse (PAYMENT_LINK_SENT, aldri PAID), med audit og ingen automatisk pengeoperasjon. Gammel lukket sak/hendelse forblir uendret.
2. `tests/ops-reply-upgrade-regression.test.mjs`: oppgraderingsøvelse fra **eksisterende** `ops_reply_outbox` med QUEUED/FAILED/SENT; usikre gamle meldinger settes i REVIEW i ny tabell, andre rader beholdes, og reapply er idempotent. Endring av frosset innhold er blokkert.
3. Begge testene er lagt i normal `npm run qa`. Sjekkliste: [docs/ops/first-sale-staging-acceptance.md](ops/first-sale-staging-acceptance.md).

### Gjenstående P0 (ikke bevist av syntetisk QA)
1. Kontroller korrekt staging-Worker / D1-binding / Cloudflare Access / R2 / Workspace-oppsett **lesende** mot levende miljø. Ingen kontoreferanser eller secrets i offentlig CI.
2. Fullfør backup/Time Travel og **kun** sikker, gjennomgått additiv migrasjon `0046_ops_reply_attempts.sql.proposed` på rett staging-D1 dersom den ikke finnes. Kjør historikk-/R2-diff på beskyttede, tidskonsistente kopier og kontroller eldre saker i autentisert UI.
3. Gjennomfør kontrollert, autentisert stagingreise med **to inviterte ansatte** og avgrenset testpostboks: tilgang/tilbakekalling, kundeforespørsel, kontrollert glassvalg, Resend-sending/svar, aksept, én ordre og manuell Kustom-lenkereferanse. Ingen ekte kundeutsending eller automatisk betalingsstatus.
4. Godkjenn Workspace-alias/mottak og eventuelt Gmail read-only, eller dokumenter testet manuell journalføring med `GMAIL_SYNC_ENABLED=false`.
5. Registrer godkjenningsbevis i [Issue #39](https://github.com/tajlive/finnbilglass/issues/39), [#52](https://github.com/tajlive/finnbilglass/issues/52) og [#38](https://github.com/tajlive/finnbilglass/issues/38). Først når **samme eksakte SHA** har grønne P0-porter, kan draft #57 vurderes for merge til main, og deretter kontrollert produksjonsdeploy.

**Status: NO-GO for OPS-produksjonsrelease.** Offline E2E og migrasjonsøvelse er et fremdriftsbevis, ikke reell staginghandel eller gjenopprettingsbevis. Ingen live kundedata, Resend-sending, Kustom-betaling eller produksjonsdeploy ble utført i PR #72.

## 12. Faktisk staging-D1 og kontrollert migrasjon 0046 – 11.11.2026

**Verifisert read-only resultat:** [Actions #43007453493](https://github.com/tajlive/finnbilglass/actions/runs/43007453493) på main commit `1a9a07e2f5d757bc5253389eee01cac1b16be4ef` returnerte **NO-GO** for OPS-staging:

- Cloudflare EU-staging-D1 identitet bekreftet, ingen kunde-/meldingsrader hentet.
- `STAGING_BASE_TABLES_MISSING: NONE`: alle fire forventede grunn-tabeller er på plass (`beta_inquiries`, `ops_reply_outbox`, `ops_manual_offers`, `ops_manual_orders`).
- `STAGING_REPLY_0046: MISSING`: tabellen `ops_reply_attempts` finnes **ikke** i aktuell staging-D1. Ikke gjett at andre migrasjoner mangler.
- Worker har navnene til nødvendige Access- og Resend-secrets, men selve kommunikasjonen er ikke E2E-verifisert.
- Ingen databaseendring, produksjonsdeploy, ekte e-post, Kustom-kall eller kundedataoperasjon er utført i denne kontrollen.

### Rettet automatisering og bevis

- [PR #73](https://github.com/tajlive/finnbilglass/pull/73) (main commit `2cc76cc`) innførte default-off `apply_reply_guard` for **kun** 0046 i `.github/workflows/staging-ops.yml`. Arbeidsflyten pinner aktuell PR #57 SHA, kontrollerer staging-account/D1, krever Time Travel-bokmerke før skriv, og **blokkerer stagingdeploy** hvis `ops_reply_attempts` mangler. [Read-only preflight #43005613521](https://github.com/tajlive/finnbilglass/actions/runs/43005613521) var grønn; selve stagingjobb ble SKIPPED.
- [PR #74](https://github.com/tajlive/finnbilglass/pull/74) og [#75](https://github.com/tajlive/finnbilglass/pull/75) la til automatisk read-only Cloudflare D1-skjema kontroll med presise NO-GO-koder. Siste resultat er **grunn-tabeller PASS / 0046 MISSING**.

### Neste handling – eksplisitt autorisert staging-only

1. Verifiser at GitHub **environment `staging`** har en dedikert, minst-privilegert `STAGING_CLOUDFLARE_API_TOKEN` med riktig D1-tilgang. Tidligere run 10.11.2026 manglet denne, men nåværende tilstand er ikke undersøkt. **Bruk aldri repoets produksjonstoken som fallback for skriving.**
2. Kjør [Staging OPS – manual release gate](https://github.com/tajlive/finnbilglass/actions/workflows/staging-ops.yml) fra `main` med input: `candidate_sha=49a23a9f8936177d5ab2cf931dbd19453e015fd8`, `authorization=STAGING-ONLY`, `inspect_staging=true`, `apply_migrations=false`, `apply_reply_guard=true`, `deploy=false`, og tom `bootstrap_admin_email`.
3. Workflows må bekrefte eksakt PR #57 SHA, korrekt EU staging-D1, de eksisterende reply-tabellene og gyldig D1 Time Travel/rollbackpunkt før den **eneste** additive 0046-migrasjonen. Dersom kontroll eller migrasjon feiler: behold NO-GO, ikke gjenta ukritisk.
4. Etterpå: kjør read-only readiness på nytt, kontroller `STAGING_REPLY_0046: PRESENT`, og gjennomfør privat D1/R2-legacy-kontroll samt autentisert OPS første-salg-E2E med to ansatte i staging. Se Issues #39/#52.
5. Først etter dokumentert full staginghandel, bevarte historiske data, riktig Gmail/mottaksrutine, Access-revokasjon og Worker/D1 rollback: vurder om PR #57 kan tas ut av draft og merges til produksjon.

**Status: NO-GO.** 0046 er nøyaktig isolert som et manglende stageskjema. Grunnmigrasjonene 0040–0044 må ikke blindkjøres på nytt. Ingen live migrasjon eller produksjonsendring er autorisert eller utført av read-only testene.

## 13. Staging-kjøring #43009306392 – blokkert før skriv (11.11.2026)

**Kjøring:** [Staging OPS - manual release gate #14](https://github.com/tajlive/finnbilglass/actions/runs/43009306392), manuelt startet på `main` SHA `ec8b2fcb5d99094b5f2d3e7e728e686ff48c0cfe`.

- `verify-candidate`: **SUCCESS** (kompilerte eksakt OPS-kandidat uten deploy). Draft PR #57 HEAD: `49a23a9f8936177d5ab2cf931dbd19453e015fd8`.
- `staging`: **FAILURE** i `Fail-closed account, Worker, D1 and config checks`: GitHub Actions hadde **tom `CLOUDFLARE_API_TOKEN`**, som leses fra **`secrets.STAGING_CLOUDFLARE_API_TOKEN` på GitHub environment `staging`**. Eksakt loggmelding: `Add STAGING_CLOUDFLARE_API_TOKEN to GitHub environment staging; production token must not be reused`.
- `Verify Cloudflare API`, `Inspect actual schema`, `Record Time Travel restore point`, `Apply reviewed additive reply migration 0046` og staging Worker-deploy ble **skipped**. Det finnes **ikke** bevis for gjennomført 0046 i denne kjøringen.
- Npm rapporterte fire høyalvorlige avhengighetsfunn. Det er ikke årsaken til dette stoppet og må vurderes separat uten ukontrollert `npm audit fix`.

### Korteste sikre løsning

1. Opprett/velg et separat, begrenset Cloudflare API-token for **kun** godkjent staging-konto og D1-operasjonen (inkl. Time Travel/backup), etterprøv nødvendige API-scope mot faktisk workflow. Ikke del token i chat, PR eller issue. Ikke bruk produksjonstokenet som fallback.
2. Legg token sikkert i `GitHub → Settings → Environments → staging → Environment secrets` med **eksakt navn `STAGING_CLOUDFLARE_API_TOKEN`**. Dette kan ikke settes via tilgjengelig GitHub-kobling, som mangler hemmelighetsadministrasjon.
3. Verifiser at staging-environment-krav og token-scopes tillater jobben; kjør **en ny** manuell `staging-ops.yml` på `main` med samme verifiserte kandidat-SHA, `authorization=STAGING-ONLY`, `inspect_staging=true`, `apply_migrations=false`, `apply_reply_guard=true`, `deploy=false`, tom `bootstrap_admin_email`. Kjør ikke samme mislykkede jobb om igjen før secret er på plass.
4. Krev faktisk `Time Travel`-bokmerke og senere `ops_reply_attempts: PRESENT` fra separat read-only readiness, deretter offline legacy/R2-gate og autentisert første-salg-E2E.

**GO/NO-GO: NO-GO** inntil reell 0046 stagingmigrasjon, D1 backup, historisk data og E2E er dokumentert. Denne kjøringen endret **ingen** database, sendte **ingen** kunde-e-post, utførte **ingen** betaling og deployet **ingen** Worker.

## 14. Kontobred D1 Edit – sikkerhetsstopp og isolasjonsbeslutning (11.11.2026)

> **VIKTIG: Dette overstyrer handlingspunktene i §12–13 som foreslår å legge `STAGING_CLOUDFLARE_API_TOKEN` med D1 Edit i GitHub og starte `staging-ops.yml`. Ikke opprett eller legg inn et slikt token i den delte Cloudflare-kontoen.**

### Verifisert stopp

- [Issue #39, kommentaren fra Work](https://github.com/tajlive/finnbilglass/issues/39#issuecomment-6794504637): Staging og produksjons-D1 ligger i samme Cloudflare-konto. Tradisjonell `D1 Edit` er kontoavgrenset, ikke trygg database-permission for bare staging. Ingen D1 Edit token ble opprettet, ingen GitHub-secret lagret og ingen ny 0046-migrasjon eller deploy ble kjørt.
- Time Travel-bookmark/gjenoppretting ble **ikke** verifisert. `ops_reply_attempts` forblir ikke bekreftet anvendt; siste faktiske read-only-sjekk viste `MISSING`. Dette er **NO-GO** for OPS-produksjon.
- Cloudflare har nyere individuelle **Worker**-tillatelser, men disse er ikke bevis på en databaseavgrenset D1 Edit-token. De gir ikke i seg selv sikker isolering av et direkte `wrangler d1 execute` mot kontoens produksjonsdatabaser.

### Anbefalt rask, sikker gjennomføringsmodell – krever separat review

**Alternativ A (raskest uten å flytte hele staging):** Lag en dedikert, midlertidig migrasjonstjeneste som eies og deployes **utenfor GitHub-release-tokenet**. Tjenesten har en **låst staging-D1-binding** og kan bare utføre akkurat den godkjente 0046-SQL-en; ingen dynamiske SQL-parametere, generisk execute-endepunkt eller database-ID fra request. GitHub skal ikke ha token som kan redigere denne tjenesten, bindings eller Cloudflare-kontoen. Autoriser ett engangskall (f.eks. Cloudflare Access/service-token med ekstra engangskontroll), logg kun ikke-sensitive resultatkoder, krev staging-schema/backup/Time Travel-bookmark på forhånd og journalfør en idempotent operasjonsmarkør. Deaktiver/fjern migrasjonsendepunktet umiddelbart etter verifisert 0046. Begynn med en offline test og uavhengig sikkerhetsgjennomgang før tjenesten deployes. **Ikke bygg et permanent generelt D1-skrive-API.**

**Alternativ B (sterkest konto-isolasjon):** Etabler en separat Cloudflare-konto for staging og gjenopprett Worker, EU-D1, R2, Access/Workspace-konfigurasjon og syntetiske fixtures der. Verifiser bindinger og identiteter på nytt, og oppdater `wrangler.staging.toml` og CI med konto-ID og DB-ID fra det nye miljøet. Deretter kan en kontoavgrenset D1 Edit-token opprettes kun for denne separate stagingkontoen. Ikke bruk kundeproduksjonsdata uten eksplisitt lovlig grunnlag og sikker eksport.

### Neste P0-kontroller

1. Velg alternativ A kun dersom engangstjenestens binding, kallets autorisasjon og fravær av GitHub-administrasjonsnøkkel kan verifiseres. Velg ellers B. Ikke bruk en bred D1-token med bare en kodekontroll av DB-ID som erstatning for tilgangsbegrensning.
2. Verifiser Time Travel-bookmark og restore-prosedyre på korrekt staging-D1 med read-only autentisering **før** noen SQL-write. Deretter test 0046 mot beskyttet, isolert kopi og kontroller eksisterende outbox/legacy-data.
3. Kjør kun statisk, reviewet additiv 0046 og verifiser `ops_reply_attempts` og idempotens mot faktisk staging-D1. Ingen deploy, e-post, betaling eller produksjonsmigrasjon.
4. Oppdater Issue #39 og #52 med eksakt kode-SHA, godkjenningsmetode og aggregert resultat. Første-salg-E2E med to inviterte ansatte og rollback er fortsatt påkrevd før GO.

**Status: NO-GO for skrivetilgang og migrasjon inntil en av disse modellene er etablert og bekreftet.**
