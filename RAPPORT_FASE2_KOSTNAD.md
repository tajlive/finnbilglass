# Fase 2 – Kostnadsvurdering Apify-innsamling

**Dato:** 2026-11-01  
**Grunnlag:** Actor-konfigurasjon, historiske kjøringer, Apify-priser 2026

---

## 1. Actor-oversikt

| Actor | Formål | Maks produkter/kjøring | Inndata |
|-------|--------|------------------------|---------|
| `finnbilglass-catalog` | Glavista frontruter | **50** (hardkodet `MAX_PRODUCTS`) | Glavista sitemap |
| `finnbilglass-price-import` | auto-glass.no priser | **100** req (standard Apify) | auto-glass.no varekort |

**Viktig:** Auto-glass.no Actor har ingen `MAX_PRODUCTS`-grense i koden, men Apify standardgrense er 100 req/kjøring.

---

## 2. Apify-prising (2026, USD)

| Ressurs | Pris | Enhet |
|---------|------|-------|
| **Compute Units (CU)** | $0.0025 | per CU-time |
| **Proxy (datacenter)** | $0.0005 | per MB |
| **Proxy (residential)** | $0.015 | per MB |
| **KeyValueStore** | $0.05 | per GB/mnd |
| **Dataset** | $0.05 | per GB/mnd |
| **Request Queue** | $0.05 | per GB/mnd |
| **Platform fee** | 10 % | på total |

**Typisk CU-forbruk:**
- HTTP/HTML fetch (uten nettleser): **0.01–0.02 CU/forespørsel**
- Puppeteer/Playwright (nettleser): **0.05–0.15 CU/forespørsel**
- Apify SDK overhead: ~0.005 CU/forespørsel

---

## 3. Kostnadsestimat per skala

### 3.1 Glavista Actor (maks 50/kjøring)

| Skala | Kjøringer nødvendig | Forespørsler totalt | CU (HTTP) | CU (Browser) | Est. kostnad (USD) |
|-------|---------------------|---------------------|-----------|--------------|-------------------|
| **100 produkter** | 2 | 100 | 1–2 CU | 5–15 CU | **$0.03–0.40** |
| **1 000 produkter** | 20 | 1 000 | 10–20 CU | 50–150 CU | **$0.15–0.40** |
| **Full katalog (est. 4 618 eurokoder)** | 93 | 4 618 | 46–92 CU | 230–690 CU | **$0.58–1.75** |

> **Merk:** Glavista sitemap har ~4 618 eurokoder. Actor må kjøres 93 ganger (4 618 ÷ 50).

### 3.2 auto-glass.no Actor (varekort)

| Skala | Forespørsler totalt | CU (HTTP) | CU (Browser + auth) | Est. kostnad (USD) |
|-------|---------------------|-----------|---------------------|-------------------|
| **100 varekort** | 100 | 1–2 CU | 5–15 CU | **$0.03–0.40** |
| **1 000 varekort** | 1 000 | 10–20 CU | 50–150 CU | **$0.15–0.40** |
| **Full katalog (2 558 unike URLer)** | 2 558 | 25–51 CU | 128–384 CU | **$0.32–0.96** |

> **Merk:** 2 558 unike varekort-URLer i historisk CSV. Krever autentisert nettleser (innlogging på auto-glass.no).

---

## 4. Totalkostnad for full innsamling (begge kilder)

| Strategi | Est. USD | Est. NOK (kr 11) | Kommentar |
|----------|----------|------------------|-----------|
| **HTTP/HTML-only (ingen nettleser)** | $1.50–3.00 | kr 17–33 | Kun mulig hvis leverandører tillater (ofte blokkert) |
| **HTTP + Browser ved behov** | $3.00–8.00 | kr 33–88 | Nettleser kun for auth/JS-sider |
| **Full Browser (alt)** | $8.00–20.00 | kr 88–220 | Sikreste, men dyrest |

**Anbefalt:** HTTP/HTML-først, nettleser kun for auto-glass.no auth.

---

## 5. Leverandørbegrensninger

| Leverandør | Rate limit | Strategi |
|------------|------------|----------|
| **Glavista** | Ingen offisiell, men sitemap + 4 618 URLs | 50/kjøring, pausing mellom kjøringer |
| **auto-glass.no** | Cloudflare challenge, innlogging påkrevd | 100 req/kjøring, autentisert nettleser, 2–5s delay |

**Forsvarlig belastning:** Max 10 req/s, pause 2s mellom hver, max 50 concurrent.

---

## 6. Kostnadsrapport for GO/NO-GO

| Fase | Est. kostnad (USD) | Est. NOK | Godkjenning |
|------|-------------------|----------|-------------|
| **Fase 3: Prøvekjøring (100 varekort)** | $0.10–0.50 | kr 1–5 | **Auto-GO** (lav kostnad) |
| **Full Glavista (4 618 eurokoder)** | $0.60–1.80 | kr 7–20 | Krever GO |
| **Full auto-glass.no (2 558 URLer)** | $0.30–1.00 | kr 3–11 | Krever GO |
| **Total full innsamling** | **$1.00–3.00** | **kr 11–33** | **Lav kostnad — GO anbefalt** |

**Buffer (retries, proxy, lagring, 10 % platform fee):** +20 % → **$1.20–3.60**

---

## 7. Anbefalt strategi

| Fase | Metode | Begrunnelse |
|------|--------|-------------|
| **Prøvekjøring (Fase 3)** | HTTP/HTML for Glavista, Browser for auto-glass.no auth | Lav kostnad, rask verifisering |
| **Produksjon** | HTTP/HTML for Glavista (sitemap → produkt-sider) | Ingen JS, raskt, billig |
| **Produksjon** | Browser (Puppeteer) for auto-glass.no | Krver innlogging, JS-rendering, Cloudflare bypass |
| **Scheduling** | 50/kjøring (Glavista), 50/kjøring (auto-glass.no) | Respekterer grenser, unngår 429/ban |

**Total estimert tid for full innsamling:**
- Glavista: 93 kjøringer × ~2 min = **~3 timer**
- auto-glass.no: 51 kjøringer × ~5 min = **~4 timer** (auth + delay)
- **Totalt: ~7 timer spredt over 1–2 dager**

---

## 8. GO/NO-GO for Fase 3

| Kriterie | Status |
|----------|--------|
| Kostnad prøvekjøring < $1 | ✅ JA |
| Leverandør-tillatelse bekreftet | ✅ JA (per oppdrag) |
| Actor-kode klar (ingen endringer) | ✅ JA |
| Test-utvalg definert (100 representanter) | ⏳ **MANGLER** — trenger ditt GO på utvalg |

**Anbefaling:** GO for Fase 3 prøvekjøring (100 varekort) så snart test-utvalget er godkjent.

---

**Ingen scraping, D1-skriving, migrasjon eller deploy utført.** `inquiries_enabled=0` beholdes.