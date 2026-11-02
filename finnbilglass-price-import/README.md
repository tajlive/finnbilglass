# FinnBilGlass Autoglass ScrapePlan v1.0.13

**Autorisert, skrivebeskyttet innhenting for forhandlerkontoen.** Ikke en produksjonsklar pris- eller lagerfeed.

## Rettelser i v1.0.10

- En startadresse under `/produkt/` behandles som ett enkelt varekort, ikke som en katalog.
- Ingen kategorier, breadcrumbs, paginering eller relaterte produkter følges i direkte varekortmodus.
- Produkttabeller utenfor hovedproduktet kan ikke legge til tilfeldige varer på en detaljside.
- Typekode søkes nå også i metadata-rader, innholdsbeskrivelse, dt/dd og etikett/verdi-par på hovedvarekortet.
- Typekode blir bare merket eksplisitt hvis leverandørens synlige Typekode-felt faktisk ble lest; ellers forblir klassifiseringen en slutning.
- Tilbehør lagres bare som **observerte, eksplisitt lenkede** produkter i tilbehørsseksjon. Passform er **ikke** verifisert.
- Eksisterende sikkerhetsregler for priser og lager beholdes: gul = POSSIBLY_AVAILABLE, pris/MVA uverifisert, ingen kundepris.

## Installer og oppdater Apify Actor

1. Pakk ut hele ZIP-filen på Mac-en, for eksempel under Downloads.
2. Åpne Terminal i den utpakkede mappen.
3. Kjør `npm run check && npm test` (ingen installerte avhengigheter er nødvendig for disse testene).
4. Kjør `./installer-pa-mac.sh` for å sende Actor-koden til din eksisterende Apify Actor. Innlogging i Apify skjer bare via Apify CLI/nettleser. Del aldri passord eller token i chatten.
5. I Apify **Input**, velg **Prøve (begrenset)** med `catalogUrls` = `https://auto-glass.no/produkt/ford-focus-5d-hbk-4d-sal-5d-est-18-frontrute/`; `maxPages=2`, `maxProducts=5`, `includeProductPages=true`, `saveState=false`, `allowReconciliation=false`.
6. Kontroller resultatet. Godkjent direktetest betyr **1 vare: 3593AGACHMVZ** og **ingen tilfeldige Bosch/Suzuki/Fiat-produkter**. Gul indikator skal gi POSSIBLY_AVAILABLE.
7. Test deretter `https://auto-glass.no/produkt/bmw-x5-5d-suv-g05-19-wsakucamsensorencgtn/` og kontroller tilbehørsseksjon. Et tomt tilbehørsett beviser ikke at ingen tilbehør finnes; inspiser da siden og koden igjen.

Kjør **ikke** fullimport, autoschedule, D1-oppdatering eller produksjonsdeploy før en autentisert prøve er validert.

## Kvalitetssperrer

- Prisgrunnlaget og MVA-kode er `UNKNOWN` inntil egen dokumentasjon finnes.
- `customerPriceInclVat` holdes `null`.
- Frontrute 75% og annet glass 50% er kun interne rabattpolicyer, ikke bekreftede kundesalgspriser.
- Produktsider som ikke har eksplisitt Typekode får **ikke** oppdiktet typekode.
- Ingen trafikk til tredjepartsdomener eller lagring av passord i datasets.
- Ikke misforstå `linkTraversalComplete` som komplett leverandørkatalog.

## Testbegrensning

Lokale tester validerer regelverk og ruting i Node. Den beskyttede Autoglass-siden må prøves med brukerens allerede lagrede krypterte Apify-legitimasjon. Live data ble **ikke** innhentet i denne kodepakken.


## v1.0.10 – tilbehør fra Autoglass

Leser `.accessory-products .product-row`, `.accessory-sku`, `.accessory-price` fra innloggede varekort.
`sourcePage` knytter tilbehørsreferansen til hovedproduktet; `verifiedFitment=false`,
`priceVerified=false` og `vatBasis=UNKNOWN` hindrer automatisk pris/kompatibilitet.
Kjør begrenset BMW X5 probe før større import. Ikke aktiver fullimport automatisk.

Sikkerhet: Kjør `npm audit --omit=dev` på Mac før deploy, gjennomgå funn, og
oppdater avhengigheter kontrollert med regresjonstester.

## v1.0.11 – trygg avhengighetskontroll (30.10.2026)

**Kildekoden for scraping og prisreglene er uendret fra live-testet v1.0.10.**

Byggemiljøet rapporterte 5 HIGH-sårbarheter 30.10.2026. Uten `package-lock.json`
kan vi ikke identifisere eksakte transitivversjoner offline. Denne utgaven stopper derfor
publisering når `npm audit --omit=dev --omit=optional` finner HIGH/CRITICAL, når npm-registeret
ikke svarer eller når lockfilen ikke kan opprettes.

- Dobbeltklikk `OPPDATER-APIFY.command` på Mac; den kjører alt i riktig rekkefølge.
- Lagre låst versjonssett i `package-lock.json`; gjentakbare bygg med `npm ci`.
- Audit før deploy, deretter forsøk på kun semver-kompatible sikkerhetsrettelser
  (`npm audit fix --package-lock-only`, **uten** `--force`).
- Revisjonsrapporter blir lokale i `audit-reports/` (ikke inkludert i Apify-build).
- Ved uløste HIGH/CRITICAL-avhengigheter blir ingen kodeopplasting forsøkt.
- Etter grønne sikkerhetstester kjøres kodekontroll og alle Node-tester, så Apify push.
- Apify Docker-build gjør en ny kontroll mot samme låste versjoner.
- Ingen customer price, D1-skriving, fullimport, cron eller produktrabattberegning aktiveres.

**Pris og merverdiavgift:** Autoglass-katalogen oppgir en vist pris, men kilden
bekrefter ikke om denne er ordinær listepris før rabatt eller om MVA er inkludert.
Spør leverandøren skriftlig; pris forblir `UNVERIFIED_DISPLAYED`, `vatBasis=UNKNOWN`
og `customerPriceInclVat=null` til dokumentasjonen er innhentet.

**Etter sikkerhetsgodkjent Apify-build:** kjør BMW X5 direktevarekort som
`probe`, `maxPages=1`, `maxProducts=1`, `saveState=false`, og sjekk at
`accessories[0].sku=S2`. Deretter gjør en begrenset kategoriutprøving med
maks 10 sider og 25 produkter, uten lagring/avstemming. Ikke iverksett fullimport
før datakvalitet, kildebruk og avtalegrunnlag er kontrollert.

## v1.0.12 – målrettet sikkerhetsrettelse for basic-ftp (30.10.2026)

Mac-revisjonen av v1.0.11 fant fem HIGH-varsler som stammet fra én kjede:
`apify-client → proxy-agent → pac-proxy-agent → get-uri → basic-ftp`.
Den rotårsaken har en publisert feil i `basic-ftp <= 6.2.0`
(GHSA-c475-qrg2-pj4r). Denne versjonen **overstyrer bare transitivavhengigheten**
til den bekreftede npm-versjonen `basic-ftp@6.2.3`, uten `npm audit fix --force`.
Merk at dette er en endring på tvers av `basic-ftp` 5.x→6.x for noen avhengigheter,
så etter en grønn sikkerhetskontroll må én kontrollert Apify PROBE brukes som runtime-test.

Før publisering opprettes `package-lock.json`, alle forekomster av
`basic-ftp` kontrolleres mot 6.2.3, `npm audit` kjøres,
og testsuiten må være grønn. Docker bruker `npm ci` og kontrollerer
produksjonsavhengighetene på nytt. Den nye pakken inneholder ikke
en forhåndslaget lockfil fordi npm-registeret ikke kan nås herfra;
Mac-skriptet oppretter den med internett tilgjengelig.

Offisielle kilder:
- https://github.com/advisories/GHSA-c475-qrg2-pj4r
- https://www.npmjs.com/package/basic-ftp

**Denne koden er ikke publisert fra ChatGPT.** Mac-skriptet kan starte Apify-push
*etter* dokumentert, lokalt grønn sikkerhetsstatus.

Oppdateringen finner automatisk Homebrew `node@22` på Mac dersom en annen Node-versjon er aktiv.


## v1.0.13 – kontroll av fører-/passasjerside (30.10.2026)

**Problem fra den autentiserte Mazda CX-5-katalogtesten**
`29730YP` (ventilrute) viste leverandørens `Typekode: VENTIL/SIDERUTE FREMRE FØRERSIDE`, mens brukeren tidligere har opplyst at varen er passasjerside. Dette er en **rapportert motstrid**, ikke uavhengig dokumentert riktig side.

### Beskyttelsesregler

- `src/side-review.js` leser bare **eksplisitte** `FØRERSIDE`/`PASSASJERSIDE` fra Typekode eller en særskilt produkttittel. Ingen slutning basert på venstre/høyre, varenummerrekkefølge eller URL-endelsen `-2`.
- For `29730YP` blir en tidligere brukerrapportert korreksjon registrert **kun** når SKU og eksakt Autoglass-varekortadresse stemmer. Metadata: `priorReportedSide=PASSENGER`, `priorReportedSideSource=PRIOR_USER_REPORTED_CORRECTION`, `priorReportedSideVerified=false`.
- Leverandørens `typeCodeRaw` og øvrige rådata beholdes. Sammenligning kan gi `sideConflict=true`, `reviewStatus=REQUIRES_MANUAL_REVIEW`, `manualReviewRequired=true` og `reviewReasons` med en eksplisitt begrunnelse.
- Også andre varer med eksplisitt uenighet mellom Typekode og tittelside eller mellom to observerte Typekoder merkes for kontroll. Tidligere konfliktgrunner slettes ikke ved kort-/detaljsidesammenslåing.
- `automaticOrderAllowed=false` **for samtlige skrapede, uverifiserte varer**, inkludert konfliktvarer. Ved sidekonflikt har `orderBlockReasons` blant annet `SIDE_DISCREPANCY_REQUIRES_REVIEW`. Ingen ny ordremotor er innført, og koden kan **ikke** i seg selv sperre en eventuell eksisterende kjøpsflyt i Cloudflare før den integreres.
- `summary.sideConflicts`, `summary.productsRequiringManualReview`, `VALIDATION_DIAGNOSTICS.sideConflictsRequiringReview` og `VALIDATION_DIAGNOSTICS.automaticOrdersAllowed=0` gjør problemet synlig i Apify.
- MVA og leverandørpriser er fortsatt uverifiserte; ingen automatiske kundepriser, lagergarantier eller produktpassform godkjennes.

### Test utført ved pakking

`npm run check` og `npm test` bestod med **39/39** tester (inkludert detaljsidefixture for `29730YP`, riktig nærliggende SKU `29729YP`, endring/merge av Typekode og kontrakt for bestillingssperre).

**Begrensning:** `npm install --package-lock-only` kunne ikke nå npm-registeret i denne isolerte arbeidsøkten (`EAI_AGAIN`). Derfor følger det **ikke** med en oppdiktet låsfil eller en påstand om fullført npm audit her. Eksisterende sikkerhetskontroll i Mac-skriptet oppretter låsfil og kjører `npm audit` og Apify Docker-audit **før opplasting**. Enhver revisjonsfeil skal stoppe opplastingen. Vi har ikke endret avhengighetspolicyen fra v1.0.12.

### Kontrollert kjøring etter publisering

I Apify Input: `mode=probe`, `catalogUrls` =
`https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/`,
`maxPages=1`, `maxProducts=1`, `includeProductPages=true`, `saveState=false`, `allowReconciliation=false`.

**Forventet:** `SKU=29730YP`, `sideConflict=true`, `reviewStatus=REQUIRES_MANUAL_REVIEW`, `manualReviewRequired=true`, `automaticOrderAllowed=false`, `typeCodeRaw` som levert av Autoglass, `customerPriceInclVat=null`. Rapporter og undersøk dersom livekilden har endret seg. En grønn test for denne varen er **ikke** godkjenning for fullimport eller ordre.
