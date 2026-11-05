> Oppdatert status: produksjonssetting er gjennomført. Se `2026-11-05-ops-crm-produksjon.md`. Resten beskriver den opprinnelige staging-leveransen.

# Operation Center — leveranse uten nye abonnementer

Dato: 2026-11-05. Branch: feat/ops-free-workbench-20261105. Isolert arbeidstre: /tmp/fbg-architect.

## Kostnadsramme, kontrollert i innlogget nettleser

Bruker presiserte: «Ingen nye abonnementer; bruk eksisterende inkluderte kvoter».

- Resend: Free, $0/måned, 3000 transaksjonelle e-poster/måned, 100/dag. Observert forbruk 93/måned og 2/dag. Ingen betalingsmetode, overforbruk avslått. Innkommende e-post bruker samme kvote.
- Cloudflare: eksisterende Paid-plan, $5/måned pluss eventuelt forbruk. Dette abonnementet er ikke opprettet/endret her. Bruk av eksisterende Workers/D1; ingen nye tjenester, betalte tillegg, AI-kall eller cronjobber.
- Nytt panel har en konservativ grense på 50 utsendingsreservasjoner per 24 timer. Andre eksisterende sendinger og mottak bruker også Resends globale kvote; den globale kvoten styres av gratisplanen. Panelet aktiverer aldri betalt overforbruk.
- Ingen fakturaprogram valgt eller aktivert. 0050 er urørt. Ingen faktura, betaling eller leverandørbestilling er opprettet.

Kilder: https://resend.com/pricing og https://developers.cloudflare.com/d1/platform/pricing/ . Faktisk abonnement/forbruk ovenfor er observert i kontoene, ikke utledet fra prissidene.

## Implementert

- Separat Access-beskyttet arbeidsflate /ops/workbench med arbeidsliste, søk, testsakfilter, prioritering og foreslått neste handling.
- Én sak viser kundens opprinnelige melding, eksisterende sakshistorikk, gamle tilbud, nye e-poster og nye tilbud. Legacy-panelet og katalogen beholdes under /ops?legacy=1.
- Ansvarlig, neste handling, frist, betalingsstatus, leveringsstatus, leverandørreferanse, adresse og sporing. Optimistisk versjonskontroll hindrer tapte samtidige oppdateringer. Lukket sak blir ikke gjenåpnet av historisk akseptert tilbud.
- E-postmaler, lagring/gjenåpning av utkast, forhåndsvisning med mottaker, manuell utsending, provider-ID og deduplisering. Ingen automatisk kundekontakt eller oppfølging er aktivert.
- Katalogvalg av full produktvariant; tilbehør avvises selv ved feil rad_type. Manuellt kontrollgrunnlag og fire bekreftelser (glass/pris/frakt/levering) før tilbud fryses.
- Tilbud med linjer/antall/øre-presisjon, 25 % mva, frakt som egen linje, leveringsadresse, betalingsvilkår og gyldighet. BLYT AS er selger. Ingen automatisk kopiering av innkjøpspris til kundepris.
- Immutable tilbudsversjoner. Endret payload med gjenbrukt forespørselsnøkkel gir 409, identisk retry gir samme tilbud. Aksepterte saker krever særskilt endringsflyt før flere tilbud kan opprettes.
- Kundens HMAC-beskyttede tilbudslenke: lesing endrer ingenting; eksplisitt aksept gjelder nøyaktig versjon. Utløpte/erstattede tilbud kan ikke aksepteres. Ingen betaling på tilbudssiden. Staging/lokale tilbud er tydelig merket TEST.
- Signert Resend-endepunkt: rå payload, fem minutters tidsvindu, deduplisering og atomiske statusoverganger. Status DELIVERED betyr mottatt av e-postserveren, ikke lest/innboksplassering.
- Innkommende e-postkode: henter ren tekst fra Resend, kobler bare kjent avsender + saksreferanse. Ukjente meldinger havner i egen kø, og kan knyttes manuelt til sak med bekreftelse/begrunnelse. Ingen HTML kjøres og ingen e-posttekst godkjenner glass, bestiller varer eller registrerer betaling.

## Miljø og migrasjon

Bare migrations/pending/0051_ops_workbench.sql er kjørt mot finnbilglass-staging-auth. Additive tabeller; eksisterende saker/historikk er bevart. send_reserved_at-kolonnen er kontrollert i faktisk staging-skjema. Ingen katalogmigrasjon eller produksjonsmigrasjon.

Staging: https://ops-staging.finnbilglass.no/ops/workbench . Worker-versjon: 521ddbae-c675-452d-af93-a532221939df.

Staging har OPS_WORKBENCH_ENABLED=true og eget tilbudsdomene. Produksjonsflagget er ikke aktivert. Dedikerte OPS_LINK_SECRET og RESEND_WEBHOOK_SECRET er satt kun i staging, uten nøkkelverdier i filer, logger eller git. Webhook-hemmeligheten er for syntetisk staging-kontroll; den er ikke koblet til en ekte Resend-webhook.

## Verifisering

- npm run qa: exit 0, 640 tester PASS, 0 FAIL, 0 SKIP.
- 25 målrettede workbench-tester dekker penger, migrasjon, samtidighet, eksakt retry, endret tilbudspris, gammel tilbudsversjon, utløp, doble utsendinger, gjenåpnet utkast, mottakerendring, tilbehørsavvisning, leveringshendelser i feil rekkefølge, samtidige webhooks, manuell innbokskobling og Access-avvisning.
- Typekontroll, JavaScript-syntaks og git diff --check: PASS.
- Uavhengig kodegjennomgang: opprinnelige funn rettet; 23 målrettede tester PASS på tidspunktet for siste review. To etterfølgende livssyklus-/manuell-koblingstester inngår i sluttotalen 25/640.
- Lokal nettleser: mal → lagre utkast → gjenåpne → forhåndsvise → simulert sending; glassvalg → glass + frakt → tilbud v1 → simulert sending → kundens tilbudsside → eksplisitt testaksept → Akseptert i arbeidslisten. Ingen ekstern e-post fra simulatoren.
- Mobil 390 px: document.scrollWidth=390, innerWidth=390. Desktop 1280 px og mobilbilder lagret under reports/screenshots/. Dette er syntetiske kundedata.
- Staging-webhook: ekte HTTP-kall med syntetisk hendelse/signatur: 200. Manipulert signatur: 401. Ingen e-post sendt.
- Staging-nettleser etter brukerens Touch ID: Access åpner arbeidsflaten; testsak #47 vises med tidligere variant og historikk. Ansvarlig Tom og neste oppgave lagret; «Oppfølging lagret» samt append-only hendelse med tomarnejensen@gmail.com bekreftet i UI.

## Ikke aktivert / praktiske grenser

- Dette er en staging-leveranse, ikke ny produksjonssetting. Nåværende produksjonspanel/kundesaker er urørt.
- Virkelig supportmottak er ikke flyttet/videresendt. MX og support@finnbilglass.no beholdes. Resend-webhook for reelle kundemeldinger/status er ikke opprettet; ingen produksjonsmeldinger rutes til staging.
- Faktisk e-postlevering fra denne nye flyten er ikke påstått. Utgående transport er samme Resend-transport, men ny komplett flyt er testet med lokal stub og ekte staging-signatur, ikke med et nytt kundetilbud sendt eksternt.
- Innkommende vedlegg lastes ikke automatisk ned i den nye arbeidsflaten; eksisterende supportpostkasse og gammel bildeflate beholdes. Usikker avsender krever manuell kobling.
- Noen eldre staging-testsaker har is_test=0. Panelet respekterer det dokumenterte flagget og har ikke omklassifisert historiske data ved navn-gjetting.
- Saker uten e-postadresse kan ha tilbudsutkast, men kan ikke få e-post før adressen foreligger. Kunden kan ikke bestille fra et utkast.
- Gjeldende produksjonskode har tidligere ukommitterte innsending-/tekstendringer i hovedtreet. De må bevares når denne isolerte pakken integreres; ikke deploy hele dette arbeidstreet over produksjon uten avstemming.

## Produksjonsrekkefølge og rollback

1. Avstem aktiv produksjonskode og isoler denne pakken uten å miste eksisterende rettelser.
2. Ta sikkerhetskopi og kjør bare additiv 0051 på korrekt produksjons-inquiry-DB. Ikke kjør 0050 eller øvrige pending-filer.
3. Konfigurer eget produksjons-OPS_LINK_SECRET, OPS_PUBLIC_ORIGIN=https://finnbilglass.no og OPS_WORKBENCH_ENABLED=true. Bevar Access/AUD/allowlist.
4. Deploy og verifiser autentisering, sakshistorikk, kø, utkast, ørebeløp og tilbudslenker. Bruk kontrollert mottaker for én uttrykkelig merket test.
5. Koble én Resend-webhook til produksjonens /api/webhooks/resend og bruk dens faktiske signing secret. Bekreft delivered/bounce på kontrollert test. Free-planen tillater én endpoint.
6. Etabler og test kopi/videresending av supportmottak til valgt Resend-mottaksadresse med eksisterende postkasse bevart. Kontroller avsender, saksreferanse og vedleggshåndtering før aktiv kundebruk.
7. Fakturaprogram og eventuell fakturamigrasjon behandles senere.

Rollback: sett OPS_WORKBENCH_ENABLED=false og/eller rull bare koden tilbake. Bevar nye tabeller, tilbud, aksepter og meldinger. Ikke slett historikk. Ingen bestilling, faktura eller betaling følger automatisk av en rollback.
