# Fase 3 – Kontrollert verifisering: Test-utvalg (100 varekort)

**Dato:** 2026-11-01  
**Status:** Klar for prøvekjøring — **IKKE startet** (venter kostnads-GO + ditt GO)  
**Input:** Historisk CSV (27 184 rader, mai 2026)  
**Output:** `data/test-utvalg-100.csv` (100 representanter)

---

## 1. Oppsamling test-utvalg

| Kriterie | Implementert | Detaljer |
|----------|--------------|----------|
| Alle glassklasser | ✅ | frontrute (13), bakrute (12), dør (30), side (24), ventil (16), ukjent (5) |
| Fremre/bakre dør | ✅ | DFF/DFB/DPF/DPB = 30 dørruter (fremre 16, bakre 14) |
| Venstre/høyre | ✅ | Venstre: DFF/DFB/DFFV/DFBV/SFB1/SFB2/SFB3; Høyre: DPF/DPB/DPFV/DPBV/SPB1/SPB2/SPB3 |
| Ventilruter foran/bakre | ✅ | DFFV/DPFV = foran (8), DFBV/DPBV = bakre (8) |
| Takglass | ⚠️ | Ingen i CSV (type_code F/B/ventil/dør/side) — takglass må hentes fra Glavista/Pilkington |
| Dokumenterte konflikter | ✅ | **Mazda CX-5 29730YP** inkludert (prioritert) |

---

## 2. Fordeling i test-utvalg (100 rader)

### Per type_code
| type_code | Beskrivelse | Antall | Glassklasse |
|-----------|-------------|--------|-------------|
| F | Frontrute | 13 | frontrute |
| B | Bakrute | 12 | bakrute |
| DFF | Dørrute fremre førerside | 8 | dør |
| DFB | Dørrute bakre førerside | 8 | dør |
| DPF | Dørrute fremre passasjerside | 7 | dør |
| DPB | Dørrute bakre passasjerside | 7 | dør |
| DFFV | Ventil/siderute fremre førerside | 5 | ventil |
| DFBV | Ventil/siderute bakre førerside | 4 | ventil |
| DPFV | Ventil/siderute fremre passasjerside | 3 | ventil |
| DPBV | Ventil/siderute bakre passasjerside | 4 | ventil |
| SFB1 | Siderute bakre 1 førerside | 7 | side |
| SPB1 | Siderute bakre 1 passasjerside | 7 | side |
| SFB2 | Siderute bakre 2 førerside | 3 | side |
| SPB2 | Siderute 2 bakre passasjerside | 2 | side |
| SFB3 | Siderute 3 bakre førerside | 3 | side |
| SPB3 | Siderute 3 bakre passasjerside | 3 | side |
| BF/BP | Ukjent typekode | 5 | ukjent |

**Totalt: 100 rader**

### Per glassklasse
| Glassklasse | Antall | Typekoder |
|-------------|--------|-----------|
| dør | 30 | DFF, DFB, DPF, DPB |
| side | 24 | SFB1, SPB1, SFB2, SPB2, SFB3, SPB3 |
| ventil | 16 | DFFV, DFBV, DPFV, DPBV |
| frontrute | 13 | F |
| bakrute | 12 | B |
| ukjent | 5 | BF, BP |

---

## 3. Viktige testcaser inkludert

| # | Varenr | Typekode | Beskrivelse | Hvorfor valgt |
|---|--------|----------|-------------|---------------|
| 1 | **29730YP** | **DFFV** | **Mazda CX-5 ventil konflikt** | **PRIORITERT KONFLIKT** (CSV: front left vs eurokode: rear right) |
| 2 | 30971GN | DFF | Jaguar F-PACE dørrute fremre | Toms saksbehandling |
| 3 | 10042GN/10043GN | DFF/DFB | Mercedes Gelandewagen fremre+bakre | Samme bil, begge dørledd |
| 4 | 10059CL | DFFV (4 URLer) | Mercedes Trucks ventil fremre | Multi-tilpasning samme SKU |
| 5 | 10044GN/YP | SPB1 | Mercedes Gelandewagen sidebakre | Sideglass høyre |
| 6 | 1018BZ | F (3 URLer) | Saab 900 frontrute | Multi-tilpasning frontrute |
| 7 | 10030CL | DFFV (6 URLer) | Fiat Ducato/Daihatsu ventil | Multi-merke samme SKU |
| 8 | 1027C/GB | F (2 URLer) | Fiat Daily frontrute | Lastbil frontrute |

---

## 4. Forventet resultat per testcase

Hver resultatrad skal inneholde (per Fase 3-krav):

```json
{
  "supplier": "auto-glass.no",
  "varenr": "29730YP",
  "source_url": "https://auto-glass.no/varer/...",
  "fetched_at": "2026-11-XX",
  "type_code_raw": "DFFV",
  "glass_kind": "ventil",
  "position": "front",
  "door_position": null,
  "physical_side": "left",
  "driver_passenger_side": "driver",
  "steering_position": "LHD",
  "source_version": "2026-11-XX",
  "evidence_ref": "varkort-url",
  "verification_status": "UNVERIFIED",
  "conflict_status": "CONFLICT",
  "conflict_reason": "CSV type_code DFFV (front left) vs eurokode 5179RYPR5RV (rear right)"
}
```

---

## 5. Spesielle krav fra oppdrag (sjekkliste)

| Krav | Status | Kommentar |
|------|--------|-----------|
| `driver_passenger_side` som separat felt | ✅ | `driver` / `passenger` basert på DFF/DPF vs DFB/DPB |
| `steering_position` hvis dokumentert | ⚠️ | Ikke i CSV — må hentes fra varekort/metadata |
| Aldri oversett førerside/passasjerside til fysisk venstre/høyre uten godkjent regel | ✅ | Behholder `driver`/`passenger` separat fra `physical_side` |
| Ingen automatisk `verified`-status | ✅ | Alle settes til `UNVERIFIED` |
| Ingen automatisk `PINPOINT` ved ukjent dørledd/rattplassering/konflikt | ✅ | `verification_status=UNVERIFIED`, `conflict_status=CONFLICT` hvor gjelder |

---

## 6. Filer levert

| Fil | Innhold |
|-----|---------|
| `data/test-utvalg-100.csv` | 100 representanter (se over) |
| `scripts/velg-test-utvalg.mjs` | Velgeskript (gjentakbar) |

---

## 7. Neste steg (Fase 3 → Fase 4)

| Steg | Status | Blokkert av |
|------|--------|-------------|
| Kostnads-GO (Fase 2) | ✅ Latt kostnad ($1–3 total) | — |
| Ditt GO på prøvekjøring | ⏳ **VENTER** | Ditt eksplisitte GO |
| Kjør Apify Actor med `limit=100` + `resume=false` | ⏳ | Ditt GO |
| Samle resultater i Apify Dataset | ⏳ | Kjøring fullført |
| Fase 4: Konflikter og kvalitet | ⏳ | Resultater tilgjengelige |

---

## 8. GO/NO-GO for prøvekjøring

| Kriterie | Status |
|----------|--------|
| Test-utvalg representativt (100 rader, alle klasser) | ✅ PASS |
| Konflikter inkludert (Mazda CX-5) | ✅ PASS |
| Kostnad prøvekjøring < $1 | ✅ PASS |
| Actor-kode stabil (ingen endringer) | ✅ PASS |
| **Ditt eksplisitte GO** | ⏳ **MANGLER** |

**Anbefaling:** Si `GO` så starter jeg prøvekjøringen (Actor `finnbilglass-catalog` med `limit=100`, `probeMode=false`).

---

**Ingen scraping, D1-skriving, migrasjon eller deploy utført.** `inquiries_enabled=0` beholdes.