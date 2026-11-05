# Import og release — typekode (V6.0 → V6.1)

## Status

| Miljø | Tabell `glass_typekode` | Rader | Koblede prislisterader |
|---|---|---:|---:|
| **Staging** (`finnbilglass-staging-catalog`) | opprettet | 20 601 | 14 793 |
| **Produksjon** (`finnbilglass-db`) | **ikke opprettet** | – | – |

Produksjon er bevisst urørt. Ingen produksjonsimport er gjort, og ingen
produksjonsdata er endret. Produksjonens 29 627 prislisterader står uendret.

## Hva som ble kjørt

1. `migrations/0047_glass_typekode.sql` mot `finnbilglass-staging-catalog`
   — ny tabell + indeks + view `v_glass_med_typekode`. Additivt: ingen eksisterende
   tabell er endret.
2. `scripts/import-typekode-csv.py --db finnbilglass-staging-catalog --remote --apply`
   — 20 601 rader i batcher på 800, `INSERT OR REPLACE` med varenr som nøkkel.

Importen er **idempotent**: samme kommando to ganger gir samme resultat, fordi
varenr er primærnøkkel og verdiene er deterministiske fra kildefilen.

## Kilde og proveniens

- Fil: `products-autoglass-no.csv` (27 184 rader, auto-glass.no-katalogen)
- Felt brukt: `sku`, `type_code`, `type_code_desc`
- Hver rad lagrer `kilde`, `kildefil` og `hentet_at` — sporbarhet per verdi
- Konflikter i kilden (samme varenr med ulik kode): **0**

## Verifisert etter import

| Kontroll | Resultat |
|---|---|
| Rader = unike varenr | 20 601 = 20 601 |
| Varenr med flere typekoder | 0 |
| LEFT JOIN-oppblåsing | 29 627 rader inn → 29 627 rader ut (ingen multiplikasjon) |
| Indekser | primærnøkkel + `idx_glass_typekode_kode` |
| Tester | 466 totalt, 459 pass, 0 fail |
| TypeScript | 0 feil |

## Rollback

```bash
# Fulle tilbake til uten typekode (kun staging):
npx wrangler d1 execute finnbilglass-staging-catalog --remote \
  --command "DROP VIEW IF EXISTS v_glass_med_typekode; DROP TABLE IF EXISTS glass_typekode;"
```

Ingen andre tabeller berøres av rollback, fordi importen ikke skrev til noen andre.

## Kodeendringer i V6.1

| Fil | Endring |
|---|---|
| `src/glass-posisjon.ts` | Ny `fraTypekode()` som oversetter alle 18 koder til full posisjon (klasse, side, ledd, siderute-nummer, delt bakrute). `klassifiserGlass()` bruker den før navneheuristikk og flagger `typekodeKonflikt` ved motstrid |
| `src/routes/admin-katalog.ts` | Katalogsøket joiner `glass_typekode` og returnerer `typekode`, `glassklasse`, `side_kilde`, `fysisk_side`, `dor_ledd`, `ventil_ledd`, `siderute_nummer`, `delt_bakrute`, `plassering_dokumentert` |
| `tests/typekode-posisjon.test.mjs` | 10 nye tester for alle 18 koder, RHD, ukjente koder og motstrid |
| `package.json` | `test:typekode` lagt inn i `qa` |

## Kjente begrensninger

- `fysisk_side` er merket `fysisk_side_antatt: true` når styretypen ikke er kjent.
  Systemet lagrer aldri en antatt side som om den var dokumentert.
- 14 834 prislisterader har fortsatt ingen plassering. Kilden er uttømt for disse
  — de finnes ikke i CSV-en i det hele tatt.
- Bulk-skanning for å telle faktiske typekode-motstrid mot navn/eurokode er ikke kjørt.
- Admin-UI viser fortsatt bare «Plassering»-kolonnen; de nye feltene er tilgjengelige
  i API-et men ikke alle tegnet i tabellen ennå.

## Produksjonsimport — hva som må være på plass først

1. Bulk-skanning av motstrid mellom typekode og navn/eurokode, med tall.
2. Admin-UI som viser de nye feltene, slik at saksbehandler faktisk ser dem.
3. Bekreftet at resolveren bruker plasseringen til å fjerne irrelevante posisjoner
   tidlig — ikke bare til visning.
4. Egen GO fra Tom.
