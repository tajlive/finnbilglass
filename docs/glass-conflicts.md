# Konflikter i glassdata

Sist oppdatert 2026-11-02 etter typekode-import til staging. Ingen persondata i dette dokumentet.

## 1. Registerkonflikter etter import (målt)

| Kontroll | Resultat |
|---|---:|
| Varenumre med mer enn én typekode | **0** |
| Varenumre med små bokstaver eller mellomrom | **0** |
| Rader i `glass_typekode` uten gyldig kode | **0** |
| Kilder representert | 1 (`autoglass-no`) |

Registeret er internt konsistent. Det betyr ikke at det er riktig — bare at det ikke
motsier seg selv. Krysskontroll mot andre kilder gjenstår.

## 2. Konflikter som oppstår i bruk (detekteres nå, men er ikke kvantifisert i bulk)

`klassifiserGlass()` returnerer `typekodeKonflikt = true` når typekoden motsier
navn eller eurokode. Når det skjer:

- `erFrontrute` blir `false` uansett hva navnet sier
- `grunn` forklarer hvilken kode som motsier hva
- utfallet skal bli `MANUAL_REVIEW`, aldri EXACT

Dette er enhetstestet (`tests/typekode-posisjon.test.mjs`, 10 tester).
En full bulk-skanning av alle 14 793 koblede rader for å telle faktiske motstrid
er ikke kjørt ennå — det er neste kvalitetssteg.

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
