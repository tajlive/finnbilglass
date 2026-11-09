# Datadekning — før og etter (typekode-import)

Målt mot **staging** (`finnbilglass-staging-catalog`), 2026-11-02.
Alle tall er hentet med SQL mot databasen etter import — ingen estimater.

## Hovedresultat

| Måltall | Før | Etter | Endring |
|---|---:|---:|---:|
| Rader i `glass_prisliste` | 29 627 | 29 627 | uendret |
| Rader med kjent glassplassering (typekode) | **0** | **14 793** | +14 793 |
| Andel med kjent plassering | **0,0 %** | **49,9 %** | +49,9 pp |
| Distinkte typekoder representert | 0 | 18 | +18 |
| Tabellen `glass_typekode` | fantes ikke | 20 601 rader | ny |

Før importen fantes **ingen** tabell for typekode i noen av D1-databasene (verken prod eller staging).
Migrasjon `0020` var aldri applisert. Det betyr at alle dørruter, ventilruter og sideruter
tidligere var uten dokumentert plassering — de havnet i `MANUAL_REVIEW` eller ble behandlet som ukjent.

## Fordeling etter import (prisliste-rader)

| Glassgruppe | Typekoder | Rader |
|---|---|---:|
| Frontrute | `F` | 2 980 |
| Bakrute | `B` | 2 437 |
| Bakrute delt | `BF`, `BP` | 15 |
| Dørrute | `DFF`, `DFB`, `DPF`, `DPB` | 4 939 |
| Ventilrute | `DFFV`, `DFBV`, `DPFV`, `DPBV` | 1 754 |
| Siderute | `SFB1`–`SFB3`, `SPB1`–`SPB3` | 2 668 |
| **Sum med plassering** | | **14 793** |
| Uten plassering | | 14 834 |

Merk: dørruter (4 939), ventilruter (1 754) og sideruter (2 668) — til sammen **9 361 rader** —
er glass som tidligere ikke kunne plasseres i det hele tatt. Det er den reelle gevinsten,
ikke frontrutene.

## Hvorfor 14 834 rader fortsatt mangler plassering

Kilden `products-autoglass-no.csv` dekker 20 735 unike varenumre, og bare 134 av dem mangler typekode.
De 14 834 prisliste-radene uten plassering er **varenumre som ikke finnes i denne kilden i det hele tatt** —
typisk utgåtte artikler og varenumre fra andre leverandører.

Kilden er dermed **uttømt for denne tabellen**. Videre dekning krever andre kilder
(Pilkington, Glavista, ihrautoglas er allerede kartlagt; PROSEKT-XLS-en inneholder ingen typekoder).

## Kilder som ble undersøkt

| Kilde | Innhold | Bidro med |
|---|---|---|
| `products-autoglass-no.csv` (27 184 rader) | `sku`, `type_code`, `type_code_desc`, pris, modell | **Typekoder — hele gevinsten** |
| `PROSEKT API 16 MAI26 (1).xls` (34 800 rader) | Varenr, Varenavn, Pris, Eurokode | Ingenting nytt: 27 762 unike varenr = identisk med dagens prisliste. Bekrefter proveniens |
| `autoglass-katalog.csv` (33 214 rader) | eurocode, ADAS, regnsensor, oppvarming, akustikk, antenne, HUD | Allerede importert (`glass_catalog`, 33 215 rader med kategori) |
| `Abdeckungsliste_CSC_V78_DIN_A3_EN.xlsx` | tysk dekningsliste | Ikke tolket — overskriftsrad mangler i første ark, må undersøkes nærmere |
| `2026-10-19_productprices_Skanbatt.no.xlsx`, `SUPPLIES_04-2026.xlsx`, `elbattno…csv` | batterier og rekvisita | **Ikke bilglass** — skal ikke importeres |
| `Chrome-passord.csv` (865 rader) | passordeksport | **Ekskludert.** Ikke katalogdata, skal ikke ligge i prosjektmappe |

## Hva som IKKE er gjort

- Import til produksjon. Bare staging er oppdatert.
- Kobling av typekode inn i resolveren og katalogsøket (dataene ligger klare, men koden leser dem ikke ennå).
- Kvalitetskontroll av konflikter mellom kilder (rapportert: 0 konflikter i kilden ved import).
- Undersøkelse av den tyske dekningslisten.
