# OEM-lag: VIN→OE akseptansetest-plan (FinnBilGlass, 2026-08-25)

## Formål
Bygge det blokkerende laget: legalt VIN → fabrikk-frontrute-OE ved bestillingstidspunkt,
verifisert mot OEM per kjøp. Metode per merke: **100-VIN akseptansetest** med fast spørsmålssett.

## Prioritering (Toms korrigerte rekkefølge — kandidatgap × markedsvolum)

| # | Merke/modell | Portal | VIN i vin_ktype_map (testgrunnlag) |
|---|---|---|---|
| 1 | Nissan Leaf | Nissan europeisk portal (verifiseres) | 122 |
| 2 | BMW 3-serie | BMW AOS | **0** ← må skaffe VIN-er først |
| 3 | Toyota RAV4 | Toyota Europa RMI/DAT (IKKE US TIS) | 201 |
| 4 | Tesla Model 3 | Tesla Parts (gratis konto) | 88 |
| 5 | Toyota Corolla | Toyota Europa RMI/DAT | 58 |
| 6 | Volvo XC60 | VIDA | (del av 95 VOLVO) |
| 7 | Tesla Model Y | Tesla Parts | 115 |

Merk: Leaf/RAV4/Model Y har flest VIN-er i korpuset. Tesla = enkleste pilot (gratis).
BMW mangler VIN-grunnlag → hent fra SVV-korpuset (finnes der, ikke importert til vin_ktype_map).

## Akseptansetest per merke (100 VIN-er)

1. Gir VIN-oppslaget faktisk frontrute-OE?
2. Er OE-et entydig eller avhengig av utstyrsvalg (kamera/regnsensor/HUD/akustisk)?
3. Finnes erstatter/supersession-kjeder?
4. Kan OE kobles 1:1 til salgbar eurokode i vår prisliste/glass_reference?
5. Kostnad og sekunder per EXACT (målt, ikke estimert)?
6. Hva tillater vilkårene å lagre (evidence ledger)?

Suksesskriterium: ≥90/100 VIN-er gir entydig frontrute-OE som mappes til salgbar eurokode.

## Pilot-rekkefølge

### Fase 1 — Tesla Parts (gratis, validerer hele metoden)
- Opprett Tesla-konto, test VIN-søk på 10 Model 3/Y VIN-er fra vin_ktype_map
- Mål: OE-nummer format, diagramtilgang, prisvisning, vilkår om lagring

### Fase 2 — BMW AOS (EPC gratis, teknisk info €80/mnd)
- Skaff 50–100 BMW VIN-er fra SVV-korpuset først
- Test VIN-søk (2015+), frontrute-delgruppe, supersession

### Fase 3 — Toyota Europa + Volvo VIDA (pris må innhentes)
- Kontakt/registrering; verifiser europeisk (ikke US) datakilde for Toyota

## Integrasjon (etter vellykket test)
- `oem_lookup`-tabell: vin_hash, make, oe_part, supersession_chain, eurocode_match, source_portal, cost_eur, latency_ms, captured_at
- Evidence ledger: hver EXACT via OEM = evidence_events med source_type=SYSTEM/OEM, status VERIFIED
- Resolver: PINPOINT kun når OEM-verifisert kobling finnes; ellers VERIFY med kundespørsmål (uendret doktrine)
