# Konflikter i glassdata

Sist oppdatert 2026-11-02 etter **full bulk-skann av alle 14 793 koblede rader**.
Ingen persondata. Skriptet er skrivebeskyttet og rører ingen D1-rader.

## 1. Bulk-skann (målt)

Kjørt med `scripts/audit-typekode-conflicts.mjs` mot `finnbilglass-staging-catalog`,
med de samme funksjonene produksjonskoden bruker (`fraTypekode`, `klassifiserGlass`).

| Klasse | Rader | Andel |
|---|---:|---:|
| `NO_CONFLICT` | 5 376 | 36,34 % |
| `SIDE_UNCERTAIN_STEERING` | 9 296 | 62,84 % |
| `TYPE_CONFLICT` | 84 | 0,57 % |
| `NON_GLASS_PRODUCT` | 27 | 0,18 % |
| `EUROCODE_CONFLICT` | 5 | 0,03 % |
| `FRONT_REAR_CONFLICT` | 5 | 0,03 % |
| `VENTIL_DOOR_CONFLICT` | 0 | 0 % |
| `UNKNOWN_TYPE` | 0 | 0 % |
| **Analysert** | **14 793** | **100 %** |

Avvik mellom forventet og analysert antall: **0**.

`SIDE_UNCERTAIN_STEERING` er **ikke** en konflikt: typekoden oppgir fører- eller
passasjerside, men bilens styretype er ukjent. Systemet lagrer da `fysisk_side = null`
og merker at siden må avklares — aldri en antatt venstre/høyre som om den var et faktum.

**Ekte konflikter: 94 rader (0,64 %)** = 84 type + 5 eurokode + 5 front/bak.
Alle blokkeres fra automatisk godkjenning og vises med konfliktmarkør i Admin.

## 2. Registerkonflikter etter import (målt)

| Kontroll | Resultat |
|---|---:|
| Varenumre med mer enn én typekode | **0** |
| Varenumre med små bokstaver eller mellomrom | **0** |
| Rader i `glass_typekode` uten gyldig kode | **0** |
| Kilder representert | 1 (`autoglass-no`) |

Registeret er internt konsistent. Det betyr ikke at det er riktig — bare at det ikke
motsier seg selv.

## 3. Konflikter som oppstår i bruk

`klassifiserGlass()` returnerer `typekodeKonflikt = true` når typekoden motsier
navn eller eurokode. Da blir `erFrontrute` `false` uansett hva navnet sier,
`grunn` forklarer hva som motsier hva, og utfallet skal bli `MANUAL_REVIEW`.
Flagget følger med i resultatobjektet helt ut til katalog-API-et.
Enhetstestet i `tests/typekode-posisjon.test.mjs`.

## 3. Kjente, åpne produktkonflikter

| Sak | SKU | Konflikt | Status |
|---|---|---|---|
| Mazda CX-5 | `29730YP` | Kildene er uenige om fører-/passasjerside | **Åpen.** Skal forbli `MANUAL_REVIEW` til den er dokumentert løst |
| VW Transporter | `SU 18018` | Flere frontrutevarianter, utstyr ikke avklart | Skal aldri gi ubekreftet EXACT |
| Mercedes CLA | `AJ 95429` | Flere mulige varianter | Skal føre til avklarende spørsmål |

Disse er ikke løst av typekode-importen. Typekoden sier *hvor* glasset sitter,
ikke *hvilken bil* det passer eller *hvilket utstyr* bilen har.

## 4. Kilder som ikke gir fitment

`Abdeckungsliste_CSC_V78_DIN_A3_EN.xlsx` (GUTMANN CSC-Tool Coverage List V78)
er undersøkt. Den beskriver **ADAS-kalibreringsdekning per kjøretøy** — hvilke biler
som krever kalibrering etter at kamera, radar eller rute er berørt, og hvilken
målskive/versjon som brukes.

Den sier **ingenting** om hvilket glass som passer. Den skal derfor ikke importeres
som fitment-evidens. Mulig senere bruk: informasjon til kunden om at bilen krever
kalibrering etter ruteskift — det er en serviceopplysning, ikke en glassidentifikator.

## 5. Hva som ikke er en konflikt

- Dør, siderute og ventilrute har alle «sidefamilie» i eurokoden (L/R). Det er
  ikke motstrid — eurokoden sier bare side, ikke hvilken type sideglass.
- Manglende typekode er ikke en konflikt. Det er ukjent, og skal vises som ukjent.
- Ulike varenumre for samme fysiske glass er ikke automatisk ekvivalens. Det krever
  dokumentert erstatningskjede.
