# 0047 + import + 0049 — kjørt i produksjon

**Dato:** 2026-11-04 · **D1:** `finnbilglass-db` · **Commit:** `7d714ce4`

---

## Rekkefølge som ble kjørt

1. `migrations/0047_glass_typekode.sql` — tabell `glass_typekode`, indeks, view `v_glass_med_typekode`
2. Import av `db/typekode/import-20261104.csv` — 14 546 rader i 30 batcher à 500
3. `migrations/pending/0049_typekode_uttrykksindeks.sql` — `UPPER(varenr)`-indeks

Alt additivt. Ingen eksisterende tabell ble endret.

## Verifisert i produksjon

| Kontroll | Resultat |
|---|---|
| `glass_typekode` | **14 546** rader, 14 546 unike varenr |
| Tabell + indeks + view finnes | ✅ alle tre |
| `SELECT COUNT(*) FROM v_glass_med_typekode` | 30 937 rader på **1,71 s** (tidligere: feil 7429 etter 36,15 s) |
| Rader med plassering | **14 762 (47,7 %)** |
| Golf-spesifikt | **284 av 362 rader (78 %)** har plassering |
| Forside / `/api/pilot-status` / `/api/frontrute` | 200 på alle |

Differansen 14 546 → 14 762 skyldes at ett varenr kan ha flere variantrader
(ulike eurokoder) i `glass_prisliste`.

## Konflikter som ikke ble importert

6 055 rader står i `db/typekode/konflikter-20261104.csv`:

| Årsak | Antall |
|---|---|
| Varenr finnes ikke i produksjonskatalogen | 5 968 |
| Typekode motsier varenavn | 79 |
| `BP`/`BF` uten dokumentert betydning | 8 |

Ingen av disse er skrevet til produksjon.

## Rollback

```sql
DROP VIEW IF EXISTS v_glass_med_typekode;
DROP TABLE IF EXISTS glass_typekode;
```

Ingen andre tabeller berøres. Kjørende kode leser ikke `glass_typekode`
automatisk — opplysningene blir først synlige når noe spør view-et.
