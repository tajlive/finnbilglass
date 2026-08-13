# Arch beslutninger — finnbilglass
## D-20260813-02 — infrastruktur + secrets provisionert
**Beslutning:** Finnbilglass legges på Toms egen CF-account KLARPAKKE (80d5b1d5) — IKKE Autoglass sin (2266e975, som er Eduards). Provisionert: D1 `finnbilglass-db` (ac35018c-0d43-4742-adf8-d881b7274684), Pages `finnbilglass` (finnbilglass.pages.dev), zone `finnbilglass.no` (b72021700d0e30173f387fb244b5f268). GitHub-secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID satt.
**Stack (antatt, arvet fra Autoglass):** React/Vite + CF Worker + D1 glass-katalog.
**Gjenstår:** Domeneshop NS-peking (manuell), app-kode, Worker, D1-schema/glass-import, Linear-team.

