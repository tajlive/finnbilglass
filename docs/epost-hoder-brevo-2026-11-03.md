# «Meld deg av» på mottakskvitteringen — hva som kan fikses, og hvordan

**Dato:** 2026-11-03 · **Status:** vår side er verifisert i staging; fjerning av «Meld deg av» krever endring hos Brevo

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
