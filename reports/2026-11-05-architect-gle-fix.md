# GLE/VIN — arkitektens feilretting 2026-11-05

## Verifisert rotårsak

Staging kjørte 974e1ba8, som ikke inneholdt Hermes sine ukommitterte karosseriendringer. Det faktiske API-svaret kom fra L1, ikke L2. L1 kunne utvide en generell GT-modell til konkrete coupéprodukter uten å kontrollere den ferdige produktvarianten.
Etter at disse ble fjernet, returnerte L2 eldre GLE CPE-produkter og GLS-produkter. Disse er nå også fjernet for en GLE uten dokumentert coupékarosseri. SUV-dekning finnes: 5503-serien. Tidligere påstand om at SUV-data måtte opprettes var feil.

## Endring

En ren kompatibilitetsfunksjon kontrollerer konkrete produktnavn. Alle resolverlag bruker kontrollen før rangering og kapping. Reserveflyten og inquiry-handleren bruker samme kontroll. GLE uten COUPE blir ikke utledet som SUV; coupéspesifikke produkter krever avklaring. COUPE/CABRIOLET/SUV og andre karosseriord gir ikke modellstøtte alene. Ingen brede modellinje-tabeller, katalogendringer, migrasjoner eller flaggendringer.

## Stagingbevis

- Aktiv stagingversjon: 072d98cf-15b8-42be-9f57-6d62ec1704ce.
- AE62303: VERIFY med 3 varianter, alle 5503. Ingen 5508, 5393 CPE eller GLS.
- ZZ33141: VERIFY med 6 varianter, alle 5508. Ingen W203.
- Nettleser: AE62303 → Frontrute viser tre SUV-produkter og estimert pris 6759,38 kr på den prissatte hovedvarianten.
- POST inquiry med 5508-coupéprodukt for AE62303: 400, karosseri må avklares.
- POST inquiry med eksisterende W203-variant 2340GYM:5352AGSGYMVW for ZZ33141: 400, ikke i bilens kandidatsett.
- Gyldig ZZ33141-valg: 201, staging-sak 47, is_test=1. Lagring kontrollert i staging-auth-D1: 5508AGAC:5508AGACHMVZ1L, 4496,88 kr inkl. mva, Trondheim. Kontakt er testtelefon, ingen kundekvittering på e-post. Internt varsel kan sendes av eksisterende handler; levering er ikke hevdet.

## Frosset før/etter

- Katalogkopi: 30937 rader. SQLite SHA-256: `6a523dc098dd9272a98641a28bbe391d4db05a54b3a6cea6772cd609b55d5100`.
- Manifest SHA-256: `6076109cff6324e0b8b1917b40a0578a9cbfa2c32ece66338aa34f187009e4e2`.
- Frosne års-/VIN-svar SHA-256: `2ead6abad179bed4cbe760e3a83ab5bd81a1d4b8042fa25b785fedb6236cd386`.
- Begge kodeversjoner leser samme uforanderlige SQLite-kopi og samme bilobjekter; ingen nye SVV-kall i sammenligningen.
- Basis 0e7573b2 mot VIN + ny kontroll: 616 biler, 0 feil, 25 endrede variantsett.
- VIN-fiks 777965c1 mot ny kontroll alene: 616 biler, 0 feil, 3 endrede sett.

| Kontroll alene | Før | Etter | Vurdering |
|---|---:|---:|---|
| FBG-L-0044 GLE | 6 coupé | 3 SUV | Feil coupéprodukter erstattet av mulige SUV-produkter; fysisk passform kontrolleres fortsatt |
| FBG-L-0084 A3 Cabriolet | 6 | 4 | To A4 Cabriolet-produkter fjernet; CABRIOLET alene ga falsk modellstøtte |
| FBG-L-0140 GLE 500 E | 4 | 0 | Fire GLS-produkter fjernet; ingen kandidat er en ærlig manuell forespørsel |

## De 25 endringene mot opprinnelig basis

Tabellen viser faktiske biler fra manifestet. Den tidligere vurderingsrapporten hadde feil bilnavn (f.eks. FBG-T-0023 er CLA, ikke Tesla; FBG-L-0390 er Focus, ikke Mercedes). Den brukes ikke som fasit. Katalogkonsistens er ikke uavhengig fysisk passform. Øvrige endringer nedenfor er derfor uavklart fysisk passform, ikke dokumenterte forbedringer.

| ID | Modell | År | Før/etter antall | Vurdering |
|---|---|---:|---|---|
| FBG-T-0023 | CLA 200 D 4MATIC | 2016 | 0 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0036 | FOCUS | 2016 | 2 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0044 | GLE 350 DE 4MATIC | 2021 | 0 / 3 | Coupéprodukter fjernet; tre mulige SUV-varianter |
| FBG-L-0048 | PUMA | 2026 | 2 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0084 | AUDI A3 CABRIOLET | 2009 | 6 / 4 | Dokumentert A4/A3-modellmotstrid fjernet |
| FBG-L-0091 | C 180 CDI | 2012 | 3 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0103 | C 350 E | 2017 | 3 / 5 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0107 | A 180 | 2019 | 2 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0177 | C 350 E | 2016 | 3 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0310 | VITO | 2014 | 3 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0329 | E 200 CDI | 2014 | 6 / 1 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0331 | CLA 180 | 2013 | 0 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0353 | C 180 | 2016 | 3 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0357 | CLS 350 CDI 4MATIC | 2013 | 0 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0358 | C 350 E | 2016 | 3 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0363 | E 220 D | 2016 | 6 / 1 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0390 | FOCUS | 2018 | 1 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0404 | CAPTUR | 2019 | 0 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0415 | AMG A 45 S | 2020 | 2 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0418 | E 300 E | 2020 | 6 / 3 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0461 | E 220 CDI | 2012 | 6 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0467 | C 180 | 2012 | 3 / 0 | Manuell hjelp etter filtrering/årskorreksjon; ingen bekreftet passform |
| FBG-L-0478 | A 180 | 2017 | 2 / 3 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0480 | C 350 E | 2018 | 3 / 4 | Uavklart fysisk passform; variantendring dokumentert i JSON |
| FBG-L-0491 | EQC 400 4MATIC | 2022 | 0 / 2 | Uavklart fysisk passform; variantendring dokumentert i JSON |

## Begrensninger og releasegrense

Produksjon er ikke endret. Arbeidet ligger isolert i /tmp/fbg-architect på fix/architect-gle-20261105. Hovedtreet og /tmp/fbg-vinfix er bevart. Ingen full utstyrsvisning med tre tilstander er implementert i denne avgrensede feilrettelsen. Eksisterende visning ble inspisert i nettleseren og må videreutvikles separat; påstander om at den delen er ferdig er ikke gitt.
Operatørvisningen er ikke visuelt kontrollert; testsaken er verifisert på datanivå. E-postlevering er ikke testet. Frontrutekatalogen bekrefter ikke fysisk passform. Alle 25 er teknisk sammenlignet, men ikke uavhengig leverandørverifisert.
Før produksjon må gjeldende produksjonsbase avstemmes på nytt og denne isolerte rettelsen integreres uten å miste nyere innsending-/tekstendringer. Produksjonsgodkjenning er ikke gitt i denne runden. Staging tilbakeføringsversjon før arbeidet: 974e1ba8-8a7e-460e-9773-42981a6a60fd. Ingen data skal tilbakeføres.

## Sluttkontroller

- `npm run qa`: exit 0, 615 testtilfeller, 615 PASS, 0 FAIL, 0 SKIP. De lokale fixturefilene ble kopiert fra prosjektets eksisterende, gitignorerte fixtures slik at de sju GT-testene faktisk kjørte.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS.
- Kildekode i aktiv staging er identisk med denne grenens src-filer; siste deploy endret ingen frontendfiler. Test-/rapporttillegg etter deploy endrer ikke Worker-koden.
- Reprodusering: `node --import tsx scripts/replay-gle-frozen.mjs DB MANIFEST FROZEN_RESPONSES BASELINE_TS OUTPUT_JSON`. Bilopplysninger og database holdes utenfor git; resultatfilene inneholder test-ID/modell/variantsett, ingen VIN eller kjennemerker.
