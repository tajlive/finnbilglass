# «Meld deg av» på mottakskvitteringen — historikk (løst)

> **Oppdatering 2026-11-04:** Brevo-kontoen er slettet. All e-post går nå gjennom Resend
> (`src/mail.ts`): kvittering, engangskoder, pristilbud, manuelle svar fra /ops og interne varsler.
> `BREVO_API_KEY`, `/api/ops/brevo-check` og Brevo-fallbacken er fjernet. Dokumentet under er
> historikken som forklarer hvorfor Resend ble valgt.

> **Gjeldende status 2026-11-04:** Brevo-kontoen er slettet og all e-post går via Resend
> (`src/mail.ts`). `SUPPORT_EPOST` = `support@finnbilglass.no` er satt i staging og produksjon, og
> produksjonskvittering (sak #40) er verifisert med `Reply-To: support@finnbilglass.no` og uten
> `List-Unsubscribe`. Resend-webhooks er **ikke** satt opp, og nøkkelen som ble delt i chat er
> **ikke** rotert. Alt nedenfor er historikk — ikke dagens konfigurasjon.

**Dato:** 2026-11-03 · **Status:** Resend er aktiv i produksjon; nøkkelrotasjon gjenstår

## Fakta

| Kilde | Funn |
|---|---|
| [Brevo FAQ om List-Unsubscribe og List-Help](https://help.brevo.com/hc/en-us/articles/19100260472850-FAQs-About-list-unsubscribe-and-list-help-headers-in-emails) | Brevo sier at de automatisk legger til `List-Unsubscribe` på kampanjer og transaksjonelle e-poster. |
| Samme FAQ | Erstatning med `List-Help` er bare tilgjengelig på Enterprise, for mottakerutløst transaksjonspost uten reklame, og må bestilles fra Brevo Support. |
| [Brevo API for transaksjonell e-post](https://developers.brevo.com/reference/send-transac-email) | `headers` støtter egendefinerte ikke-standard headere; API-et dokumenterer ingen bryter for å fjerne Brevos `List-Unsubscribe`. |
| Brevo-community (2023→) | «each transactional mail has a List-Unsubscribe header added automatically. We have no documented way to control this behavior». Brevo svarte at de «studerer» fleksibilitet — ingen bryter kommet. |
| Gmail hos mottaker | Viser «Meld deg av» på kvitteringen vår = headeren er der i praksis. |

**Konsekvens:** en mottakskvittering kan ikke bli kvitt «Meld deg av» fra vår kode. Den eneste veggen vi kontrollerer er (a) Brevo-support, eller (b) annen leverandør.

## Ende-til-ende kontroll i staging

3. november 2026 sendte `scripts/epost-hoder-test.mjs` en tydelig testmerket henvendelse til staging. Den opprettet sak **#32** og hentet rå e-postkilde fra midlertidig testpostkasse.

- `List-Unsubscribe`: **FINNES** — Brevo legger den fortsatt til, så «Meld deg av» kan fortsatt vises i Gmail.
- `List-Help`: **FINNES** — vår egendefinerte hjelpeheader kom med.
- `Reply-To`: **tomarnejensen@gmail.com** — kvitteringssvar går til den konfigurerte overvåkede adressen, ikke til den ubemannede `support@`-postkassen.
- Kvitteringen ble levert med emne og innhold som forventet.

Dette skiller faktisk e-postlevering og MIME-headerbevis fra et API-kall med HTTP 201. Den testhenvendelsen er merket som test (`ZZ00000`) i staging.

## Det som ER gjort i koden (vår side)

- `replyTo` settes til `SUPPORT_NOTIFY_EMAIL` (fallback `SUPPORT_FROM_EMAIL`) — svar på kvitteringen havner hos noen som leser dem. `support@finnbilglass.no` har ingen postkasse (MX = `loke.domene.no`).
- `List-Help: <https://finnbilglass.no/om-oss>` sendes som custom header. Brevo kan ignorere den; den skader ikke, og gir en hjelpe-URL i de klientene som bruker den.
- Kvitteringsteksten er skrevet om (kortere, riktig merkenavn, sak-nummer, kjøretøy, eksplisitt «ikke en ordrebekreftelse»).
- Verktøy: `node scripts/epost-hoder-test.mjs` oppretter en midlertidig postkasse, sender en reell henvendelse på staging og skriver ut `List-Unsubscribe`, `List-Help` og `Reply-To` fra rå MIME.

## Brevo-support: ferdig tekst (sendes fra kontoen)

Emne: **Switch transactional emails to List-Help header instead of List-Unsubscribe**

> Hello,
>
> We send customer-triggered transactional emails (submission receipts for quote requests) from support@finnbilglass.no through the Brevo transactional API.
>
> These emails contain no promotional content. They confirm receipt of a customer's request and are sent only because the customer submitted a form.
>
> Recipients currently see an unsubscribe option («Meld deg av» in Gmail) because Brevo adds a List-Unsubscribe header to all transactional emails. Unsubscribing from a receipt a customer explicitly requested makes no sense and risks blocking the confirmation they need.
>
> Per your help article «FAQs - About list-unsubscribe and list-help headers in emails», please switch our transactional emails to a **List-Help** header instead of List-Unsubscribe, as described for recipient-triggered transactional emails without promotional content.
>
> Account: (din Brevo-konto) · Sender domain: finnbilglass.no · Sender: support@finnbilglass.no
>
> Best regards,
> Tom Arne Jensen, Finnbilglass

## Verifisering etter endringen

```bash
node scripts/epost-hoder-test.mjs            # staging
# Forventet etter at Brevo har bekreftet endringen: List-Unsubscribe: finnes ikke · List-Help: FINNES
```

## Løsning: Resend (2026-11-03)

Brevo kan ikke fjerne headeren, så kvitteringen sendes nå via **Resend** — som ikke legger på
`List-Unsubscribe` på transaksjonspost. Brevo er beholdt som fallback, slik at kunden alltid får
kvittering selv om Resend avviser (f.eks. før domenet er verifisert).

**DNS lagt inn i Cloudflare (egen `send`-subdomene, rører ikke nettstedets SPF/MX):**

| Type | Navn | Verdi |
|---|---|---|
| TXT | `resend._domainkey` | DKIM `p=MIGf…` (Resend) |
| MX (prio 10) | `send` | `feedback-smtp.eu-west-1.amazonses.com` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| CNAME | `rsend` | `send.forge.rmta.net` |

**Status:** Alle fire poster er synlige i offentlig DNS. Resend rapporterte domenet som `verified`
etter DKIM-kontrollen.

**Transport i koden** (`sendCustomerInquiryReceipt`):

1. `RESEND_API_KEY` finnes → `POST https://api.resend.com/emails` (Reply-To = `SUPPORT_NOTIFY_EMAIL`).
2. Feiler Resend (f.eks. uverifisert domene) → fallback til Brevo med samme innhold og Reply-To.
3. Begge feiler → feilen logges, men henvendelsen er allerede lagret (best-effort).

**Produksjon:** `RESEND_API_KEY` er satt på Worker-en. Cloudflare-versjon `fad70fce` er live;
helsekontroll og `/api/glass/valg` svarer 200. Kontrollert produksjonstest opprettet sak #38; den
foregående kjørerapporten registrerte kvitteringen som sendt via Resend.

**Kvitteringsbevis:** den kontrollerte Resend-testen leverte til Gmail-innboksen, uten
`List-Unsubscribe`, med `Reply-To: svar@finnbilglass.no` og Resend-DKIM. Staging-testen før
leverandørbyttet viste derimot at Brevo la til `List-Unsubscribe`, selv om `List-Help` også var med.

## Anbefalinger for Resend

1. Roter API-nøkkelen som ble delt i chatten. Behandle den som kompromittert.
2. Lag en egen nøkkel med `sending_access`, avgrenset til `finnbilglass.no`, og lagre den i
   Bitwarden Secrets Manager som `RESEND_API_KEY`. Resend støtter begrensede rettigheter og
   domenebegrensning ([offisiell dokumentasjon](https://resend.com/changelog/new-api-key-permissions)).
3. Oppdater Cloudflare Worker secrets i både staging og produksjon med den nye verdien, send en
   kontrollert test, og tilbakekall deretter den gamle nøkkelen.
4. Behold Brevo-fallbacken mens rotasjonen gjennomføres. Når Resend sender normalt, kvitteringen
   går ut uten avmeldingsheader; hvis Resend feiler og fallbacken aktiveres, kan Brevo fortsatt
   legge på `List-Unsubscribe`.

Nøkkelverdien skal aldri legges i Git, issue, PR-beskrivelse eller chat. Bitwarden CLI var ikke
autentisert ved siste forsøk, så rotasjon må bruke en sikker, autentisert hemmelighetskilde.
