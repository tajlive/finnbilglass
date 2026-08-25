# Tesla Parts Pilot — VIN → OE Frontrute Test (2026-08-25)

## Oppsett
- Portal: https://parts.tesla.com (offisiell Tesla Parts katalog)
- Konto: Gratis Tesla-konto tilgjengelig for delkatalog; bedriftskonto relevant for videresalg/dedikert støtte, men ikke krav for å søke i katalogen.
- Testgrunnlag: 10 probe-rader i `oem_probe_queue` (status=pending), stratifisert på modell/år/produksjonsland/utstyrspakke.

## Test-prober (klare i DB — VIN kun i minnet under test, vin_hash i tabellen)

| probe_id | Modell | År | Produksjonsland | Utstyrspakke (kjent fra VIN) |
|---|---|---|---|---|
| tesla-20250825-001 | Model Y | 2025 | Fremont, USA | Nye strukturelle batteripakker, HW4.0-kamera |
| tesla-20250825-002 | Model 3 | 2021 | Fremont, USA | HW3.0, standard glass |
| tesla-20250825-003 | Model Y | 2023 | Fremont, USA | HW3.0, akustisk glass |
| tesla-20250825-004 | Model Y | 2023 | Berlin, DE | HW3.0, standard glass |
| tesla-20250825-005 | Model Y | 2023 | Fremont, USA | HW3.0, oppvarmet glass |
| tesla-20250825-006 | Model Y | 2023 | Austin, TX | HW4.0, akustisk + oppvarmet |
| tesla-20250825-007 | Model 3 | 2022 | Fremont, USA | HW3.0, akustisk glass |
| tesla-20250825-008 | Model Y | 2022 | Fremont, USA | HW3.0, standard glass |
| tesla-20250825-009 | Model Y | 2021 | Fremont, USA | HW3.0, standard glass |
| tesla-20250825-010 | Model 3 | 2019 | Fremont, USA | HW2.5/3.0, standard glass |

*VIN-er håndteres KUN i minnet under manuell test; kun vin_hash (SHA256(VIN || pepper)) lagres i tabellen. Ingen rå VIN i DB/Git/logg.*

## Akseptansespørsmål per probe (UTFYLL MANUELT VED TEST)

| Q | Spørsmål | Hva leter vi etter |
|---|---|---|
| 1 | Gir VIN-oppslaget faktisk frontrute-OE? | OE-partnummer for windshield/front glass |
| 2 | Er OE entydig eller avhengig av utstyr? | Kameramodul, regnsensor, akustisk, HUD, oppvarmet — splittes det i under-deler? |
| 3 | Finnes supersession/erstattning? | Liste over gamle→nye OE-nummer for samme VIN (JSON i supersession_json) |
|| 4 | Kan OE mappes 1:1 til salgbar eurokode? | Slå opp i `oe_eurocode_mapping` på oe_part → join `glass_catalog` på eurocode WHERE category='frontrute' |
| 5 | Kostnad (€) og sekunder per EXACT? | Mål tid fra VIN → OE → eurokode; kostnad = 0 (gratis) men tid = verdi |
| 6 | Tillater vilkårene lagring av OE-koblingen? | Les Tesla Parts Terms of Use; kan vi lagre VIN→OE permanent i evidence-ledger? |

## Kjøring
1. Logg inn på parts.tesla.com
2. For hver probe: søk VIN → Velg "Windshield" / "Glass" kategori
3. Noter OE-nummer, eventuelle varianter, supersession-kjede
4. Slå opp mot vår crosswalk:
   ```sql
   SELECT gc.eurocode, gc.article_number, gc.brand, gc.model, gc.price
   FROM oe_eurocode_mapping oem
   JOIN glass_catalog gc ON gc.eurocode = oem.eurocode
   WHERE oem.oe_number = '<OE-fra-portal>'
     AND gc.category = 'frontrute';
   ```
5. Oppdater `oem_probe_queue` raden: oe_part, supersession_json, oe_unique, eurocode_match, crosswalk_status, latency_ms, vilkar_lagring_ok, status='completed', decision

## Suksesskriterier (to ledd)

| Ledd | Krav | Mål |
|---|---|---|
| **Portal-dekning** | ≥ 9/10 prober gir identifiserbar, gjeldende frontrute-OE fra Tesla Parts | OE eksisterer og er entydig per VIN |
|| **Crosswalk-dekning** | ≥ 8/10 av de OE-identifiserte gir én salgsbar eurokode via oe_eurocode_mapping + glass_catalog | 1:1 mapping til vår katalog |
| **End-to-end EXACT** | Kun når **begge** ledd oppfylles for samme probe | Bestilling kun ved EXACT |

## Neste steg etter pilot
- Hvis OK: bygg automatisert lookup-funksjon (eller manuell rutine) for Tesla-ordrer
- Hvis delvis OK: analysér hvorfor (år-modell-gap, utstyrs-avhengighet, supersession-kjeder, manglende crosswalk)
- Samme prosess for BMW AOS, Toyota Europa RMI/DAT, Volvo VIDA i prioritert rekkefølge

## Seed-/adminrutine (uten rå VIN i Git)

```bash
# 1. Generer pepper (en gang, bevares sikkert i BWS/Secrets)
export OEM_PROBE_PEPPER=$(openssl rand -hex 32)

# 2. Kjør seed-script lokalt (VIN-er kommer fra SVV-eksport eller manuelt oppslag)
python3 scripts/seed_oem_probes.py --pepper "$OEM_PROBE_PEPPER" --portal "Tesla Parts" --probes 10

# 3. Scriptet skriver KUN vin_hash (SHA256(VIN || pepper)) + metadata til oem_probe_queue
#    Ingen rå VIN skrives til DB-logg, ingen VIN i Git.

# 4. Admin-endepunkt for manuell oppdatering (valgfritt):
#    POST /api/admin/oem-probe/{probe_id}  { oe_part, supersession_json, oe_unique, eurocode_match, crosswalk_status, latency_ms, vilkar_lagring_ok, decision }
```

`scripts/seed_oem_probes.py` opprettes ved første kjøring; funkjson: leser VIN-liste fra miljøvariabel/fil, hasher med pepper, inserter til D1 via wrangler.