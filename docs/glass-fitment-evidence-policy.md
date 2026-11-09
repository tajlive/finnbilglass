# Bevispolicy for glassfitment

Dette dokumentet definerer hva som kvalifiserer for EXACT og hva som aldri gjør det.
Policyen er bindende for resolver, Admin 2026 og alle importjobber.

## De fem spørsmålene som må besvares hver for seg

| # | Spørsmål | Kan besvares av |
|---|---|---|
| A | **Produktidentifikasjon** — hva er dette glasset? | eurokode, varenummer, OE-nummer fra leverandørkatalog |
| B | **Posisjonsidentifikasjon** — hvor på bilen sitter det? | typekode + kjøretøyets karosseritype |
| C | **Kjøretøykompatibilitet** — hvilke varianter passer det til? | applikasjonsdata (merke/modell/år/kType) |
| D | **Utstyrskompatibilitet** — kamera, sensor, HUD, oppvarming? | kundesvar, OE-bilde, montørbekreftelse |
| E | **Kommersiell tilgjengelighet** — finnes riktig SKU til bekreftet pris? | prisliste med bekreftet pris |

EXACT krever at **alle fem** er avklart med uavhengig dokumentasjon og uten motstridende data.
A + B + C er ikke nok. D kan aldri utledes fra en katalog alene.

## Det som ALDRI gir EXACT

- At det bare finnes ett søkeresultat
- At typekoden stemmer
- At eurokoden ser riktig ut
- At merke, modell og år stemmer
- At samme opplysning gjentas i to kataloger som stammer fra samme datasett
- Høy confidence-score
- At et liknende tilfelle ble løst tidligere
- E-merke, 43R eller DOT-nummer — et glass kan ha over hundre godkjenningskoder, og de identifiserer ikke glasset
- VIN alene — VIN gir variant, ikke montert utstyr

## Utfallene

| Utfall | Betydning | Kan gi bindende tilbud? |
|---|---|---|
| `EXACT` | Alle fem spørsmål avklart med uavhengig dokumentasjon, ingen motstrid | Ja |
| `PROVISIONAL` | Én plausibel kandidat, men minst ett spørsmål er uavklart | Nei — må avklares |
| `AMBIGUOUS` | Flere aktuelle kandidater gjenstår | Nei — kunden må velge utstyr |
| `MANUAL_REVIEW` | Manglende data eller motstridende kilder | Nei — saksbehandler |

Katalogen er en **kandidatgenerator**, aldri en sannhetskilde.

## Uavhengighet

To kilder er bare uavhengige hvis de ikke stammer fra samme opprinnelige datasett.
En CSV-eksport og en scrape av samme leverandørnettsted er **én** kilde, ikke to.
Kilde og kildefil skal alltid lagres sammen med verdien, slik at uavhengighet kan etterprøves.

## Konflikter

Når to kilder sier ulikt om samme varenummer (for eksempel fører/passasjer på Mazda CX-5 `29730YP`), skal:

1. Konflikten registreres med begge verdier, kilde og kildefil.
2. Utfallet aldri være EXACT.
3. Saken havne i gjennomgangskø for manuell avgjørelse med begrunnelse.
4. Manuell godkjenning være sporbar: hvem, når, hvorfor — og beskyttet av servervalidering.

## Spørsmål til kunden

Still bare spørsmål som **faktisk skiller** mellom de gjenstående kandidatene.
Eksempler som skiller: «Har frontruten kamera ved speilet?», «Er glasset oppvarmet?»,
«Hvilken dørrute gjelder det?», «Er bilen høyre- eller venstrestyrt?».

Spørsmål som ikke skiller noe (antenne, mikrofon, godkjenningsmerking) skal ikke stilles.

## HUD-unntaket

HUD vises ikke på glasset — det er et projisert bilde fra dashbordet.
Attributtet `hud` kan derfor **aldri** settes fra eurokode, katalog eller kundebilde.
Bare et eksplisitt kundesvar kan avgjøre det. Standard er ukjent.
