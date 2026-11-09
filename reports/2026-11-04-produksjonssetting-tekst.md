# Tekstrelease produksjonssatt — 23310f62

**Produksjonsversjon:** `23310f62-abbd-4273-a3a1-e537def2524f` (100 %)
**Commit:** `0e61b43` · tag `release/tekst-20261104`
**Base:** `c62db43` (= forrige produksjonsversjon `90b8c660`)
**Rollbackmål:** `90b8c660-121d-4ba4-84c2-b7407d4f432e`

---

## Node/Wrangler-feilen

**Årsak:** Homebrew hadde oppgradert `simdjson` til 5.0.7 (`libsimdjson.34.dylib`),
mens alle Homebrew-Node-binærer er lenket mot `libsimdjson.33.dylib`. `opt/simdjson`
pekte på 5.0.7, så Node 26.4.0 ikke startet: `Library not loaded: libsimdjson.33.dylib`.

`DYLD_FALLBACK_LIBRARY_PATH` hjalp ikke for brew-binærer (install_name er absolutt).

**Fiks:** `brew unlink simdjson` + `ln -sfn …/Cellar/simdjson/4.6.4 /opt/homebrew/opt/simdjson`.
4.6.4-keggen har fortsatt `libsimdjson.33.dylib`. Verifisert: `/opt/homebrew/bin/node -v`
→ `v26.4.0`, og `npx wrangler --version` → `4.122.0` i en fersk innloggingsshell.

**Reversibelt:** `brew link simdjson` peker tilbake til 5.0.7. Prosjektets egen runtime
(`/Users/taj/.local/bin/node` v24.18.0) var aldri berørt.

## Innhold i releasen (kun tekst)

| Commit | Endring |
|---|---|
| `21ebeb3` | e-postemne «– sak #N», «bekrefter pris og frakt», felles bekreftelse |
| `61779b4` | frakt / retur / reklamasjon / selger (BLYT AS) |
| `b752dc8` | personvern: lagringstid + behandlingsansvarlig |
| `0ad9af6` | all beta-tekst fjernet, merke «Pilot» |
| `13859c6` | **intern rabattopplysning fjernet** («75 % rabatt + mva») |
| `3fa4dcd` | Min side: levering avtales i tilbudet; betaling uten nettbetaling-løfter |
| `1a40c24` | to teksttester oppdatert til pilot |

## Verifisert i produksjon (servert innhold)

| Kontroll | Forventet | Målt |
|---|---|---|
| «veiledende pris med 75» i `frontrute-view.js` | 0 | **0** |
| «Beta for inviterte» i `/` | 0 | **0** |
| `aria-label="Pilot">Pilot` i `/` | 1 | **1** |
| «Forespørselen er mottatt» i `app.js` | 1 | **1** |
| «Nettbetaling» i `betaling.html` | 0 | **0** |
| «Levering og frakt avtales i tilbudet» i `min-side.js` | 1 | **1** |

Nettleser, mobil 390 px: prisdetaljen lyder nå
«Estimert glasspris inkl. mva. Endelig pris bekreftes manuelt i tilbudet. Frakt og
eventuell montering kommer i tillegg.» Prisen er uendret (6 070,31 kr for den
oppvarmede RAV4-varianten). Betalingssiden viser de nye formuleringene.

## Ikke dekket

`om-oss.html`, `bilglass-uten-forsikring.html`, `404.html`, `/ops`-svarmaler og
engangskode-e-posten er ikke gjennomgått og ikke endret.
