# Oppgave 6a-lite — Godkjenningsgrunnlag: 13 liste-koder (PY/GU) i fasit-live

**Dato:** 2026-08-19 · **Status:** VENTER PÅ TOM-GODKJENNING PER RAD — ingen fjerning ennå
**Mekanisme:** Fjerning skjer kun etter eksplisitt godkjenning, logges i evidence-ledger som `data_correction` (godkjent_av, tidspunkt), og verifiseres til nøyaktig 14 entydige saker.

## Kilde (hvorfor disse er lister, ikke glass)

1. **Varenr-suffiks-regelen (Tom 2026-08-17)**, kodifisert i `scripts/gt-generator.mjs:92-96` + `src/matcher.ts:300-307`:
   - `PY*`-familien (PY, PYT, PYB, PYV, PYH, PYS, PYC, PYKIT…) = **PYNTELIST**
   - `GU*`-familien (GU, GUM) = **GUMMILIST**
   - Begge er dekorlister rundt glasset — **IKKE glass**
2. **Maskin-verifisert:** `erFrontrute('', kode, kode)` → `false` for alle 13 koder (kjørt 2026-08-19).
3. **Pris-presedens (UR67407):** list 625 kr (1979PY) vs glass 5 320 kr (1979C) — samme kode-familie.

## Godkjennings-tabell (13 koder / 14 saker — ALLE blir entydige)

| # | Kode | Sak (bil) | Alle gyldige koder | Blir entydig |
|---|---|---|---|---|
| 1 | 1199GU | RENAULT TRAFIC VAREVOGN 1994 | 1199GU, 6300ASMVT | ✅ → 6300ASMVT |
| 2 | 1411PY | NISSAN LAUREL C32 1996 | 1411PY, 5964ASMSI | ✅ → 5964ASMSI |
| 3 | 1491PYC | LANCIA THEMA 1994 | 1491PYC, 3336AKMHC | ✅ → 3336AKMHC |
| 4 | 1598PY | SUZUKI VITARA 1989 | 1598PY, 8010AKMR | ✅ → 8010AKMR |
| 5 | 1923PY | OMEGA B SED+5D STV 1995 | 1923PY, 6261AKMS | ✅ → 6261AKMS |
| 6 | 2036PY | MERCEDES W638 2002 | 2036PY, 5428ASMVT | ✅ → 5428ASMVT |
| 7 | 2072PY | HONDA CRV 1997 | 2072PY, 3962ASMR | ✅ → 3962ASMR |
| 8 | 2077PY | PEUGEOT PARTNER + BERLINGO 2007 | 2077PY, 6537ASMV | ✅ → 6537ASMV |
| 9 | 2244PY | TOYOTA CELICA 2002 | 2244PY, 8316ASMC | ✅ → 8316ASMC |
| 10 | 2288PY | NISSAN MAXIMA QX 2003 | 2288PY, 6015ASMST | ✅ → 6015ASMST |
| 11 | 2459PY | TOYOTA SUPRA 2013 | 2459PY, 8284ASMC | ✅ → 8284ASMC |
| 12 | 2898PY | OPEL AGILA + SUZUKI SPLASH 2018 | 2898PY, 8034ASMH | ✅ → 8034ASMH |
| 13 | 2898PY | OPEL AGILA + SUZUKI SPLASH 2019 | 2898PY, 8034ASMH | ✅ → 8034ASMH |
| 14 | 685GU | MERCEDES W116 1977 | 685GU, 5319ASRS | ✅ → 5319ASRS |

## Verifiseringsplan etter godkjenning

1. Rens `data/fasit-live.json` (kun de 13 kodene) med kilde `data_correction`.
2. Logg i evidence-ledger: `data_correction` / godkjent_av / tidspunkt (hard regel 5).
3. Kjør `fasit-integritet.test.mjs` + `fasit-live.test.mjs` + dekningsrapport → **bekreft nøyaktig 14 entydige saker** (ikke flere, ikke færre).
4. Ingen kode-endring — kun fasitdata med logget godkjenning.
