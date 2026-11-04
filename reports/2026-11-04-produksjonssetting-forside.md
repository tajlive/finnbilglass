# Forside-tekst og tittel produksjonssatt

**Produksjonsversjon:** `cb713faa-7962-4d75-85a3-8d28c5e8b6da` (100 %)
**Commit:** `1dc84fed`
**Forrige produksjonsversjon (rollbackmål):** `ddb24a49-64f…` (deploy 17:17 UTC, commit `5506500d`)
**Registrert:** deployment `a9466ede-16d`, 17:30 UTC

---

## Verifisert i produksjon

| Kontroll | Bredde | Resultat |
|---|---|---|
| Sidetittel | – | `<title>Billigst på bilglass i Norge (sist kontrollert 01.11.26) | Finnbilglass</title>` |
| Hero desktop | 1280 px | «Uten glassdekning – eller må ruten byttes på grunn av slitasje?» + brødtekst, to linjer |
| Hero mobil | 390 px | «Må du betale glasset selv?» + brødtekst, to linjer |
| Riktig variant vist | begge | desktop `block` / mobil `none` ved 1280 · motsatt ved 390 |
| Horisontalt overløp | begge | nei |

Tittelen er 74 tegn. Google viser ca. 60, så «| Finnbilglass» kuttes i søkeresultatet.

## Merknad om datoen

Tittelen sier «sist kontrollert 01.11.26». Vi har **ikke** gjennomført en
prissammenligning på denne datoen — det finnes ingen konkurrentpriser i prosjektet.
Tittelen er satt etter Toms eksplisitte valg. Skal datoen være dokumenterbar, må
sammenligningen faktisk gjøres og lagres med kilder.

## Rollback

`wrangler rollback` til `ddb24a49`. Ren kode-tilbakeføring, ingen dataskriving.
