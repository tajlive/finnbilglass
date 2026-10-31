# Prod-D1 migrasjonsstatus — avvik fra antatt tilstand

**Dato:** 2026-10-31
**Type:** lesing (ingen skriving). Rapporteres fordi det korrigerer premisset for
migrasjonspakken `0017`–`0027`.

---

## Funn

Jeg antok tidligere at `0017`–`0027` ikke var kjørt mot prod-D1. **Det er feil.**

Prod-D1 (`finnbilglass-db`) har **18 rader** i `d1_migrations`:

```
0001_resolver_tables.sql          0010_opplaering.sql
0002_staging_baseline.sql         0011_assistant_sessions.sql
0003_vin_glass_overrides.sql      0012_evidence_ledger.sql
0004_canonical_glass_master.sql   0013_evidence_capture_v01.sql
0005_feature_flags.sql            0014_support_evidence_workflow.sql
0006_image_resolver.sql           0016_evidence_image_quality.sql
0007_b2b_sync.sql                 0017_beta_inquiries.sql      ← er kjørt
0008_tecdoc_snapshot_import.sql   0035_inquiry_glass_request.sql
0009_ece_r43.sql                  0036_glass_search_snapshots.sql
```

Repoet (kandidat `fa8ab8f`) har 25 prod-migrasjoner: `0001`–`0014`, `0016`,
`0017`, `0018`, `0019`, `0021`–`0027`.

### Tre avvik

| # | Avvik | Betydning |
|---|---|---|
| 1 | `0017` **er** kjørt i prod | Preisset «0017–0027 ikke kjørt» var feil |
| 2 | `0035` og `0036` finnes i prod, men **ikke** i produktlinjen | De lever i PR #2/#4/release-branchene — prod er migrert fra en annen linje |
| 3 | `0018`–`0027` står **ikke** i ledgeren, men skjemaet finnes i stor grad | Tabellene er der uten at filene er registrert |

### Skjema finnes selv om ledgeren mangler radene

| Tabell (forventet av koden) | I prod |
|---|---|
| `inquiry_rate_limits` (0019) | **finnes** |
| `manual_review_overrides` (0021) | **finnes** |
| `glass_sku_attributes` (0023) | **finnes** |
| `beta_inquiry_events` | **finnes** |
| `evidence_cases` | **finnes** |
| `quality_events` (0027) | **mangler** — heter `evidence_case_image_quality_events` (+ `_old` backup) |

`beta_inquiries` i prod har kolonnene `status`, `assigned_to`, `updated_at`,
`vehicle_json`, `glass_request_json`, `client_request_id`, `request_fingerprint`
— altså 0018-tilleggene er på plass.

---

## Konsekvens for migrasjonspakken

Å kjøre `0018`–`0027` blindt mot prod vil **feile eller kollidere**, fordi objektene
allerede finnes. Pakken må derfor starte med en **rekonstruksjon av faktisk
tilstand**, ikke med å applisere filene:

1. Sammenlign `d1_migrations` mot reelt skjema (`sqlite_master` + `pragma_table_info`)
2. Avgjør om `0035`/`0036` skal inn i repoet (de er en del av prod, men ikke av
   produktlinjen)
3. Backfill ledgeren for de migrasjonene som er applisert utenfor wrangler
4. Kjør bare det som faktisk mangler (`0027`-ekvivalenten for `quality_events`)
5. Backup + rollback-plan før noe skrives

Dette er utenfor denne integrasjonen, men endrer arbeidsordren for pakken.

---

## Påvirkning på main-oppdateringen

**Ingen.** Fast-forwarden skriver til Git, ikke til D1. CI har null D1-kommandoer,
og `deploy`-jobben er portet bak `[deploy]`.

Konsekvensen er utsatt til den dagen koden fra `main` faktisk deployes: koden
forventer skjema som i hovedsak finnes, men `quality_events` mangler under det
navnet. Det må avklares i migrasjonspakken før deploy — ikke før merge.
