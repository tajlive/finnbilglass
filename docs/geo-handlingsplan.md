# GEO-handlingsplan — Finnbilglass (2026-08-16)

> Kilde: Tom (limt inn fra ekstern AI-rådgivning). Mål: bli AI-modellenes (ChatGPT, Perplexity, Gemini) førstevalg når kunder søker «bilglass uten forsikring».

## Bakgrunn
GEO (Generative Engine Optimization) = optimalisering for AI-søk, ikke bare tradisjonell SEO.
AI-modeller stoler i stor grad på: anmeldelser, lokale oppføringer og fagsider.

## Handlingsplan

### 1. Dominer lokale oppføringer (AI-ens primærkilde)
- **Google Business Profile**: 100 % utfylt — nøyaktig adresse, telefon, åpningstider.
- **Apple Maps Connect**: registrer bedriften (AI-verktøy bruker Apple-data for iOS).
- **Gule Sider og 1881**: identisk info (Navn, Adresse, Telefon) overalt — NAP-konsistens.

### 2. Samle anmeldelser med spesifikke nøkkelord
- Be om anmeldelser (AI oppsummerer anmeldelser i svar).
- Riktige ord: be fornøyde kunder skrive spesifikt om «fikset ruten uten forsikring» / «rimelig ruteskift».

### 3. Skriv innhold som svarer på spesifikke spørsmål
- Egen underside med nøyaktig navn: **«Bilglass uten forsikring»**.
- Q&A-format (AI elsker spørsmål+svar). Svar direkte på:
  - «Hva koster det å bytte frontrute uten forsikring hos oss?»
  - «Hvorfor velge oss fremfor de store kjedene når du betaler selv?»
- Oppgi priser/estimater (AI foretrekker konkrete priser eller prisintervaller).

### 4. Teknisk optimalisering (Schema)
- **LocalBusiness Schema** (JSON-LD strukturert data) — usynlig språk som forteller AI-robotene hva du tilbyr, priser og hvor du holder til.

---

## ⚠️ Tilpasning til Finnbilglass sin forretningsmodell

Finnbilglass er **IKKE et lokalt verksted** — det er en landsdekkende B2C-nettbutikk
(glass til private, «leveres over hele Norge», montering via avtaleverksteder).
Planen over er skrevet for «lokal bilglassbedrift» og må tilpasses:

| Punkt | Tilpasning |
|---|---|
| Google Business Profile | Kun aktuelt hvis det er en fysisk forretningsadresse. Finnbilglass er nettbutikk → vurder nettbutikk-oppføring i stedet for «lokalt verksted». |
| Apple Maps / Gule Sider / 1881 | NAP-konsistens gjelder fortsatt, men som nettbutikk uten publikumsadresse. |
| Anmeldelser | «leverte glasset kjapt», «rimelig frontrute uten forsikring», «god pris på ruteskift» — ikke «fikset ruten på stedet». |
| «Bilglass uten forsikring»-side + Q&A | ✅ Passer 100 %. |
| Priser | Må følge **prisregelen**: listepris × 0,60, rund NED til tier (3 990 / 5 490 / 6 990 / 8 490). «Fra 5 490 kr» (IKKE oppdiktede tall — Alltid fakta). |
| Schema | Bruk `OnlineStore`/`WebSite` + `Product`-schema i tillegg til/istedenfor `LocalBusiness`. |

## Relatert arbeid (allerede bygget)
- **Arch audit v2 / ai-visibility.mjs** (ARC-10): GEO-måling — 3 kundeprompter → 3 AI-søk (DeepSeek) → visibility/position/sentiment. Eksempel: klarpakke.no kjennes ikke av AI-en (salgbart GEO-funn). Kan gjenbrukes for finnbilglass.
