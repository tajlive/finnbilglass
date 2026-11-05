# Nordisk klarhet — gjennomgang før produksjonssetting

**Dato:** 2026-11-03, oppdatert 2026-11-04 · **Branch:** `feat/nordisk-klarhet-20261103` (PR #27 åpen)
**Miljø verifisert:** staging og produksjon. Produksjon kjører Cloudflare-versjon `709e81f8` fra commit `973309f`
(staging: `6f6d548c`). All e-post går via Resend; Brevo er fjernet (se «E-post» under).

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
| `npm run qa` (hele suiten) | **512 tester PASS**, exit 0 |
| Ny enhetstest `tests/glass-valg.test.mjs` | 11 tester: kun datastøttede valg, ingen ugyldige kombinasjoner, karosseri bare når det skiller, rattplassering UKJENT → venstre/høyre, alle løv gyldige i `normalizeGlassSelection` |
| Valgtre mot **ekte produksjonskatalog** (`scripts/verify-valgtre.mjs`, 6 biler) | ingen invariantbrudd |
| Lokal Chrome-verifisering (`scripts/verify-nordisk-klarhet.mjs`, 390 px + 1280 px) | **alle kontroller PASS**: ingen horisontal overflyt, ingen trykkflate <44 px, tastatur-Enter velger, oppsummering før kontaktfelt, bekreftelse vises |
| Chrome-test alle seks glasstyper → ekte inquiry-handler (`npm run test:quote-browser`) | PASS |
| **Kundekvittering ende-til-ende** | **PASS** — staging 2026-11-03 (sak #28 i Gmail-innboks) og **produksjon 2026-11-04 (sak #40)**: `From: Finnbilglass <support@finnbilglass.no>`, `Reply-To: support@finnbilglass.no`, `Return-Path: …@send.finnbilglass.no`, **ingen `List-Unsubscribe`**, «Dette har vi mottatt» med bil/glass/leveringssted |
| **Staging-E2E** (`scripts/e2e-release-chrome.mjs` mot staging, 2 biler × 2 viewports) | **36 brukerreiser · 0 FEIL · 0 advarsler** |
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

0. **E-post:** Alt går via **Resend** (`src/mail.ts`): kvittering, engangskoder, pristilbud, svar fra /ops og interne varsler. Domenet `finnbilglass.no` er verifisert (DKIM + `send`-subdomene). `SUPPORT_EPOST` = `support@finnbilglass.no` styrer Reply-To, bunntekst og manuelle svar — adressen er bekreftet som riktig kundeadresse. **Brevo-kontoen er slettet**, `BREVO_API_KEY`, Brevo-fallbacken og `/api/ops/brevo-check` er fjernet. Historikken ligger i [epost-hoder-brevo-2026-11-03.md](epost-hoder-brevo-2026-11-03.md) og skal ikke leses som gjeldende status.
1. **Pris** for dør/side/bak/ventil/tak vises som «Pris på forespørsel» — katalograder for disse klassene har ingen dokumentert kundepris i svaret. Frontrute viser pris som før.
2. **Karosseri** spørres bare når katalogen faktisk skiller; kroppsvariant (coupé/stasjonsvogn) er fortsatt største gjenværende feilkilde der dataene ikke skiller.
3. **Rattplassering** er ikke dokumentert i noen kilde vi har i dag → alltid «venstre/høyre side». Fører/passasjer aktiveres automatisk når slik data finnes.
4. **«Vet ikke»-siden** gir begge sider videre til kontroll (ingen filtrering) — bevisst.
5. **Caddy** har bare frontrute i katalogen; øvrige ruter gir hjelpetilstand. Det er et kataloggap, ikke en UI-feil, men det bør lukkes med data før bred lansering.
6. **Produksjon:** versjon `709e81f8` er live (commit `973309f`). Kontrollert 2026-11-04: `/health` 200 (29 627 katalog­rader), forside 200, `/api/glass/valg` 200, `/api/frontrute` VERIFY med 5 kandidater, `/min-side` 302, `/ops` 302, OTP-utsending `{ok:true}` uten kode i svaret. PR #27 er ikke flettet — prod kjører kode fra den lokale grenen.

---

## 4. Etter produksjonssetting

1. **Resend-webhooks** for `delivered`/`delayed`/`bounced`/`suppressed` er ikke satt opp. Uten dem oppdages avviste kvitteringer bare i Worker-loggen. Krever endepunkt + webhook-hemmelighet.
2. **Nøkkelrotasjon:** Resend-nøkkelen som ble delt i chat 2026-11-03 er per 2026-11-04 **ikke** rotert. Anbefales erstattet av en `sending_access`-nøkkel avgrenset til `finnbilglass.no`, lagt i BWS og satt som Worker-secret i staging og produksjon.
3. **PR #27** bør gjennom review og merges, slik at koden som kjører i prod er sporbar i Git (i dag ligger den bare på en lokal gren).
4. **`support@finnbilglass.no`** er satt som svaradresse overalt, men mottak er **ikke bekreftet** (målt 2026-11-04, se under).
5. **Databasesporet `brevo_melding_id`** blir stående: feltet ligger i en allerede kjørt struktur og brukes ikke av aktiv kode. Å fjerne det ville krevd en migrasjon uten funksjonell gevinst.

---

## 5. Postkasse-kontroll for `support@finnbilglass.no` (2026-11-04)

| Måling | Resultat |
|---|---|
| Resend-utsending til `support@finnbilglass.no` | `last_event: delivered` etter 50 s |
| **Kontroll:** samme utsending til en oppdiktet adresse (`finnesikke-9f3k2x@…`) | også `delivered` |
| Autoritativ MX (`dig @haley/@zac.ns.cloudflare.com`) | `0 loke.domene.no` |
| `mail.finnbilglass.no` | CNAME `loke.domene.no` → `185.126.36.19` (Domeneshop) |
| Cloudflare Email Routing | ikke aktiv — MX peker ikke til `route1-3.mx.cloudflare.net`; API-tokenet mangler `Email Routing`-rettighet (auth error) |
| SMTP RCPT-test mot `loke.domene.no:25` | ingen forbindelse fra denne maskinen (port 25 ut) |

**Konklusjon:** leveringsstatus beviser ingenting her. Mottakende gateway (`loke.domene.no`) godtar
**alle** adresser på domenet, så «delivered» gjelder også en adresse som ikke finnes. Om post til
`support@` ender i en lesbar postkasse eller videresending kan bare bekreftes av en som ser
postkassen, eller ved å gjøre ruten deterministisk.

**Anbefalt løsning (Toms foretrukne mønster):** gjenopprett Cloudflare Email Routing for
`finnbilglass.no` — MX til `route1-3.mx.cloudflare.net`, `PUT /email/routing/rules/catch_all` →
`tomarnejensen@gmail.com`. Dette ble satt opp og ende-til-ende-verifisert 2026-08-17 (RCPT 250 +
Resend `delivered`), men MX peker i dag til Domeneshop igjen. Krever `Zone → DNS → Edit` på
API-tokenet (eller manuell innlegging av MX-postene).

**Teknisk presisering:** personvernerklæringen sier at `support@` videresendes til
`post@finnbilglass.no`. Den påstanden er ikke verifisert i denne kontrollen og bør stå til den er
bekreftet eller erstattet av CF Email Routing.
