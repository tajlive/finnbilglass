# Typekode-avstemming 2026-11-04

Kilde: staging `glass_typekode` (20 601 rader) mot produksjonens `glass_prisliste` (30 937 rader).

| | Antall |
|---|---|
| Kan importeres | 14546 |
| Holdes tilbake | 6055 |

## Hvorfor rader holdes tilbake

| Årsak | Antall |
|---|---|
| ikke i produksjonskatalogen | 5968 |
| typekode sier ventilrute, varenavn sier siderute | 27 |
| typekode sier siderute, varenavn sier dorrute | 18 |
| typekode sier dorrute, varenavn sier siderute | 15 |
| kode BP/BF uten dokumentert betydning | 15 |
| typekode sier dorrute, varenavn sier ventilrute | 5 |
| typekode sier ventilrute, varenavn sier dorrute | 5 |
| typekode sier bakrute, varenavn sier siderute | 1 |
| typekode sier frontrute, varenavn sier bakrute | 1 |

Filer: `import-20261104.csv`, `konflikter-20261104.csv` (varenr, typekode, varenavn).
Ingen rader er skrevet til produksjon.
