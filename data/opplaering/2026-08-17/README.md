# Opplæringsdata — 2026-08-17

Rådata fra dagens QA-økter: SVV-enkeltoppslag, prod-svar og skjermbilder.
Hvert tilfelle er valgt fordi det lærte oss noe om import-deteksjon og
årsmodell-utledning. Sammen med løpende logging (`opplaering_hendelse` +
`opplaering_bilde` i D1/R2) utgjør dette treningsgrunnlaget for matcher/resolver.

## Tilfeller

| Fil | Kjennemerke | Bil | Læringspoeng |
|---|---|---|---|
| `svv-jd94062-bruktimport-nederland-2014.json` | JD 94062 | Mitsubishi Outlander PHEV 2014 | **EKTE bruktimport**: SVV `bruktimport`-objekt (NEDERLAND, 105 291 km, tidl. skilt 2-TPV-90) + `forstegangRegistrertDato 2014-04-14`. Årsmodell = 2014 (IKKE registreringsåret 2025). |
| `svv-ef93128-tesla-norsk-nybil-2023.json` | EF 93128 | Tesla Model Y 2023 | **FALSK import-flagg**: fortollingsbeskrivelse starter med «GB Model Y 2023 Europe 11GB TESLA 12GB…» — «GB» er tollformatets feltkode (11GB/12GB), IKKE Storbritannia. Landkode i fortollingsbeskrivelsen er ALDRI bevis. |
| `svv-jd79487-norsk-nybil-2017.json` | JD 79487 | VW Caddy 2017 | Norsk-levert nybil: fortollingsreferanse finnes (alle biler fortolles) men gap COC→reg = 2 mnd og ingen `bruktimport` → ikke import. `nasjonaltGodkjenningsAr 2016` = typegodkjenningsår, ikke årsmodell. |
| `svv-su18018-norsk-2005.json` | SU 18018 | VW Transporter 2005 | Eldre norsk bil: ingen fortollingsreferanse i det hele tatt, gap 1 mnd → ikke import. Årsmodell 2005 fra `forstegangRegistrertDato` (nasjAr 2003 = typegodkjenning). |
| `prod-jd94062.json` / `prod-jd79487.json` | — | — | Prod-svar (finnbilglass.no/api/regnr) etter fiks — verifiserer at API-et returnerer riktig `aar`, `import`, `importLand`. |
| `skjermbilde-jd94062-bekreft-side.png` | JD 94062 | — | Skjermbilde fra kunden: viste feil «2025» + manglende import-merking FØR fiks. |
| `skjermbilde-ef93128-tesla-falsk-import.png` | EF 93128 | — | Skjermbilde: viste falsk «importert fra Storbritannia» FØR fiks. |

## Import-deteksjonsregler (gjeldende, etter dagens to fikser)

1. **SVVs `bruktimport`-objekt** (importland + kilometerstand) = autoritativt bevis.
2. **COC-gap > 24 mnd** (typegodkjenning → norsk førstegangsregistrering) = sterkt signal.
3. **Fortollingsbeskrivelsens landkode** («GB Model Y…») = **aldri** bevis — tollformat-feltkoder
   (11GB/12GB/13AK…) ser ut som landkoder. Brukes kun som importland-NAVN når import er bevist.
4. Fortollingsreferanse alene betyr ingenting — alle biler i Norge fortolles.

## Årsmodell-regler (gjeldende)

1. `forstegangRegistrertDato` (bilens FØRSTE registrering noensinne, uansett land) — primær.
2. `nasjonaltGodkjenningsAr` — kun fallback (kan ligge 1–2 år før bilen, f.eks. Caddy 2017 → 2016).
3. Norsk registreringsår — siste fallback (feil for bruktimport: 2025-registrert 2014-bil).

## Løpende logging (fra 2026-08-17)

- **`opplaering_hendelse`** (D1): alle valg + inntasting med `session_id` —
  `sok_regnr`, `sok_vin`, `foto_skilt`, `bekreft_ja/nei`, `spm_svar` (utstyrs-fasit!),
  `tilbehor_valg`, `verify_foto/manuell/bekreft`, `nytt_sok`.
- **`opplaering_bilde`** (D1) + **R2 `finnbilglass-opplaering`**: skilt-foto og 43R-foto
  med AI-lesing, confidence og utfall — innlesingsfeil kan analyseres og trenes bort.
- Session-id (localStorage `fb-session-id`) kobler hele kundereisen.
