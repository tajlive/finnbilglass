# FinnBilGlass – gjennomgått produksjonsmigrasjon for første manuelle salg

**Status:** Produksjonsgjennomgått *SQL-kandidat*. SQL-definisjonene er de samme som staging-forslag 0040, 0041 og 0044, men disse er egne eksplisitte produksjonsartefakter. Godkjent for **kontrollert manuell anvendelse** først etter punktene nedenfor og verifisert database. Filene er aldri del av automatiske migrasjoner ved deploy.

**Hvorfor:** Det opprinnelige 0044-skriptet er merket STAGING PROPOSAL ONLY, og skal ikke anvendes i produksjon. Bruk kun de tre filene i denne mappen for manuell førstesalgsflyt. Endre ikke staging-forslagene eller historisk ops_offers-tabell.

## Eksakt mål og kildekontroll

- Cloudflare account: 80d5b1d56a3e907150ba7348b6182894
- Prod database: finnbilglass-db, D1 UUID ac35018c-0d43-4742-adf8-d881b7274684. **ALDRI** staging UUID 78842e17-ab0b-47c1-acde-244044073466.
- Kjente read-only prod-bevis 12.11.2026: 88 tabeller, ingen av de fem nye OPS-tabellene, d1_migrations stopper på 0038, legacy ops_offers=0, beta_inquiries=19, beta_inquiry_events=28. Fremtidig kjøring må re-verifisere fordi tilstanden kan endres.
- Kildesett: migrations/proposed/{0040_ops_manual_offer_order,0041_ops_staff_invites_activity,0044_ops_offer_outbox}.sql.proposed. CI-test sjekker SQL-ekvivalens etter fjerning av kommentarer og faktisk DDL/fremmednøkler mot syntetisk historikk.

## Eneste tillatte manuelle rekkefølge

1. I Cloudflare dashboard eller godkjent Wrangler økt: bekreft eksakt prod-konto, D1 UUID og read-only schema (sqlite_master og PRAGMA table_info). Kontroller at mål-tabellene og tilhørende indeks/triggere ikke finnes fra før. Hvis *en del* finnes, STOPP og sammenlign skjema – CREATE IF NOT EXISTS er IKKE bevis på kompatibilitet.
2. Dokumenter gyldig D1 Time Travel-bokmerke og kontrollert gjenopprettingsprosedyre **før skriving**. Bevar et privat, tidskonsistent før-snapshot og historiske radtall; ved behov bruk privat offline legacy guard, aldri GitHub artifacts med kundedata. Ikke test Time Travel restore mot prod.
3. Kjør bare **0040_ops_manual_offer_order.sql** (skaper ops_manual_offers + ops_manual_orders; refererer eksisterende beta_inquiries). Kontrollér tabeller, fire triggere, databevaring og PRAGMA foreign_key_check.
4. Kjør bare **0041_ops_staff_invites_activity.sql** (skaper ops_staff_memberships + ops_staff_activity) etter 0040. Kontrollér tabeller, indekser, append-only audit-triggere og PRAGMA foreign_key_check.
5. Kjør bare **0044_ops_offer_outbox.sql** (skaper ops_offer_outbox, index og immutable payload-trigger) etter 0040/0041. Kontrollér request_id UNIQUE, offer_id FK, status CHECK, index og trigger samt PRAGMA foreign_key_check.
6. Les historiske rader/status og radtall etterpå og sammenlign med før-snapshot. Ingen gamle rader skal endres eller slettes. Ikke merge/migre annen Gmail-/reply-funksjon bare fordi filen finnes.
7. Etter tabeller, og etter verifisering av **produksjons** Cloudflare Access-app/policy/AUD: bootstrap nøyaktig én godkjent ADMIN som INVITED ved kontrollert operatørhandling, og la første signerte Access-login sette ACTIVE og journalføre LOGIN. Ingen vid Allow eller automatisk publisert admin-secret.
8. Bekreft korrekt prod Worker-D1 binding, Resend secret tilstedeværelse, rollback-kompatibilitet og avklar den separate finnbilglass-ops-repair-ruten. Deretter kan draft PR #82 vurderes for merge og manuell production-GO på pin'et SHA, med GitHub environment-godkjenning. Gmail-synk og automatisk betaling forblir AV.

**Stopp** ved manglende bookmark, feil database, eksisterende inkompatibelt schema, fremmednøkkelavvik, endret legacy-data, ukjent Access AUD eller rutekonflikt. Ingen blind restore av prod-databasen ved kode-rollback.

**Suksesskriterium for dette settet:** De tre nye, gjennomgåtte SQL-filene er tilgjengelige på en verifisert SHA og CI-testede. Det er **ikke** bevis på at D1-migrasjoner er utført i Cloudflare. Første produksjonssalg er fortsatt NO-GO før runtime-verifisering.
