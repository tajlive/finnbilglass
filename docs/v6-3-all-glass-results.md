# V6.3 — alle glasstyper: målte resultater

Kjørt mot staging 2026-11-02. Alle tall er SQL-målt, ingen anslag.
`99 % venstrestyring` er en arbeidsantakelse fra eier og rapporteres aldri som dekning.

## 1. Katalogprodukter med dokumentert plassering

| Klasse | Rader |
|---|---:|
| Dørrute | 4 939 |
| Frontrute | 2 980 |
| Siderute | 2 668 |
| Bakrute | 2 437 |
| Ventilrute | 1 754 |
| Delt bakrute | 15 |
| **Sum med plassering** | **14 793** |
| Ikke-frontrute med `rad_type='glass'` | 11 270 |

Registeret har 20 601 typekoderader; 14 793 av dem er koblet til en prislisterad.

## 2. De tre sidetypene — målt

| Opplysning | Rader | Status |
|---|---:|---|
| Visningsforslag fra LHD-marked (`fysisk_side_visning`) | **9 376** | antakelse |
| Verifisert produktside (`produkt_fysisk_side_verifisert`) | **0** | ingen dokumentert produktreferanse ennå |
| Dokumentert kjøretøytilknytning for ikke-frontrute | **0** | GT dekker bare frontruter |

9 376 = dørruter 4 939 + sideruter 2 668 + ventilruter 1 754 + delte bakruter 15.
Resten (front- og bakruter) har ingen side og får derfor ingen visning.

**Dette er kjernen i V6.3:** systemet kan nå vise «venstre (antatt LHD)» på 9 376 rader
uten å påstå at siden er dokumentert. `side_bekreftet` er `false` på alle.

## 3. Testkjøretøy: filtrering virker

| Søk | Filter | Treff | Utelatt uten posisjon |
|---|---|---:|---:|
| `SUBARU XV` | ingen | 51 | 0 |
| `SUBARU XV` | `glassklasse=dor&side_kilde=forer` | **3** | 26 |
| `10030CL` | `glassklasse=ventil` | 1 | 0 |
| `10030CL` | `glassklasse=ventil&dor_ledd=bakre` | **0** (TOM_TREFF) | – |
| `4913AGNGN` | `glassklasse=dor&dor_ledd=bakre` | 0 | 4 |

Filtrering skjer i SQL før `LIMIT`, gjelder **hele** responsen (prisliste, katalog og
ground truth), og faller aldri tilbake til et ufiltrert søk. Treff fra kilder uten
dokumentert plassering utelates og telles i `utelatt_uten_posisjon`.

## 4. EXACT og falske EXACT

| Måltall | Før V6.3 | Etter V6.3 |
|---|---:|---:|
| EXACT fra katalogsøk | 0 | **0** |
| Falske EXACT i regresjonstester | 0 | **0** |
| Kandidater fra `ALL_GLASS_CANDIDATES` med EXACT | – | **0** |

`utfallFor()` kan strukturelt ikke returnere EXACT, og `handleGlassValg()` lagrer
klientens EXACT som PROVISIONAL uten serververifisert evidens.

## 5. Resolveren

| Måltall | Resultat |
|---|---|
| `FRONTRUTE_ONLY` (eksisterende flyt) | uendret — `erFrontrute` avgjør som før |
| `ALL_GLASS_CANDIDATES` (ny) | returnerer dør-, ventil-, side- og bakruter med posisjonsfelter |
| Kandidater i nytt modus mot staging | ikke målt — funksjonen er ikke eksponert over HTTP og krever D1-binding |

`prisKandidat()` har fått en modusparameter med `FRONTRUTE_ONLY` som standard, slik at
eksisterende kalleveier er uendret. `finnGlassKandidater()` er ny og testet på
posisjonslogikken, men er **ikke** kjørt mot staging-bindingen — det er en ærlig
begrensning, ikke en målt dekning.

## 6. Konflikter

| Klasse | Rader | Endring fra V6.2 |
|---|---:|---|
| TYPE_CONFLICT | 84 | uendret, fortsatt sperret |
| EUROCODE_CONFLICT | 5 | uendret |
| FRONT_REAR_CONFLICT | 5 | uendret |
| NON_GLASS_PRODUCT | 27 | uendret, ute av glassresultater |

LHD-antakelsen brukes **ikke** til å overstyre disse. `29730YP` står fortsatt som konflikt.

## 7. Teststatus

| Kjøring | Resultat |
|---|---|
| `npm run qa` | 473 tester · 466 pass · 0 fail · 7 skip |
| `npx tsc --noEmit` | 0 feil |
| API-test (staging) | PASS |
| Komponenttest (`filtrerPaPosisjon`, `rollePaBil`, `fraTypekode`) | PASS |
| Ekte autorisert nettleser-E2E | **ikke kjørt** — staging-innlogging blokkerer |

## 8. Produksjon

Uendret. Ingen produksjonsimport, ingen produksjonsmigrasjon, ingen produksjonsdeploy.
