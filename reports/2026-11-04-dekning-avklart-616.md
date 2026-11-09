# Dekning avklart — 616 biler, to veier målt separat

**Staging:** `8e87cc3c-d7bb-4a71-bbe0-41cde6ff8ef7` · **Produksjon:** urørt (`7ae6d2a6`)

---

## 1. Hva «uten kandidater» faktisk målte

Bred-kontrollen kjørte **bare valgtreet** (CLASS_D → `glass_prisliste`). Frontruten går
gjennom **`/api/frontrute` (resolveren)**, som er en separat vei. «474 uten kandidater»
var derfor ikke «474 biler uten frontrute».

Frontruten er nå målt for seg: `scripts/resolver-sveip.mjs`, 616 kall mot staging,
0 tekniske feil.

| Resultat | Biler |
|---|---|
| Begge veier | 146 |
| **Bare frontrute (resolver)** | **388** |
| Bare valgtre | 11 |
| **Ingen av veiene** | **71** |
| **Minst én vei** | **545 av 616 (88 %)** |

Resolverens utfall: **PINPOINT 87 · VERIFY 413 · FALLBACK 116**.

**Målefeil som ble rettet underveis:** bred-kontrollen brukte rå merkenavn som
indeksnøkkel, så «Volkswagen» ble målt mot `VOLKSWAGEN` (finnes ikke i katalogen) i
stedet for `VW`. Etter retting med `normMerke()`: kandidater 3 672 → **4 208**, biler med
kandidater 142 → **157**. Tallene før rettingen underrapporterte dekningen.

## 2. De 71 uten treff i noen vei — årsak

| Årsak | Antall |
|---|---|
| Modellfamilie ikke støttet (ID.5, ID.7, Kia Ceed, Polestar 2, Cupra Born, BMW i7, «Andre») | **66** |
| Merke ikke i katalogen | 3 |
| Filtrert bort (Golf Plus 2011, Toyota Hilux 2025) | 2 |

Detaljer per bil: `reports/dekning-616-samlet.json` (test-ID-er, merkerader,
familierader). Ingen av manglene er løst ved å svekke år-, modell- eller variantkontroll.

## 3. Tilbehørslekkasjen — én felles regel

`SENSORGEL` og `BUNNLIST` slapp gjennom fordi kandidatsøket og `produkttype()` hadde
hver sin ordliste. Nå finnes **én** funksjon, `erTilbehorVare()` i `glass-posisjon.ts`,
og begge delegerer til den.

Ordlisten er verifisert mot alle 30 937 rader: 667 rader har `LIST` i navnet, og **alle**
er faktiske lister/klips. 17 av dem inneholder også et glassord («PYNTELIST FRONTRUTE»),
men er trimprodukter — ingen ekte glassrad filtreres.

Tester: sensorgel, sensortape, bunnlist og pyntelist stoppes i **både** kandidatsøk og
innsending; ekte glass med sensor-/listord i beskrivelsen slipper gjennom.

**Før/etter:** 3 672 → 4 208 kandidater (endringen skyldes merkenormaliseringen, ikke
tilbehørsfilteret — det fjernet 7 rader i forrige runde).

## 4. Tilbake i frontrute-flyten — ikke rettet

`#btn-glass-back` vises bare når `valgBak.length > 0`, altså etter valg i valgtreet.
Frontrute-flyten går via resolveren og legger ingenting i `valgBak`.

Rettelsen krever egen navigasjonsstate for resolver-flyten: beholde svar, nullstille
senere ugyldige valg og gammel variant. Det er en funksjonsendring som må testes for seg
(mobil + desktop), og den er **ikke** gjort i denne runden.

## 5. Reproduserbarhet uten kjennemerker i git

- Råmanifest: `data/testgrunnlag/manifest-samlet.json` (gitignorert — ekte kjennemerker).
- **Kryptert kopi i repoet:** `data/testgrunnlag/manifest-samlet-20261104.json.enc`
  (AES-256-CBC, pbkdf2 200 000 iterasjoner).
- **Nøkkel:** Bitwarden Secrets Manager, `TESTGRUNNLAG_616_KEY` (prosjekt Klarpakke).
- Verifisert: dekryptert fil gir 616 biler.
- **R2-opplasting ble avvist** (403, token uten R2-skrivetilgang) — derfor denne veien.

Kjørekommando:

```
node --import tsx scripts/bred-kontroll.mjs --snapshot <prod-rader.json> \
  --manifest data/testgrunnlag/manifest-samlet.json --ut <ut.json>
node --import tsx scripts/resolver-sveip.mjs --limit 616
```

Katalogsnapshot: 30 937 rader, SHA-256 `c221fb6c…`. Manifest-SHA: `2ea5c5ab…`.

**Merk:** `regnr_logg` er egne kundedata, ikke en anonym offentlig kilde. De skal
behandles som personopplysninger og brukes kun til test, ikke publiseres.

## 6. Releasekandidat

| Endring | Fil |
|---|---|
| Felles tilbehørsklassifisering (SENSORGEL, SENSORTAPE, BUNNLIST, LIST) | `src/glass-posisjon.ts`, `src/fitment-v1/catalogue-candidates.ts`, `src/glass-variant-kontroll.ts` |
| Statusordlyd `bekreftet_bil_ukjent_kontroll` | `src/index.ts` |
| Måleskript (ingen kjøretidseffekt) | `scripts/*` |

**Ikke med:** `Tilbake`-fiksen, flaggaktivering, migrasjoner, bredere matchingendringer.

| | |
|---|---|
| QA | **605/605** |
| tsc | grønn |
| 616-settet etter endring | 157 med kandidater, 4 208 kandidater, 945 løv, **0 feil** |
| Staging | `8e87cc3c-d7bb-4a71-bbe0-41cde6ff8ef7` |
| Rollbackmål (produksjon) | `7ae6d2a6-7392-48c4-bbb8-6e230e88d20d` |

**Produksjonsforespørsel:** deploy av tilbehørsrettingen + statusordlyden. Ingen
flaggendring, ingen migrasjon, ingen dataskriving. Kan rulles tilbake til `7ae6d2a6`
ved å deploye forrige versjon.

## Fasitpar

Fortsatt **2** (SU18018 PROVISIONAL, AJ95429 AMBIGUOUS). 545 biler med kandidater er
konsistens, ikke dokumentert passform.
