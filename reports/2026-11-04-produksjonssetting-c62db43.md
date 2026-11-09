# Produksjonssetting c62db43 — gjennomført

**Produksjonsversjon:** `90b8c660-121d-4ba4-84c2-b7407d4f432e` (100 % trafikk)
**Commit:** `c62db43` · **Tag:** `release/glassvalg-20261104-v2`
**Rollbackmål:** `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d` (forrige 100 %-deploy, 14:58 UTC)

---

## Førdeploy-kontroll

| Kontroll | Resultat |
|---|---|
| Kildesammenligning mot produksjonens kode (`e03d5ec`) | 5 filer, 58 innsettinger, 11 slettinger — **kun** de tre godkjente endringene |
| Uvedkommende endringer | **ingen** |
| `kommentar` hentes fortsatt | `src/index.ts:600` (kandidatsøk), `src/index.ts:1052` (variantoppslag) |
| `kommentar` brukes i utstyrskontroll | `glass-variant-kontroll.ts:239` → `featuresFraKommentar(rad.kommentar)` |
| Flagg / migrasjoner / katalogdata | uendret — ingen kjørt |

Deploy: `wrangler deploy` lastet opp versjonen; «No targets deployed» gjaldt bare ruter
(custom domain er bundet i dashbordet). Verifisert via Cloudflare-deployments-API:
deployment `20ce16c5` gir **100 % trafikk** til `90b8c660`.

## Etterdeploy-kontroller

| Kontroll | Resultat |
|---|---|
| Aktiv versjon | ✅ `90b8c660`, 100 % |
| Tilbake, mobil 390 | ✅ 6 ruter tilbake · svar **0** · priser **0** · ingen valgt variant |
| Tilbake, desktop 1280 | ✅ 6 ruter tilbake · svar **0** · priser **0** · ingen valgt variant |
| RAV4 + Nei | ✅ **3 357,81 kr** (eneste gjenstående variant) |
| Dokumentert utstyrsmotstrid | ✅ **HTTP 400** med forståelig tekst: «Du svarte at bilen ikke har oppvarmet, men denne varen er dokumentert med oppvarmet …» |
| Tilbehør som glass | ✅ **HTTP 400** «Valgt variant er ikke et glass» (SENSORGEL) |
| Statusordlyd i /ops | ✅ sak **#47**: `tilhørighet: bekreftet_bil_ukjent_kontroll · kontroll: ingen dokumenterte egenskaper å kontrollere svaret mot` |
| Variant + pris følger til /ops | ✅ #47: `8432AGACMV1L`, listepris 10 745 → **3 357,81 kr** |

## Testsaker opprettet i produksjon

| Sak | Formål | Skal slettes |
|---|---|---|
| **#47** | **offisiell merket testsak** — statusordlyd, ukjent utstyr | ja |
| #46 | samme type (ukjent utstyr), opprettet i første forsøk | ja |
| #48 | kontroll av samsvar (oppvarmet glass + «ja») | ja |

Ingen e-post er sendt fra disse; kontaktfeltet er Toms autoriserte testmottaker.
**E-postlevering er ikke påstått** — bare at saken ble opprettet.

## Merknad om kontrollen av utstyrsmotstrid

Varianten `8432AGACMV1L` har kommentaren «+++IKKE ELEKTRISK ENDRET». Denne
kommentaren gir **ingen** dokumentert egenskap i `featuresFraKommentar`, så svaret
havner i `bekreftet_bil_ukjent_kontroll` og går videre til manuell kontroll — begge
svarretninger gir 201. Det er konservativ oppførsel, ikke en feil.

Motstriden ble derfor bevist på `8432AGACHMV1L` (kommentar «+++FULLY HEATED ENDRET»):
kunde «nei» → **400**, kunde «ja» → 201.

## PINPOINT

87 PINPOINT er fortsatt **ikke** uavhengig bekreftet, og er ikke dokumentert fysisk
passform. Kontrollen fortsetter som separat kvalitetsoppgave og endrer ikke denne
releasen. Fasitpar: **2**.

## Rollback

`wrangler rollback` til `7ae6d2a6` (eller deploy av `e03d5ec`). Ingen dataskriving er
gjort i releasen, så tilbakeføringen er ren kode-tilbakeføring.
