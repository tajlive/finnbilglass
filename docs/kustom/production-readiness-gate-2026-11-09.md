# FinnBilGlass / Kustom – produksjonsporter (9. november 2026)

**Omfang:** Kustom-betalingslenker som opprettes manuelt i Operations Center og sendes til kunden. Ingen automatisk salgsløype. Betalingslogoer på forsiden er markedsinformasjon, **ikke bevis for aktiv FinnBilGlass-integrasjon**.

**Beslutning:** **NO-GO for aktivering av ny automatisk Kustom-integrasjon.** Eksisterende nettsted og manuelt tilbudsarbeid omfattes ikke av dette NO-GO. Ingen betalinger, capture/refund, D1-migrasjoner eller produksjonsdeploy utført under denne gjennomgangen.

## Det som er verifisert

| Bevis | Resultat | Kilde / avgrensning |
|---|---|---|
| Kustom KYC | OK, oppgitt av prosjekteier 09.11 | Ikke kontrollert mot Kustom API/Portal i dette arbeidet |
| Vipps-produksjonstest | Lyktes, oppgitt av prosjekteier 09.11 | Bekrefter kundebetaling hos Kustom i produksjon, **ikke** denne PR-ens callback/ledger |
| P0: CANCELLED klassifisert som AUTHORIZED | Feil reprodusert og rettet | PR #45; 651 pass, 0 feil, 7 skip |
| P0: dupliserte status-callbacks | SQLite-regresjon og retting | PR #46; 657 pass, 0 feil, 7 skip |
| Tapt callback: provider-GET-basert avstemming | Ny modul, ikke automatisk i prod | PR #44; 649 pass, 0 feil, 7 skip |
| Staging-cron + rettferdig utvalg | Kun staging; flagg er **false** | PR #47; 662 pass, 0 feil, 7 skip; migrasjon 0061 **ikke anvendt** |
| Callback + polling: én audit-hendelse | Feil reprodusert (2 events) og rettet | PR #48; 663 pass, 0 feil, 7 skip |
| Oppdatert samlet Kustom-gren | PR #29 integrerer #44–#48, beholdt som draft | Krever ny QA på HEAD etter dokumentasjonsoppdatering |
| Prod Worker / D1-tilstand | Ikke bekreftet | Ingen production write eller nye pengeoperasjoner her |

## Viktig gren- og releaseavvik

`main` per 09.11 er `c6e219f3`. GitHub sammenligning **main → release/fbg-kustom-staging-20261108** er **diverged**, rundt **215 commits foran / 7 bak** med merge-base `73f78712`. PR #29 er draft mot `copy/kvittering-20261103`, **ikke** `main`. En grønn CI her gir ikke GO for merge til `main` eller produksjonsdeploy.

**Verifisert av GitHub-tre-sammenligning:** Dagens `main` har ikke `src/auth-storage.ts`, `src/auth.ts`, `src/routes/admin.ts`, `src/routes/kustom-ops.ts` eller `src/payments/kustom-core.ts` i det hele tatt. Disse må derfor integreres sammen med korrekte avhengigheter og migrasjonsplan før en produksjonsbuild kan bli grønn.

**Krav:** Opprett kontrollert kandidat fra fersk `main`, integrer bare nødvendige, reviderte Kustom-/Operations Center-endringer og avhengigheter. Bevar alle nyere personvern-/Gitleaks-rettinger fra `main`. Unngå å slå sammen den store PR #29 direkte; dokumenter diff, migrasjonsrekkefølge og feature flags. Test ny SHA i CI og staging.

## Må oppfylles før Kustom-integrasjon kan aktiveres

1. **Miljø og transaksjon:** Verifiser produksjons-MID, riktig merchant-konto, produksjons-Checkout API og HPP-origin med Kustom, uten å dele credentials. Bruk eksisterende Vipps-transaksjon read-only: leverandørens ordre-ID, autorisert/captured-beløp, valuta og status sammenlignes med rett internt tilbud og sak.
2. **Databaseskjema:** Kartlegg faktisk staging/prod D1-tabellstruktur og migrasjonsledger (ikke anta at `pending/` er kjørt). Ta bekreftet backup og demonstrer staging restore **før** migrasjoner 0059, 0060, 0061 eventuelt anvendes. Hver migrasjon kjøres separat med read-back og rollback-plan.
3. **Ops/E2E:** Logg inn via riktig Cloudflare Access policy og verifiser manuelt opprettet betalingslenke, kundens åpning av HPP, ordrestatuser `ACCEPTED → PAYMENT_LINK_SENT → AUTHORIZED → PAID`, og synlig historikk på riktig sak. `AUTHORIZED` **må ikke** vises som betalt.
4. **Callback og avstemming:** Test autentisering/token, feil beløp/ordre-ID/MID, replay, concurrent callbacks, leverandør-GET-feil og crash/retry. Status-lagring og event må være transaksjonell. Dokumenter at aldri mer enn én ordre/capture/refund utføres ved retry; kun staging-syntetiske tilfeller for aktive tester.
5. **Scheduler:** Før aktivering må staging-tabellen `kustom_reconcile_attempts` være opprettet. Høyst fem kandidater per sveip, 15 minutters cooldown, kun GET mot Kustom. Staging-konfig `KUSTOM_RECONCILIATION_ENABLED=false` inntil kontrollert test. Ikke opprett prod-trigger automatisk.
6. **Sikkerhet/observability:** Kustom-secrets i Cloudflare Secret Store, ingen access-tokens i logger, minimum rettigheter, varsling ved stadig flere `ERROR`/`REVIEW_REQUIRED`, gitleaks grønn, multi-role Access test og konkret rollback-versjon.
7. **Refusjon/avstemming:** Ingen live refusjon nødvendig for denne testen. Dokumenter separat manuell refusjonsprosess, provider-status og intern ledger før eventuell refundfunksjon aktiveres.

## Policy i mellomtiden

- Fortsett med **manuelt tilbud, manuell betalingslenke og manuell bekreftelse** i Operations Center der dette er verifisert.
- Ikke start reelle capture/refund/transaksjoner for å gjøre tester grønne.
- Ikke sett `KUSTOM_PRODUCTION_APPROVED`, `KUSTOM_MONEY_MOVEMENTS_ENABLED` eller reconciliation-flagg i prod før eksplisitt GO.
- Ikke påstå at Vipps-transaksjonen er automatisk avstemt til FinnBilGlass før konkret read-only transaksjonsbevis i D1/Ops finnes.
- Ved providerstatus `CANCELLED`, `EXPIRED`, `PART_CAPTURED` eller uventet beløp: manuell behandling, aldri automatisk `PAID`.

**Eier:** CTO/arkitekt, FinnBilGlass. **Neste leveranse:** rent releasegrunnlag fra ny `main`, verifisert staging-schema og read-only transaksjonsavstemming; deretter avgrenset GO/NO-GO.