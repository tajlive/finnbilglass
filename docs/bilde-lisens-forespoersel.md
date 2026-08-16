# Bilde-lisens: forespørsel til leverandør (KLA-301, G3)

> Formål: lovlig bruk av frontrutebilder på finnbilglass.no. **Status: IKKE SENDT — Tom sender via Autoglass-relasjonen.** Uten svar: bilde-dekning forblir 0 %.

## Fakta

- FinnBilGlass viser i dag **0 produktbilder** — ingen skriftlig bilde-rett foreligger.
- Buycarparts og andre nettbutikk-bilder kan IKKE republiseres kommersielt (opphavsrett).
- Autoglass AS har leverandøravtaler med Pilkington, Saint-Gobain Sekurit, AGC, Xinyi, Fuyao — bilder kan komme derfra eller fra leverandørens produktfeed/mediebibliotek.

## Forslag til tekst (epost til leverandørkontakt)

> Hei [navn],
>
> FinnBilGlass (vårt B2C-selskap, finnbilglass.no) selger frontruter direkte til privatkunder.
> For å gi kundene trygghet ønsker vi å vise produktbilder av frontrutene vi formidler.
>
> Vi ber derfor om skriftlig tillatelse til å bruke produktbilder fra dere i vår nettbutikk
> under følgende betingelser:
> - bruk: produktbilder på finnbilglass.no (og vårt B2B-verktøy), ingen annen bruk
> - kilde: bilder leveres via deres produktfeed/mediebibliotek eller egne bilder vi tar
> - attribution: produsent/merke angis der det kreves
> - endringer: ingen manipulasjon av bildene uten godkjenning
> - varighet: så lenge produktet selges av oss
>
> Kan dere bekrefte dette per e-post, eller peke oss til deres offisielle
> bilde-/mediabibliotek med bruksvilkår?
>
> Med vennlig hilsen
> Tom Arne Jensen, Autoglass AS

## Hva som skjer når tillatelsen foreligger

1. Bilder lastes inn via `scripts/catalog-harvester.mjs --download-media --media-licensed --media-host <godkjent host>`.
2. Hvert bilde: MIME-sjekk → SHA-256 → phash → R2 → `glass_media`-rad med `license_ref` + `attribution`.
3. Gate G3 (≥90 % bilde-dekning på prioriterte salgbare ruter) måles, deretter G4 (100 % provenance).
