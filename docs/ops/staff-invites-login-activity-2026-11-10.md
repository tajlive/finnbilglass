# Operations Centre: enkel invitasjon, innlogging og aktivitetslogg

**Beslutning 10. november 2026:** Ansatte skal bruke én innlogging med Google eller e-post-engangskode via Cloudflare Access. Ingen ekstra OPS-passord, manuelle brukerlistinger i Worker-variabler eller ekstra OTP-løype i appen.

## Ansattens opplevelse

1. Administrator åpner **Ansatte og aktivitet** i Operations Centre og skriver ansattens e-post + rolle.
2. OPS lagrer invitasjonen. Hvis Brevo er konfigurert, sendes en kort e-post med lenken. Hvis ikke, vises en lenke administrator kan dele.
3. Den inviterte åpner lenken på **OPS-domenet som allerede er beskyttet av Cloudflare Access**, og logger inn med Google eller engangskode etter sitt normale Access-oppsett.
4. OPS kontrollerer signert Access-identitet og at samme e-post har en gyldig invitasjon. Invitasjonen blir **ACTIVE** automatisk ved første pålogging.
5. Den ansatte kommer inn i Operations Centre med tildelt rolle. Administrator kan se ansatte, status, siste innlogging, aktivitet og deaktivere brukere. Deaktiverte brukere mister apptilgang selv om Access-sesjonen fortsatt finnes.

Rettigheter:
- **ADMIN:** ansatte, invitasjon, deaktivering og aktivitetslogg; øvrig OPS-administrasjon.
- **OPERATOR:** saksbehandling/tilbud, men ikke endre invitasjoner.
- **REVIEWER:** lesetilgang til dagens OPS-oversikt. Endringer krever OPERATOR eller ADMIN.

## Hva logges

Foreslått migrasjon `migrations/proposed/0041_ops_staff_invites_activity.sql.proposed` har `ops_staff_memberships` og `ops_staff_activity`. Loggen viser tidspunkt, aktør, handling og saks-/ansattreferanse. Første registrerte forespørsel med en ny signert Access-JWT føres som `LOGIN`. Loggen lagrer **ikke** passord, engangskoder, rå JWT, IP eller e-postinnhold. Dagens sakshistorikk dokumenterer allerede notater, statusendringer og kundesvar, mens ordre-/tilbudsloggen skal kobles til medarbeiderens identitet når ordre-API-et aktiveres.

Aktivitetsloggen er append-only for vanlige applikasjonsruter. **Før produksjon må rutiner for ansattes innsyn, oppbevaringstid og kontrollert sletting være dokumentert**, slik at vi ikke lagrer personopplysninger på ubestemt tid.

## Éngangsoppsett i Cloudflare (ingen konfigurasjon per ansatt)

- Verifiser at dedikert `ops-staging.finnbilglass.no` / `ops.finnbilglass.no` har Cloudflare Access med Google og/eller e-post engangskode, og at **inviterte personer kan gjennomføre identitetskontrollen**. Appens D1-invitasjon er den endelige tillatelsen. Ikke fjern Access helt.
- Sett `OPS_ACCESS_TEAM_DOMAIN` og `OPS_ACCESS_AUD` **en gang** for riktig Access-app. Disse er identitetskonfigurasjon, ikke nye passord for hver ansatt.
- Opprett den første ADMIN-medarbeideren i staging-D1 med en kontrollert, dokumentert seed etter at migrasjon 0041 er gjennomgått. Dette er nødvendig for at ingen ukjent person skal kunne opprette seg selv som administrator.
- Kontroller faktisk D1-binding for OPS. **Denne grenens** `FINNBILGLASS_DB` må ha begge tabellene; ikke forveksle med `finnbilglass-staging-auth` i en eldre releasegren.
- `OPS_STAFF_PORTAL_ENABLED` har **ingen verdi satt** og er dermed avslått som standard. Sett til `true` **bare i staging først**, etter godkjent D1-migrasjon, Access-konfigurasjon og bootstrap-ADMIN.
- Hvis `BREVO_API_KEY`/avsender er konfigurert, kan invitasjonslenker sendes automatisk på e-post. Ellers viser panelet en kopierbar lenke; systemet hevder ikke at e-post er sendt.

## Sikkerhet uten ekstra innloggingssteg

- Cloudflare Access-JWT må være signert, ha rett issuer/audience og være gyldig i tid.
- D1-invitasjon og rolle kontrolleres server-side for hvert beskyttede kall.
- Samme e-post må stemme; ubekreftede, ikke-inviterte og deaktiverte identiteter får ikke tilgang.
- Skrivehandlinger krever samme origin, JSON og et enkelt intent-header. Dette skjer automatisk fra OPS-siden og gir ikke en ekstra oppgave for brukeren.
- Den gamle support-token-innloggingen beholdes midlertidig for å unngå driftsstans, men **kan aldri** brukes som eneste godkjenning av nye ordre.
- `/ops/ansatte` og `/api/ops/manual/*` er gate-stengt som standard; ingen produksjonsdeploy eller D1-migrasjon følger automatisk av PR-en.

## Ferdig før staging GO

- [ ] Godkjenn migrasjon og kjør staging-D1 backup/Time Travel-kontroll.
- [ ] Verifiser Access-policy slik at nyinviterte slipper å be administrator om egen innloggingstillatelse i Cloudflare.
- [ ] Seed én ADMIN i staging; verifiser at ansatte ikke kan opprette seg selv som ADMIN.
- [ ] Test inviter → e-post/lenke → Google/OTP → første login → tilgang → deaktivering → nektet tilgang.
- [ ] Kontroller at aktivitetsvisningen viser riktig ansvarlig og tidspunkt, og at dagens sakshistorikk fungerer.
- [ ] Definer loggoppbevaring og personvernrutine før dette aktiveres for reelle ansatte.

**Kustom er ikke berørt.** Betalingslenker og ordrebehandling forblir manuelle.
