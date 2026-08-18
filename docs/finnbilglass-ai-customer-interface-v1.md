# FINNBILGLASS AI CUSTOMER INTERFACE v1 (C5) — STAGING

**Dato:** 2026-08-18 · Hermes (Implementation Agent) · Branch `arch/conversational-assistant-staging-v1`
**Status:** STAGING-ONLY. Ingen produksjonsendring. Env-gate `ASSISTANT_ENABLED` (prod default AV).

## 1. KARTLEGGING AV DAGENS FRONTEND

| Aspekt | Funn |
|---|---|
| Stack | **Vanilla HTML/CSS/JS** (ikke React/Next): `public/index.html` (306 l.), `app.js` (672 l.), `styles.css` (800 l.), SVG-sprite-ikoner, service worker |
| Skjermer | 5 SPA-seksjoner: `screen-start` (foto-regnr primær + manuelt søk), `screen-glass` (glasstype-valg), `screen-spm` (utstyrs-spørsmål), `screen-resultat`, `screen-tomt` |
| Mobil-først | Ja — kamera-API (`capture="environment"`), 52px tap-targets, SVV-badge; 80 % mobil |
| Eksisterende AI-elementer | `POST /api/les-skilt` (foto → Workers AI → SVV), `POST /api/assistant/*` (C2 staging-assistent, env-gated) |

## 2. CHAT-KNAPP-PLASSERING OG DESIGN (mobil-først)

- **Flytende AI-knapp (FAB) nederst til høyre** — 60 px, pulsring, safe-area-innsatt (`env(safe-area-inset-bottom)`), z-index over alt, lukkbar
- **Panel:** mobil = fullskjerm (100dvh); desktop ≥560 px = 400 px-vindu nede til høyre (mobil-tjeneste som skaleres opp — ikke omvendt)
- **4 store handlingsknapper** ved start: 🚗 Skriv reg.nr (primær), 📷 Ta bilde av skilt, 🎙 Snakk med meg, 🔍 Finn selv
- **Tale:** Web Speech API (`SpeechRecognition`, nb-NO) → **echo-bekreftelse** «Jeg hørte SU 18018. Stemmer det?» → Ja/Nei-chips (C2-policy: SPOKEN → PARSED → ECHO → CONFIRMED → ACCEPTED)
- **Foto:** `<input capture="environment">` → `POST /api/assistant/photo`
- **Usikkerhet:** AMBIGUOUS → advarsels-stil + kun informative spørsmål; EXACT → bilinfo + «Medfølger glasset» + relevante tilbehørs-chips
- **Gratis stack:** ingen tredjeparts-widget; vanilla + Cloudflare Pages/Workers; PWA via eksisterende service worker

## 3. ARKITEKTUR (kun eksisterende C2/R1-verktøy)

```
Kunde → /ai (widget) → /api/assistant/session|message|photo|identifier-confirmation|quote
                            ↓
                 conversation-v1 (deterministisk policy + verktøy)
                            ↓
                 fitment-v1-kjernen (shadow, v1AffectsCustomer=false)
                            ↓
                 accessory-v1 (kun dokumenterte relasjoner; viskere EXCLUDED)
```

DeepSeek/LLM: **kun** naturlig-språk-forståelse, forklaring, spørsmål, tolkning. Aldri: velge glass, sette EXACT, lage tilbehør, overstyre regler. Kjennemerke-ekstraksjon fra fri tekst er **deterministisk regex** (fikset i `api.ts` — mellomrom beholdes så ordgrenser fungerer: «frontrute til SU 18018» → SU18018).

## 4. E2E-RESULTATER (staging, 2026-08-18)

| Test | Resultat |
|---|---|
| `/ai` widget (fab + tale + foto + 4 knapper) | ✔ |
| SU18018: «Hei, trenger frontrute til SU18018» → VW Transporter T5 2005 | ✔ |
| OE 7H0845101H → echo → bekreftet → **v1-kjernen: «Riktig variant bekreftet: 2525GYA»** (shadow) | ✔ |
| 10 kjøretøy (fasit-live, 1951–1978): uten kjennemerke → **UNKNOWN, 0 spørsmål** | ✔ (AI gjetter aldri) |
| Full suite + tsc | ✔ (0 feil) |

## 5. LEKSJONER / NESTE

1. **Shadow-beviset er produktets kjerne:** v1-kjernen bekrefter 2525GYA i staging, klient-state beholder legacy — når gaten åpnes, er EXACT allerede verifisert.
2. Neste: legg til visning av ordreforslag (quote) i widgeten; utvid applikasjonsregisteret (gt-prislisten) slik at 10-testen gir reelle kandidater; tale-støtte i nettlesere uten Web Speech (fallback skriv).
3. DeepSeek-ekspert (conversation-v1/deepseek.ts) kobles på som tolk-nivå for fritekst når staging-verifiseringen er godkjent.

**Ingen produksjonsendring. Staging-only. STOPP.**
