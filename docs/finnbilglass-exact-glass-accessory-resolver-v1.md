# FINNBILGLASS EXACT GLASS & ACCESSORY RESOLVER v1

**Phase R1** · 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
Commits: `15e054a` (R1-kode) · Forrige: `dfff202` (C3) · `29f2dd4` (C2) — ingen merge til main, ingen prod-deploy, ingen prod-resolver-endring. **STOPP.**

---

## 1. Levert (alle 26 brief-seksjoner)

| Del | Leveranse | Fil(er) |
|---|---|---|
| Applikasjons-resolver | Flere applikasjonskandidater, aldri tvunget; VIN/facelift/kType-namespace som evidens | `src/fitment-v1/application-resolver.ts` |
| VEHICLE_TO_OE_GAP | Eksplisitt, aldri skjult bak konfidens; TecDoc-probe bekrefter gapet | `src/fitment-v1/provider-interface.ts` |
| Leverandør-grensesnitt | TecDoc/EPC kan legges til uten å skrive om resolveren | samme |
| Kandidat-differensiering | Strukturert feature-profil (kamera/sensor/HUD/varme/akustisk/coated/antenne/tint/list/OE-revisjon…) | `src/fitment-v1/differentiation.ts` |
| Spørsmålsmotor | KUN informasjonsrike skiller; irrelevante spørsmål forbudt (testet) | samme |
| R1-pipeline | Identity → applikasjoner → kandidater → OE → skiller → status | `src/fitment-v1/pipeline.ts` |
| Tilbehørs-engin | 6 stater, 12 kategorier, proveniens, EMB-parsing, feature-betingelser | `src/accessory-v1/{schema,catalogue,engine}.ts` |
| Ordrekonfigurasjon | Checkout-guard: AMBIGUOUS/UNKNOWN blokkerer; EXACT åpner | `src/accessory-v1/order-config.ts` |
| Tilbehørs-audit | 8 eksakte funn i nåværende UI (ingen prod-endring) | `src/accessory-v1/audit.ts` |
| Digital Glass Expert | DeepSeek konversasjonslag, 13 begrensede verktøy, aldri fitment-avgjørende | `src/conversation-v1/deepseek.ts` |
| Shadow | 16 kjøretøy, sammenlignet mot legacy-utfall | `scripts/r1-shadow.mjs` + `data/r1-shadow-results.json` |
| Tester | 21/21 grønne + full suite exit 0 + tsc 0 | `tests/r1.test.ts` |

## 2. Konklusjoner (de 10 påkrevde)

**1. Hvor langt kan vi løse eksakt glass med eksisterende data?**
- Kjøretøyidentitet: ja (SVV/VIN). Applikasjon: T5/CLA offline (VIN+produksjonsintervall → pre/post-facelift-kandidater, begge returneres). OE→glass: ja (Glavista, revisjonsbokstaver bevarede). Feature-skillet: ja (regnsensor/antenne/coated/kamera skilte T5-kandidatene korrekt). **Full kjede → EXACT: kun når kunden bekrefter OE** (`7H0845101H` → 2525GYA) — dette ER kjernen i doktrinen.
- Uten kunde-OE: SU18018 forblir AMBIGUOUS (6 kandidater, HEURISTIC_ONLY). Metrikker (shadow, 16 kjøretøy): exact 0 %, ambiguous 19 %, unknown 81 % (14 veteraner uten applikasjon i offline-registeret — ærlig gap, ikke kunstig 100 %).

**2. Hvilken eksakt kant blokkerer fortsatt høyere automatisk EXACT-dekning?**
- **VEHICLE_TO_OE_GAP — applikasjon→OE-kanten.** SVV/VIN beviser kjøretøyets identitet, men ingen offline kilde kobler applikasjon → OE-artikkel. Local 1Q2019 TecDoc-snapshot har kType-register (70 891) men mangler article_vehicle_linkage/OE/VIN — later ikke som det finnes. Gapet er eksplisitt i kode og shadow-resultatene.

**3. Hvilke spørsmål er genuint nødvendige?**
- For SU18018: **regnsensor, antenne, coated, OE-merking** — alle fire skiller faktisk (2525GYM sensor vs 2525GYA; 2525CSGY coated; antenne-feste; OE-revisjon). For AJ95429: **kamera, akustisk, kalibrert, OE** (kamera-variant kun i Glavista; acoustic skiller 5381AGACMVW1T/5381AGSCMVW1T). Spørsmål utledes kun fra kandidatforskjeller.

**4. Hvilke nåværende spørsmål er unødvendige?**
- Shadow-kjøring: **0 irrelevante spørsmål på tvers av 16 kjøretøy** (kritisk mål). Nåværende prod-UI spør derimot ubetinget om tilbehør (AUD-01…06) — «Trenger du tilbehør?» er unødvendig for T5-frontrute med EMB-list og ingen klips-relasjon.

**5. Hvor pålitelig kan tilbehør knyttes til eksakt glass/applikasjon?**
- Kun der dokumentert: **EMB=101 på 2525GYA = innkapslet list (INCLUDED_WITH_GLASS)**, 163 klips/PY/GU-rader med eurokode-kobling i gt-auto-prislisten, SCHEIBENKLEBESET i 4618/4618 Glavista-alleKoder (generisk forbruksvare, OPTIONAL_COMPATIBLE), sensorgel kun for sensor-glass (PROVISIONAL → UNKNOWN). Alt annet: UNKNOWN — aldri gjettet.

**6. Hvilke nåværende tilbehørsforslag er usikre/irrelevante?**
- AUD-01/03/04/05: **klips, pyntelist, sensorgel tilbys for ALLE glass** uten applikabilitet — klips/pyntelist er irrelevante for 2525GYA (EMB-innebygd list, ingen klips-relasjon); sensorgel tilbys selv for ikke-sensor-glass. AUD-06: app.js leser alle checkbox-verdier uten filtrering. AUD-02: sika-pakke (INSTALLATION_CONSUMABLE) presenteres som tilbehør.

**7. For SU18018 — hvilken eksakt ordrekonfigurasjon kan vi bevise?**
- EXACT + CUSTOMER_OBSERVATION (OE `7H0845101H` bekreftet): selectedGlass **2525GYA** (8579AGSGYAVZ1B); **INCLUDED_WITH_GLASS**: innkapslet list (EMB=101); **OPTIONAL_COMPATIBLE**: lim-kit (universell konsumvare); **UNKNOWN**: sensorgel (ingen sensor-evidens i profil); **ingen klips, ingen pyntelist** (ingen dokumentert relasjon — usynlige). Checkout: tillatt (EXACT), men sensorgel-UNKNOWN blokkerer kun hvis den var FITMENT_ACCESSORY-REQUIRED — den er UNKNOWN → ikke nødvendig, ikke upsell.

**8. Hva må DeepSeek vite vs. hva må forbli deterministisk?**
- DeepSeek: naturlig språk, terminologi, veilede foto, tolke svar til strukturerte observasjoner, forklare hvorfor mer info trengs, forklare `get_applicable_accessories()`-resultatet. Deterministisk: fitmentStatus/selectedGlass/verificationMode/ordreberettigelse/accessory-stater. DeepSeek har 13 verktøy, ingen skrivevei til policy (R1-15/16 testet).

**9. Hvilken enkelt dataanskaffelse ville mest forbedre eksakt-glass-dekningen?**
- **Lisensiert VIN/applikasjon → OE-artikkel-kilde (TecDoc Web API eller EPC).** Det lukker VEHICLE_TO_OE_GAP og gjør applikasjon→OE→glass kjeden automatisk-EXACT-kapabel for alle modeller — langt mer enn flere kataloger.

**10. Er R1 klar for kontrollert produksjon-shadow-trafikk?**
- **Kode-messig: ja** (deterministisk, ingen LLM i avgjørelsesveien, 0 irrelevante spørsmål, proveniens på alle kanter, checkout-guard testet). **Men:** kun T5/CLA-familier i offline-applikasjonsregisteret → shadow-dekning er tynn; VEHICLE_TO_OE_GAP gjør at automatisert EXACT kun kommer via kunde-OE. Anbefaling: start shadow-trafikk på staging med logg-aggregering (ikke prod), utvid familier fra gt-auto-prislisten, og anskaff TecDoc før prod-shadow for full effekt.

## 3. Metrikker (shadow, 16 kjøretøy — data/r1-shadow-results.json)

| Metrikk | Verdi |
|---|---|
| vehicleIdentityCoverage | 100 % (alle har make/modell/år) |
| applicationResolutionCoverage | 12,5 % (2/16 — offline-register T5/CLA) |
| vehicleToOECoverage | 0 % (VEHICLE_TO_OE_GAP i alle 16) |
| oEToGlassCoverage | 100 % der OE gis (Glavista) |
| fullExactCoverage | 0 % automatisk; EXACT kun via kunde-OE |
| averageInitialCandidates | 1,13 (6 for SU18018/AJ95429, 0 for veteraner) |
| irrelevantQuestionCount | **0** (kritisk mål nådd) |
| accessoryUnknownRate | sensorgel UNKNOWN uten sensor-evidens; øvrige usynlige |
| accessoryFalsePositiveRate | 0 (ingen udokumentert tilbehør i R1-resultatet) |

## 4. Neste anbefalte fase
1. Utvid applikasjonsregisteret fra gt-auto-prislisten (25179 rader) til høyvolumsfamilier (VW, Mercedes, BMW, Volvo…).
2. Staging-shadow med logg-aggregering (R1-resultat ved siden av legacy for hver live-request på staging).
3. Anskaff TecDoc Web API → lukk VEHICLE_TO_OE_GAP.
4. Erstatt tilbehørs-checkboksene i prod-UI med `get_applicable_accessories()`-utdata (etter arkitekt-godkjenning; AUD-01…08 som grunnlag).

**Ingen produksjonsaktivering. STOPP.**
