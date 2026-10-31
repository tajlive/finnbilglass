# Migrasjonshistorikk rekonstruert — 11 filer hentet tilbake

**Dato:** 2026-10-31
**Branch:** `recon/migrations-20261031` fra `origin/main = fa8ab8f`
**Kilde:** `origin/feature/fbg-v1.0.14-full-catalogue-pipeline` (har alle 11)

---

## 1. Hva som ble hentet

`main` manglet 11 migrasjonsfiler som søsterbranchene har og som produksjonen
allerede bruker. De er kopiert inn uendret.

| Fil | SHA256 (16) | I prod |
|---|---|---|
| `0019_oem_probe_queue.sql` | `f62288560a90e1d3` | delvis |
| `0020_oem_probe_queue_fix.sql` | `008ebf78782c9874` | effekt oppnådd under annet navn |
| `0028_inquiry_commercial.sql` | `c35c496c5518d0a5` | ja |
| `0029_voice_lab.sql` | `4b5237d630e01c14` | ja |
| `0030_voice_lab_tuning.sql` | `a261bfd662d311b8` | ja |
| `0031_glass_reference.sql` | `a989dcb3d31ae848` | ja |
| `0032_glass_prisliste_lookup_indexes.sql` | `1e4e8a5a0f8950cc` | ja |
| `0033_inquiry_reply_history.sql` | `8d4a266e69cb3bbc` | ja |
| `0034_glass_catalog_multi.sql` | `5338d1aa1bb87715` | **NEI** |
| `0035_inquiry_glass_request.sql` | `dd31ebb12a5ee49f` | ja |
| `0036_glass_search_snapshots.sql` | — | ja |

## 2. Versjonskontroll (SHA256)

Hver fil er hashet på tvers av **alle 45 brancher** (lokale + remote):

```
0019_oem_probe_queue.sql                  10 kopier   1 unik SHA256   IDENTISK
0020_oem_probe_queue_fix.sql              10 kopier   1 unik SHA256   IDENTISK
0028_inquiry_commercial.sql                8 kopier   1 unik SHA256   IDENTISK
0029_voice_lab.sql                         8 kopier   1 unik SHA256   IDENTISK
0030_voice_lab_tuning.sql                  8 kopier   1 unik SHA256   IDENTISK
0031_glass_reference.sql                   8 kopier   1 unik SHA256   IDENTISK
0032_glass_prisliste_lookup_indexes.sql    8 kopier   1 unik SHA256   IDENTISK
0033_inquiry_reply_history.sql             8 kopier   1 unik SHA256   IDENTISK
0034_glass_catalog_multi.sql               8 kopier   1 unik SHA256   IDENTISK
0035_inquiry_glass_request.sql             8 kopier   1 unik SHA256   IDENTISK
0036_glass_search_snapshots.sql            8 kopier   1 unik SHA256   IDENTISK
```

**Ingen divergerende kopier.** Hver fil er byte-identisk overalt der den finnes.

Etter kopiering er SHA256 kontrollert på nytt mot kilden — alle 11 stemmer.

## 3. Versjonskonflikt: to filer heter 0019

```
0019_inquiry_rate_limit.sql   ← fantes på main
0019_oem_probe_queue.sql      ← hentet inn nå
```

Dette er ikke to versjoner av samme migrasjon, men **to forskjellige migrasjoner
med samme nummer**. Begge er anvendt i produksjon.

`wrangler d1 migrations apply` sorterer leksikografisk og sporer på **filnavn**,
ikke nummer. Rekkefølgen blir derfor deterministisk:

```
0019_inquiry_rate_limit.sql   (i < o)
0019_oem_probe_queue.sql
0020_oem_probe_queue_fix.sql
```

**Anbefaling: ikke døp om.** Begge er applisert i prod, og et nytt navn ville
bryte koblingen mot det som faktisk er kjørt. Konflikten dokumenteres i stedet.
Fremtidige migrasjoner bør bruke `0019b_`-mønsteret hvis dette gjentar seg.

## 4. Replay fra tom database

```
filer          : 36 (0001–0036, uten 0015 — finnes ikke noe sted)
feilede        : 0
tabeller       : 56
indekser       : 71
integrity_check: ok
```

## 5. Schema-diff mot faktisk produksjon

| | Prod | Replay |
|---|---|---|
| Tabeller | 60 | 56 |
| Indekser | 77 | 71 |

**Kun i prod (drift — ingen migrasjon lager dem):**

```
ordre                    0 rader    ukjent opphav
evidence_image_deletions 0 rader    revisjonsspor for bildesletting
montorer                 2 rader    ukjent opphav
beta_inquiry_events_old  14 rader   backup fra manuell rebuild
oem_probe_queue_old      10 rader   backup fra manuell rebuild
d1_migrations                       wranglers egen ledger
```

**Kun i replay:**

```
glass_catalog_items         ← 0034, ikke anvendt i prod
glass_vehicle_applications  ← 0034, ikke anvendt i prod
```

**Kolonner som kun finnes i prod:**

```
evidence_cases   : closed_at, retention_until
glass_reference  : brand_car, category, imported_at, price_eur, source, title, url
vin_ktype_map    : expires_at
```

## 6. `0034` — ikke anvendt, skal ikke kjøres nå

`0034_glass_catalog_multi.sql` er hentet inn som **fil** slik at historikken er
komplett, men den er **ikke** registrert som anvendt og skal **ikke** kjøres mot
produksjons-D1 i denne arbeidsordren.

Verifisert at den applikerer rent på isolert kopi av prod-skjema (2 tabeller +
3 indekser, integritet ok) — men det er en egen godkjenning å kjøre den.

## 7. Ingen automatisk skriving til produksjon

| Sjekk | Resultat |
|---|---|
| CI kjører `wrangler d1`-kommandoer | **0 treff** i `.github/` |
| CI kjører `migrations apply` | **0 treff** |
| Deploy-workflow berører D1 | Nei — kun `wrangler deploy` + secret |
| Nye filer har bivirkninger ved apply | Nei — ren DDL |

Migrasjonene kjøres bare manuelt, av et menneske.

## 8. Tilstand etter arbeidsordren

```
main (urørt)      : fa8ab8f
denne branchen    : migrasjonshistorikk komplett, 36 filer
produksjons-D1    : urørt — 18 ledger-rader, 0 endringer
```
