# VIN-fiks — før/etter på samme datagrunnlag

**Metode:** samme staging-instans og samme D1 hele veien. Kun kodeversjonen ble byttet.
- Basis `0e7573b2` → staging `d93c9ca4`
- Fiks `c423787d` → staging `974e1ba8`
- Kontrollgruppe: 616 biler, identisk manifest, identisk katalog og flagg

## Årsmatrise (enhetstest, samme inndata)

| Tilfelle | Basis | Fiks |
|---|---|---|
| ZZ33141 (siffer 1, reg 2021) | **2001** | **2021** |
| siffer 1, reg 2002 | 2001 | 2001 |
| siffer 1, reg 2012 (11 år unna) | 2001 | **2012** |
| siffer 1, reg 2013 | 2001 | **2013** |
| siffer 5, reg 2006 | 2005 | 2005 |
| siffer 9, reg 2009 | 2009 | 2009 |
| bokstav K, reg 2024 (import) | 2019 | 2019 |
| bokstav A, reg 1995 | 1980 | 1980 |
| bokstav R, reg 2024 | 2024 | 2024 |
| mangler / for kort / ugyldig VIN | null | null |
| ingen registreringsår | 2019 | 2019 |

Bare siffer-grenen endres, og bare når VIN-året ligger mer enn 10 år fra registreringsåret.

## ZZ33141

| Kall | Basis | Fiks |
|---|---|---|
| `/api/regnr` | `2340GYM` (W203) | **6 × 5508** (GLE Coupé) |
| `/api/frontrute` uten VIN | 6 × 5508 | 6 × 5508 (uendret) |
| `/api/frontrute` med VIN | `2340GYM` | **6 × 5508** |

Med og uten VIN gir nå samme svar. W203 er borte.

## Kontrollgruppe 616 — 25 endret

| Type | Antall |
|---|---|
| Fikk kandidater (hadde ingen) | 7 |
| Mistet alle kandidater | 6 |
| Byttet kandidatsett | 12 |

Endringene er nå isolert til kodeendringen: samme database, samme manifest, kun kode byttet.

**Ikke vurdert per sak ennå:** om de 25 er forbedringer. Seks biler mistet alle
kandidater (bl.a. FBG-L-0091, FBG-L-0107, FBG-L-0310, FBG-L-0461, FBG-L-0467) —
typisk fordi de gamle kandidatene var fra feil æra. Sju biler fikk nye, bl.a.
GLE SUV 2021 (FBG-L-0044) som nå får 5508-coupéglass — det er samme latente
modellsvakhet som W203-saken, ikke en ny feil.

## Gjenstår

- Per-sak-gjennomgang av de 25 før dekning kan omtales som forbedret.
- Innsending i staging (velg riktig variant, avvis W203-variant, se saken i /ops).
- Utstyrsvisning: i dag vises bare egenskaper som er `true` (oppvarmet, regnsensor,
  kamera, førerstøtte, sol-/varmereflekterende, antenne, head-up-display).
  **Akustisk glass mangler helt**, og ukjente verdier vises ikke som «Ikke oppgitt».
