# FinnBilGlass – kildeforankret kandidatdekning v2 (16.11.2026)

Status: **draft – kun offline/kandidatforskning**. Bygger på draft PR #97, som igjen bygger på #93/#92/#89. Endrer ingen Cloudflare Workers-, D1-, Kustom-, Gmail- eller OPS-ruter. Ingen automatisk `EXACT`.

## Bekreftet baseline (privat kjøring på brukerens Mac, kun aggregerte opplysninger)

- Tre kilder, 4 573 evaluerte biloppgaver av 10 509 gyldige rader.
- 1 097 med minst én katalogkandidat (**24,0 %**), 3 476 uten.
- 1 906 `MODEL_FAMILY_NOT_SUPPORTED`, 1 461 `BRAND_NOT_SUPPORTED`, 46 uten katalograder, 37 filtrert, 26 årsmismatch. 3 367 av 3 476 (**96,9 %**) representerer *støttegap*, ikke bevis på at produktet mangler i katalogen.
- 1 007 med flere kandidater. Alle 4 573 mangler uavhengig kjøretøy→OE→glass-bevis; 0 `EXACT`.
- Katalogversjon SHA-256: `0e013541626de551665207d26b8099265b9a3bf9373cd6af756815d98f254ae6`.

## Kildekartlegging og trygg utvidelse

Seks faktiske SQL-katalogdeler `db/katalog/prisliste_insert_00..05.sql` er inspisert. Disse **11** modellfamiliene har minst én kildepost med numerisk og identifiserbar `A` (frontrute) i Eurokodeformatet, som gir grunnlag for flere **CLASS_D-kandidater**:

- Skoda: Octavia, Superb
- Mitsubishi: Outlander
- Volvo: XC40, C40 (separat fra XC40)
- Ford: Focus, Kuga, Mondeo
- Toyota: Avensis, Auris, Yaris

Opprettholdte grensekontroller:
- **Volvo V70 utsettes.** Flere frontruteposter er sammensatte `V70+S60`, `S70+V70`, `S80/V70`, `V70+XC70`. De beviser ikke modellspesifikk anvendelse uten ytterligere kontroll. Volvo XC90 har ingen bekreftet separat `A`-frontrutepost i denne snapshot-undersøkelsen.
- `V40+XC40 12-` kan ikke anvendes som selvstendig XC40-bevis. Focus C-MAX er ikke Focus; Avensis Verso er ikke Avensis; Yaris Verso/Cross er ikke Yaris.
- For **alle 11 nytilkomne familier** godtar matcher kun `parseEurocodePosition(...).position === 'WINDSCREEN'`. Ukjente formater og side-/bakruter blokkeres, uansett hva varenavnet ellers sier.
- Dobbelt merke i modellnavnet (`MITSUBISHI MITSUBISHI OUTLANDER`, `TOYOTA TOYOTA RAV4`) normaliseres deterministisk i felles kjøretøynavnfunksjon, uten at karosseri, produksjonsdato eller utstyr blir oppfunnet.
- Original klassifisering `CLASS_D_CATALOGUE_CANDIDATE` beholdes. Ingen skår eller antall kandidater alene gir `EXACT` eller fysisk fitment-sannhet.

## Måling på nøyaktig samme private korpus

Første kjøring har resultater under `~/fbg-private-results/run-20261116-045304`. **Ikke** flytt disse til offentlig GitHub eller lim dem i chat. Beskytt eksisterende HMAC-nøkkel; et nøkkelbytte gir uforenlige private case-ID-er.

Før ny lokal kjøring: verifiser tillatt bruk/oppbevaring av historiske SVV/FINN-data og katalogen, og at du befinner deg på denne PR-grenen. Node 22/24. Det er ingen automatisk innhenting av flere data.

```bash
cd ~/finnbilglass
git fetch origin pull/99/head
git worktree add --detach ~/finnbilglass-corpus-v2 FETCH_HEAD
cd ~/finnbilglass-corpus-v2
npm ci
npm run typecheck
npm run test:source-backed-families
npm run test:private-vehicle-corpus
npm run test:candidate-comparison

umask 077
BASE="$HOME/fbg-private-results/run-20261116-045304"
OUT="$HOME/fbg-private-results/run-v2-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT" && chmod 700 "$OUT"
export FBG_CORPUS_HMAC_KEY="$(cat "$HOME/.config/finnbilglass/corpus-hmac.key")"
npm run corpus:full -- \
  --input "$HOME/bilglass/data/finn-no-regnr/svv-cache.ndjson" \
  --input "$HOME/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson" \
  --input "$HOME/bilglass/data/finn-no-regnr/regnr-with-vin.ndjson" \
  --frozen-sample "$BASE/frozen-first30.json" \
  --output-dir "$OUT"

npm run corpus:compare -- \
  --before "$BASE/priority-evidence-queue.json" \
  --after "$OUT/priority-evidence-queue.json"
unset FBG_CORPUS_HMAC_KEY
```

Publiser kun linjene `FBG_CORPUS_PIPELINE` og `FBG_CANDIDATE_COMPARISON` **etter manuell kontroll av aggregater**, aldri private køfiler eller nøkkel. Et godt resultat må vise både flere nye kandidatbiler og antall tapte/nytt flertydige treff, ikke bare høyere totalprosent.

### Godkjenningsport

1. Node 22 CI: `npm run qa`, `npm run typecheck`, Gitleaks.
2. 11 modellfamilier må ha minst én faktisk katalograd som matcher modell og år, med bekreftet numerisk `A`-posisjon.
3. Negative varianttester må hindre feil kollaps av C-MAX, Verso/Cross, V40/XC40 og Golf/Fiat Electric.
4. VIN med ugyldig tegnformat merkes kun som avvik i privat kø; ikke omdefineres til autentisk bilidentitet. Reell 17-tegnsform er ikke full VIN-validering.
5. Ingen nye `EXACT` / OE-bevis genereres. Privat holdout beholdes, og uavhengig bilspesifikk OE/foto-/montørfasit må innhentes separat.

**GO:** kildekartlegging/offline kandidatdekning når CI er grønn. **NO-GO:** automatisk glassgodkjenning, produksjonsmerge/deploy, betalingsautomatisering eller masseskraping før lisens, uavhengig fitmentbevis og sikkerhetskontroller er verifisert.
