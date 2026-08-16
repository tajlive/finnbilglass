# TecAlliance til FinnBilGlass: implementeringsrunbook

## Mål

Bygg en sporbar og gjenopprettbar kjede:

`regnr -> VIN -> TecDoc Vehicle Identification -> KType -> TecDoc OE/linkage -> Eurocode -> FinnBilGlass varenr og pristier`

TecAlliance leverer identitet og kompatibilitet, ikke pris. FinnBilGlass og
Autoglassgrossisten B2B bruker derfor samme versjonerte canonical master, men
beholder hver sin autoritet for pris, lager, rabatt og ordre.

```text
TecAlliance-snapshot
        |
        v
canonical glass master (OE, Eurocode, KType, features, provenance)
        |                                  |
        v                                  v
FinnBilGlass resolver                Autoglassgrossisten B2B resolver
pris: B2C-pristier                   pris: B2B-avtale/lager/kundekonto
```

Bilder/CV avgjør aldri varenummer alene i noen av flatene.

## Bestilling hos TecAlliance

Be om skriftlig bekreftelse på følgende, for FinnBilGlass og Autoglass B2B:

1. Vehicle Identification via VIN og, dersom tilgjengelig for Norge, VRM.
2. TecDoc Catalogue/Web Service eller Data Package med OE/MPN-sok og KType-
   linkages for frontruter.
3. Kriterier for kamera, ADAS, HUD, varme, regn-/lyssensor, akustikk,
   antenne, VIN-vindu og speilfeste.
4. Rett til a lagre en lokal, versjonert kopi i FinnBilGlass D1 og dele samme
   canonical master med Autoglass B2B.
5. Rett til a vise produktbilder, samt krav til attribution, cache og
   lagringstid dersom bilder inngar i leveransen.

Uten punkt 4 skal eksporten ikke importeres. Uten punkt 5 skal ingen
tredjepartsbilder vises eller kopieres.

## Deling med Autoglassgrossisten B2B

Snapshot-formatet er systemnøytralt. FinnBilGlass importerer det først i
staging, validerer mot fasit, og publiserer deretter samme godkjente
`source_id`, fingerprint og canonical-rader til B2B. B2B skal ikke lese
FinnBilGlass-D1 ved hvert kundesøk og FinnBilGlass skal ikke ha en runtime-
avhengighet til B2B.

Begge resolverne bruker samme regler:

1. Samme `source_id` og `raw_fingerprint` for en leveranse.
2. Samme OE-, Eurocode-, KType- og feature-normalisering.
3. Samme PINPOINT-gate og samme degradering til VERIFY ved tvil.
4. Egen audit-rad per søk i hvert system; dataimportens provenance er felles.
5. Pris, avtaler, lager og ordredata krysses aldri mellom systemene.

## Snapshot-kontrakt

Leverandoreksporten skal pakkes som en mappe med dette innholdet:

```text
manifest.json
parts.jsonl
vehicles.jsonl
```

`manifest.json` skal minst inneholde:

```json
{
  "schema": "finnbilglass-tecdoc-snapshot/v1",
  "license_ref": "tecdoc-contract-YYYY-NNN",
  "redistribution_permitted": true,
  "source_version": "2026-W33",
  "fetched_at": "2026-08-13T00:00:00Z",
  "source_updated_at": "2026-08-12T00:00:00Z",
  "source_url": "licensed-export"
}
```

`parts.jsonl` bruker canonical crosswalk-formatet: `eurocode`,
`oem_numbers`, `supplier_number`, `trade_number`, `fitment.ktype` og
feature-felter. En del med flere Eurocodes skal ha flere verdier i
`eurocodes`; en konflikt skal beholdes som flere rader, aldri reduseres ved
gjetting.

`vehicles.jsonl` inneholder `vin`, `ktype`, `confidence`, `make`, `model` og
`year`. Kun valide 17-tegns VIN-er med confidence minst `0.90` importeres.

## Import og kontroll

Importen er default dry-run og har staging hardkodet som eneste skrivemal:

```bash
node scripts/import-tecdoc-snapshot.mjs --snapshot /sikker/mappe/tecdoc-2026-W33
node scripts/import-tecdoc-snapshot.mjs --snapshot /sikker/mappe/tecdoc-2026-W33 --apply --confirm-licensed
```

Forste kommando lager fingerprint, SQL og rapport. Andre kommando krever
lisensflagget eksplisitt. Begge nekter manglende lisensreferanse eller manglende
lokal lagringsrett. Ra API-nokler brukes aldri av Worker eller legges i repoet.

Alle importer lager en `source_katalog`-rad og en `tecdoc_import_runs`-rad.
Dermed kan hver kobling spores til leveranseversjon og råfingeravtrykk.

## PINPOINT-policy

`VIN -> KType -> TecDoc linkage` kan gi kandidater, men er ikke nok alene til
PINPOINT. PINPOINT krever i tillegg entydig OE/build- eller Eurocode-bevis og
ingen feature-konflikt. En enkel KType-kandidat vises som VERIFY til kamera,
HUD, varme og sensorer er bekreftet av build-data, rute-merking eller kunde-
bilde. Denne regelen er identisk i FinnBilGlass og Autoglassgrossisten B2B.

## Release-gater

1. D1-tilgang til staging er bekreftet.
2. En lisensiert snapshot er validert i dry-run.
3. Snapshot er importert til staging og radtall/fingerprint er kontrollert.
4. Fasit og representativ 500-bil test har null feilaktige PINPOINT.
5. PINPOINT har komplett evidenskjede, og alle tvetydige treff er VERIFY.
6. Produksjonsutrulling godkjennes eksplisitt etter disse målingene.
