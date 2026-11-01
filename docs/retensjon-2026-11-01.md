# Retensjonsrapport (dry-run) — FinnBilGlass

**Dato:** 2026-11-01 · **Miljø:** produksjon (`finnbilglass-db`, `ac35018c`)
**Type:** Kartlegging og forslag. **Ingen data er slettet. Ingen sletting skjer uten egen godkjenning.**

## 1. Hva som finnes

### Katalogdata (ingen personopplysninger)

| Tabell | Rader | Innhold |
|---|---:|---|
| `glass_features` | 100 000 | glassattributter |
| `glass_identifiers` | 63 799 | eurokoder/OE-referanser |
| `glass_catalog` | 33 215 | produktkatalog |
| `ground_truth` | 32 307 | verifiserte fitment-rader |
| `glass_master` | 32 091 | hovedkatalog |
| `glass_prisliste` | 29 627 | prisliste |
| `glass_sku_attributes` | 10 527 | vareattributter |
| `vin_ktype_map` | 6 650 | VIN/kType-mapping |
| `glass_reference` | 1 324 | kuratert referansebank |

Ingen av disse inneholder navn, e-post, telefon eller kjøretøyidentitet knyttet til person.

### Persondata

| Tabell | Rader | Personopplysninger | Merknad |
|---|---:|---|---|
| `beta_inquiries` | 34 (28 merket test) | navn, e-post/telefon, regnr, VIN, fritekst | eldste 2026-08-18 |
| `beta_inquiry_events` | 60 | sakslogg, svar-tekst | knyttet til sak |
| `auth_users` | 1 | e-post, navn, `google_sub` | kun CUSTOMER |
| `auth_sessions` | 2 | sesjons-ID, IP-lignende metadata | utløper |
| `oauth_states` | 1 (utløpt) | PKCE-verifier, nonce | kortlevd |
| `oauth_pending_links` | 0 | ventende kontokobling | kortlevd |
| `evidence_case_images` | 18 | R2-nøkkel per bilde | bilder av kjøretøy |
| `evidence_events` | 72 | hash av kjøretøyidentitet | bevisst hashet |
| `voice_sessions` | 11 | sesjonsdata | må gjennomgås |

**R2-bøtte:** kunne ikke listes — API-tokenet mangler R2-rettigheter. Bildereferanser peker på `evidence-capture/FBG-*`. Antall objekter er ukjent og må kartlegges med token som har R2-lesetilgang.

## 2. Vurdering

- **Katalogdata:** ingen retensjonsrisiko. Beholdes.
- **Testsaker (28 av 34):** forurenser statistikk. Bør kunne slettes etter godkjenning.
- **Reelle henvendelser (6):** skal bevares så lenge saken kan bli en ordre.
- **Evidensbilder:** bilder av kundens bil. Bør ha kortere levetid enn selve saken.
- **Logger:** verifisert at Worker-logger ikke lagrer persondata (logging av/på-minne, ingen PII skrevet).

## 3. Anbefalt oppbevaringspolicy (V5.1)

| Datatype | Levetid | Begrunnelse |
|---|---|---|
| Avsluttede tilbud **uten** ordre | **12 måneder** etter siste aktivitet | kunden skal kunne komme tilbake, men vi skal ikke lagre evig |
| Tilhørende bilder (R2) | **90 dager** etter at saken er avsluttet | bilder av kundens bil er det mest sensitive |
| Testsaker (`is_test = 1`) | **90 dager** | kun feilsøkingsverdi |
| Henvendelser som blir **ordre** | 5 år | bokføringsplikt |
| Svar-/hendelseslogg | samme som saken | sporbarhet |
| Sesjoner | utløp + 7 dager | sikkerhet |
| OAuth-tilstander / ventende koblinger | 10 / 15 minutter (aktivt) | engangsbruk |
| Katalogdata | beholdes | ikke personopplysninger |

**Unntak — skal aldri slettes automatisk:**

- saker som ikke er avsluttet (`NEW`, `CONTACTED`, `NEEDS_INFO`, `QUOTED`, `CONFIRMED`)
- saker med åpen tvist eller reklamasjon
- dokumentasjon som er bokføringspliktig
- alt som er flagget for manuell gjennomgang

**Automatisk sletting er deaktivert.** Ingenting slettes før policyen er godkjent og en dry-run er gjennomgått.

## 3b. Referanseintegritet D1 ↔ R2

Før sletting kan vurderes må hver nøkkel i `evidence_case_images.r2_key` finnes i bøtta, og hver fil i `evidence-capture/` må ha en rad. Avvik betyr at sletting vil kunne ødelegge bevis.

Verktøy: `GET /api/ops/r2-inventar` (token-gated, kun lesing) returnerer antall objekter, total størrelse, foreldreløse filer og manglende filer. Ingenting slettes av dette endepunktet.

## 4. Hva som må på plass før sletting kan kjøres

1. Godkjenning av reglene over.
2. En jobb som først **rapporterer** hva som ville blitt slettet (dry-run), med antall per tabell.
3. Deretter en kontrollert kjøring med bekreftelse per tabell.
4. R2-token med lesetilgang, slik at bilder kan telles og slettes sporet.

## 5. Teknisk status

- Daglig vakt (`fbg-ubehandlede-saker.sh`, 08:00) sletter allerede utløpte `oauth_states` og `oauth_pending_links`.
- `auth_sessions` har egne utløpstider og ryddes av auth-laget.
- Ingen automatisk sletting av saker eller bilder er aktivert.
