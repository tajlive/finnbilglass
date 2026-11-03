# «Meld deg av» på mottakskvitteringen — hva som kan fikses, og hvordan

**Dato:** 2026-11-03 · **Status:** ikke fikset i kode — krever Brevo-support (eller leverandørbytte)

## Fakta

| Kilde | Funn |
|---|---|
| Brevo FAQ «About list-unsubscribe and list-help headers» | «Yes, Brevo **automatically includes a list-unsubscribe header** in your email campaigns and transactional emails.» |
| Samme FAQ | List-Help i stedet for List-Unsubscribe er mulig for **mottakerutløst transaksjonspost** (aktivering, ordrebekreftelse, passordreset) uten promotering — men **bare ved å kontakte Brevo support**. |
| Brevo API | Ingen parameter for å slå av headeren. `POST /v3/smtp/email` tar `headers`, men Brevo legger sin egen `List-Unsubscribe` i tillegg. |
| Brevo-community (2023→) | «each transactional mail has a List-Unsubscribe header added automatically. We have no documented way to control this behavior». Brevo svarte at de «studerer» fleksibilitet — ingen bryter kommet. |
| Gmail hos mottaker | Viser «Meld deg av» på kvitteringen vår = headeren er der i praksis. |

**Konsekvens:** en mottakskvittering kan ikke bli kvitt «Meld deg av» fra vår kode. Den eneste veggen vi kontrollerer er (a) Brevo-support, eller (b) annen leverandør.

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

## Alternativ: annen leverandør

Resend/SES/Postmark legger ikke på List-Unsubscribe på ren transaksjonspost. Det krever gyldig API-nøkkel og verifisert avsenderdomene (DNS-poster). Per 2026-11-03 er begge Resend-nøklene vi har tilgang til **ugyldige** (`API key is invalid`), så et bytte kan ikke gjøres før en ny nøkkel finnes.

## Verifisering etter endringen

```bash
node scripts/epost-hoder-test.mjs            # staging
# Forventet etter Brevo-endring:  List-Unsubscribe: finnes ikke · List-Help: FINNES
```
