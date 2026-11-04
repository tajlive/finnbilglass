# Produksjonssetting gjennomført — FinnBilGlass katalogvarianter (0048)

**Dato:** 2026-11-04 · **Godkjent av:** Tom ("Jeg godkjenner alt")
**Kodecommit:** `56f4adb` · **Dokumentasjon:** `5ed25f1` + denne rapporten
**Produksjonsversjon:** `e57af458-46be-4d0a-9e76-0c3281e79d7e`
**Tilbakeføring:** ikke nødvendig — alle stoppkriterier passert. Backup står klar.

---

## Kjøreplanen som ble fulgt (Toms korrigerte rekkefølge)

| Steg | Handling | Resultat |
|---|---|---|
| **P0** | Registrer opprinnelig flaggstatus | `inquiries_enabled = 1` (notert, brukt ved gjenåpning) |
| **P1** | Pause innsending (`enabled = 0`) | `changes: 1` |
| **P2** | Bekreft pause + vent ut cache | `pilot: "stengt"` i **5 polls over 50 s** (10 s/isolat × 5 margin) |
| 0 | Backup `glass_prisliste_backup_0048` | **29 627** rader |
| 1 | `0048` (variant_id + unik indeks) | **29 627** rader · 29 627 unike · 0 null |
| 2 | `0048c` (kanonisk normalisering) | live konflikter = **15** · full SHA-256 `bbea7f5f…e7150` ✅ |
| 3 | `variant_upsert_00/01/02` | +499 +501 +313 = 1 313 → **30 937** rader · RAV4 **8/8** |
| 4 | Avstemming mot XLS-kilden | `bare_kilde = 0` · `bare_prod = 3` · eurokoder 26 023 − 26 024 = 0 − 1 · `ground_truth` **32 307** |
| 5 | Deploy Worker (`56f4adb`) — **fortsatt stengt** | `e57af458-46be-4d0a-9e76-0c3281e79d7e` |
| 6 | Kontroller søk, varianter, priser — **fortsatt stengt** | RAV4 2024 → 3 varianter, riktige priser · `pilot: "stengt"` |
| 7 | Gjenåpne til **P0-verdien** | `enabled = 1` → `pilot: "apen"` i 3 polls over 24 s |
| 8 | Merket testsak + `/ops` | **sak #41** i produksjon, visuelt kontrollert |

Kunden var stengt fra P1 til og med steg 6 — gammel pris-/variantlogikk møtte aldri den nye katalogen.

## Sluttall (målt i produksjon)

| Måling | Før | Etter | Forventet |
|---|---|---|---|
| `glass_prisliste` | 29 627 | **30 937** | 30 937 ✅ |
| Unike `variant_id` | — | **30 937** | 30 937 ✅ |
| Live variantkonflikter | — | **15** | 15 ✅ |
| `ground_truth` | 32 307 | **32 307** | uendret ✅ |
| RAV4 `8432AGAC` | 6 | **8** | 8 ✅ |
| `bare_kilde` / `bare_prod` | — | **0 / 3** | 0 / 3 ✅ |

**Konfliktene** er identiske med den prøvde kjøringen: 15 `variant_id` med `#2`/`#3`-suffiks, sortert
ASCII, LF-skilt, 381 bytes, full SHA-256
`bbea7f5f067b5ba3b8488496958f35fa53187a266c627a1e1669c69e719e7150`.

## RAV4-priser i produksjon (API + UI)

| variantId | Listepris eks. mva | Estimert kundepris inkl. mva |
|---|---|---|
| `8432AGAC:8432AGACHMV1L` | 19 425 | **6 070,31 kr** |
| `8432AGAC:8432AGACHMV30` | 14 860 | **4 643,75 kr** |
| `8432AGAC:8432AGACMV1L` | 10 745 | **3 357,81 kr** |

Utfall: `VERIFY` med 3 kandidater og `pinpoint: false` — som forventet (katalogen alene gir ikke EXACT).

## Kundereise og testsak i produksjon

Gjennomført i nettleser på `finnbilglass.no`: DS 30475 → Toyota RAV4 2024 (førstegangsregistrert
2024-05-15) → Frontrute → 3 varianter → svarte **Nei** på oppvarmet frontrute → listen avgrenset til
`3 357,81 kr` → «Velg dette glasset» → skjema → **sak #41**.

Sak #41 (`is_test`-merket i friteksten, ikke i systemfelt) viser i `/ops`:

- `Testkunde Hermes PRODUKSJONSTEST · #41 · Ny · TOYOTA TOYOTA RAV4 2024 · VERIFY`
- `Valgt variant: 8432AGAC:8432AGACMV1L (8432AGAC / 8432AGACMV1L) «TOYOTA RAV 4 22- FR AKU LDW»
  listepris 10745 eks. mva · estimert kundepris 3357,81 kr inkl. mva · tilhørighet: bekreftet`
- `Ønsket leveringssted: Trondheim` · `Kundens utstyrssvar (må kontrolleres): {"oppvarmet":"nei"}`
- Tidslinje: `4.11.2026, 13:24:24 · kunde · Forespørsel opprettet`

Verifisert både visuelt i `/ops` og direkte i D1 (`beta_inquiries` id 41).

**Merk:** `8432AGACMV1L` er en av variantene som **manglet før** migrasjonen — testsaken beviser at en
gjenopprettet variant kan velges, lagres og vises med riktig pris.

## Miljøetiketten

`/api/pilot-status` returnerer nå `environment`. Produksjon viser **Miljø: Produksjon**, staging viser
**Miljø: Staging** (verifisert visuelt i begge). Feilen var etiketten i `public/ops-admin.js`, ikke
konfigurasjonen.

## Gjenstår / ikke gjort

| Punkt | Status |
|---|---|
| Sletting av testsak #41 | Beholdt som spor; slettes på Toms ordre |
| `0047` (`glass_typekode`) | **Ikke kjørt** — venter fortsatt på egen godkjenning |
| `0049` uttrykksindeks | Ligger i `migrations/pending/`, avhengig av 0047 |
| 15 variantkonflikter | Beholdt med `#2`/`#3`-suffiks; krever leverandøravklaring før sammenslåing |
| RAV4 HUD/kamera | Uavklart — aldri satt automatisk (Regel 17) |
| Kosmetisk «TOYOTA TOYOTA» | Ikke rettet (duplisert merke i visning) |

## Tilbakeføring (ikke brukt, men prøvd)

Kode tilbake **først**, deretter data. Data: legg bort ny tabell, gi `glass_prisliste_backup_0048`
navnet tilbake, gjenopprett indeksene fra 0002/0007/0032 → 29 627 rader. Under tilbakeføring gjelder
samme pause-regel, og `inquiries_enabled` settes tilbake til **P0-verdien**, aldri automatisk `1`.
