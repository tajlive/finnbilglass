# Nordisk klarhet — gjennomgang før produksjonssetting

**Dato:** 2026-11-03 · **Branch:** `feat/nordisk-klarhet-20261103` (ikke merget, ikke prod-deployet)
**Miljø verifisert:** lokal (ekte produksjonskatalog kopiert inn) + staging (`finnbilglass-frontrute-staging`, versjon `e1dbdbd2`)

---

## 1. Hva som er implementert

### Datagrunnlag før valg (planens punkt 6)
Nytt endepunkt **`POST /api/glass/valg`** (`src/glass-valg.ts` + `src/index.ts`):

| Krav i planen | Løsning |
|---|---|
| Dokumenterte rutetyper for bilen | `typer[]` bygget fra CLASS_D-kandidatene, med antall per type |
| Gyldige kombinasjoner av plassering og side | Nøstet tre (`barn`); en gren finnes bare hvis minst én kandidat støtter den |
| Nødvendige karosserispørsmål | `body`-steg opprettes **kun** når kandidatene har ulikt dokumentert karosseri |
| Datagrunnlagets status og usikkerhet | `dekning: GOD/TYNN/INGEN`, `antallKandidater`, `ukjentPlassering`, `melding` |
| Rattplassering når dokumentert | `rattplassering: LHD/RHD/UKJENT` + `sidehjelp`; UKJENT gir «Venstre/Høyre side», aldri fører/passasjer |

- Valgene bygges fra **hele** kandidatsettet før noen resultatkapping (`hentAlleKandidater`, ingen `.slice`).
- Steg med bare ett reelt alternativ hoppes over, men verdien følger med som `automatisk` og vises i oppsummeringen.
- Frontrute er alltid et valg (går via `/api/frontrute`, ikke CLASS_D), så den vanligste kunden aldri stenges ute.
- Pilotmodus (flagg av, som i prod): samme rutetyper som i dag, hver forespørsel går til manuell kontroll. Ingen synlig UI-fjerning.

### Kundeisen (planens punkt 4–9)
`public/index.html` + `public/app.js`:

- **Forside:** uendret godkjent H1, ny støttetekst («Vi kontrollerer glassvariant, pris og levering før du bestemmer deg.»), hovedknapp «Finn bilen», leverandørrollen nær søket («Vi leverer glasset. Montering avtaler du selv med et verksted.»), tre steg: Finn bilen → Velg glass → Få kontrollert tilbud.
- **Rutetype:** knapper bygges fra bilens data med antall dokumenterte glass. Egen inngang «Jeg finner ikke ruten min / trenger hjelp».
- **Plassering:** ett spørsmål om gangen (ikke rullegardin), valgsti («Dørrute › Venstre side»), Tilbake som nullstiller senere valg, «Vet ikke hvilken side» som ikke filtrerer.
- **Resultat:** «Mulige glass til bilen din», oppsummering av bil + rute øverst, kort med beskrivelse, dokumenterte egenskaper, **forskjeller mot de andre alternativene**, prisstatus, «Velg dette glasset». Maks 6 kort med «Viser 6 av N». Fire tydelige tilstander: ingen treff, flere mulige, manglende opplysninger, teknisk feil.
- **Tilbud:** oppsummering (bil, rute, ønsket glass, hva vi kontrollerer) **før** kontaktfeltene, «Ønsket leveringssted», uforpliktende-tekst, bekreftelse «Forespørselen er mottatt» først når serveren har svart. Knappen skjules etter innsending.
- **Støttesider:** om oss / bilglass uten forsikring / betaling oppdatert til leverandørrollen («ønsket leveringssted», ingen «avtaleverksted»-tjeneste, ingen «partnerverksteder kommer senere»). Cache-versjoner bumpet.

### Stil — Nordisk klarhet (`public/styles.css`)
Lys, rolig bakgrunn (#f5f8f6), mørk tekst (#12211c), grønn hovedfarge (#0e6b4f), rolige kort med diskret ramme, trykkflater ≥44 px (rutetype 62 px, plasseringsvalg 56 px), synlig tastaturfokus (3 px grønn ring), én tydelig hovedhandling per steg. Kun kundeflaten; /ops er urørt.

---

## 2. Hva som er kontrollert (faktisk kjørt)

| Kontroll | Resultat |
|---|---|
| `npx tsc --noEmit` | grønn |
| `npm run qa` (hele suiten) | **509 tester PASS**, exit 0 |
| Ny enhetstest `tests/glass-valg.test.mjs` | 11 tester: kun datastøttede valg, ingen ugyldige kombinasjoner, karosseri bare når det skiller, rattplassering UKJENT → venstre/høyre, alle løv gyldige i `normalizeGlassSelection` |
| Valgtre mot **ekte produksjonskatalog** (`scripts/verify-valgtre.mjs`, 6 biler) | ingen invariantbrudd |
| Lokal Chrome-verifisering (`scripts/verify-nordisk-klarhet.mjs`, 390 px + 1280 px) | **alle kontroller PASS**: ingen horisontal overflyt, ingen trykkflate <44 px, tastatur-Enter velger, oppsummering før kontaktfelt, bekreftelse vises |
| Chrome-test alle seks glasstyper → ekte inquiry-handler (`npm run test:quote-browser`) | PASS |
| **Kundekvittering ende-til-ende (staging → Gmail)** | **PASS 2026-11-03 23:04** — sak #28 mottatt i innboksen, avsender `FinnBilGlass <support@finnbilglass.no>`, emne «Vi har mottatt forespørselen din (#28)» |
| **Staging-E2E** (`scripts/e2e-release-chrome.mjs` mot staging, 2 biler × 2 viewports) | **33 brukerreiser · 0 FEIL · 0 advarsler** |
| Staging-probe `POST /api/glass/valg` med SU18018 | 200, SVV-oppslag, 39 kandidater, datastyrte typer |

Staging-tallene E2E-en faktisk målte:

| Bil | Frontrute | Dørrute | Siderute | Bakrute | Ventil | Tak |
|---|---|---|---|---|---|---|
| VW Transporter 2005 (SU18018) | PASS (resolver, 5 varianter) | PASS 6 kort | PASS 6 kort | PASS 6 kort | ikke tilbudt (ingen data) | ikke tilbudt |
| VW Caddy (testbil 2) | PASS | ikke tilbudt | ikke tilbudt | ikke tilbudt | ikke tilbudt | ikke tilbudt |

«Ikke tilbudt» er verifisert mot `/api/glass/valg` — knappen vises ikke fordi katalogen ikke har dokumenterte rader, og hjelpeinngangen finnes i stedet.

Skjermbilder: `~/.hermes/cache/scratch/fbg-nordisk-klarhet/` (mobil + desktop: forside, rutetyper, steg, resultat, tilbud, bekreftelse) og `…/staging3/` (ekte staging-reiser).

---

## 3. Kjente begrensninger og gjenstående datagap

0. **E-postleveranse:** DKIM er satt opp (`brevo1`/`brevo2._domainkey` → CNAME Brevo) og DMARC står på `p=quarantine`, men **SPF mangler Brevo** (`v=spf1 +ip4:185.126.36.19 +include:_spf.spamprotection.no ~all`). Legg til Brevos SPF-include før bred lansering. `support@finnbilglass.no` har ingen postkasse (MX = loke.domene.no), så svar på kvitteringen forsvinner — sett reply-to/`SUPPORT_FROM_EMAIL` til en adresse som leses.
1. **Pris** for dør/side/bak/ventil/tak vises som «Pris på forespørsel» — katalograder for disse klassene har ingen dokumentert kundepris i svaret. Frontrute viser pris som før.
2. **Karosseri** spørres bare når katalogen faktisk skiller; kroppsvariant (coupé/stasjonsvogn) er fortsatt største gjenværende feilkilde der dataene ikke skiller.
3. **Rattplassering** er ikke dokumentert i noen kilde vi har i dag → alltid «venstre/høyre side». Fører/passasjer aktiveres automatisk når slik data finnes.
4. **«Vet ikke»-siden** gir begge sider videre til kontroll (ingen filtrering) — bevisst.
5. **Caddy** har bare frontrute i katalogen; øvrige ruter gir hjelpetilstand. Det er et kataloggap, ikke en UI-feil, men det bør lukkes med data før bred lansering.
6. **Ingen produksjonssetting, ingen migrasjon, ingen merge** er utført. Prod kjører uendret versjon.

---

## 4. Før produksjonssetting (forslag)

1. Tom godkjenner synlig endring (ny grønn profil, «Finn bilen», nye resultatkort) ut fra skjermbildene.
2. Beslutning om `ALL_GLASS_KANDIDATER_ENABLED` i prod: av = dagens manuelle flyt med samme rutetyper; på = datastyrte valg og kandidatkort.
3. Deretter vanlig governed deploy (`[deploy]`-markør eller dispatch + godkjenning), med smoke-test og rollback-mål klar.
