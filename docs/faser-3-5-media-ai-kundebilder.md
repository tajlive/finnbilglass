# FASE 3–5 — Media, kundebilder og AI/CV (parkert design)

> KLA-301 · Status 2026-08-18: **PARKERT**. Tom har besluttet a avvente bildeopplasting, kunde-chat og speech. Dette dokumentet beholdes som designhistorikk, ikke aktiv implementeringsplan. Ingen produksjonsdeploy av disse fasene uten ny eksplisitt beslutning.

## FASE 3 — Bildeinnhenting (mediaflyt)

**Regler (oppdragsgitt):**
- Kun godkjent API/feed eller eksplisitt godkjent kilde. Aldri hotlink i prod.
- MIME-validering (jpeg/png/webp), maks 5 MB, SHA-256, perceptual hash (dedup), R2-lagring.

**Flyt:**
```
godkjent kilde → last ned (bounded) → MIME-sjekk → størrelsessjekk →
magic-byte-sjekk (signatur) → SHA-256 → phash → dedup (glass_id+role+sha) →
R2: glass/<glass_id>/<role>/<sha256[:16]>.webp → glass_media-rad
(license_ref + attribution OBLIGATORISK før is_current=1)
```

**Rolle-register:** full_glass · sensor_detail · marking · diagram · logo.

**Nåværende status:** metadata-høsting finnes i `scripts/catalog-harvester.mjs` (`--download-media` krever `--media-licensed` + allowlistet `--media-host`). **Bildedekning = 0 %** — ingen skriftlig bilde-lisens foreligger (Buycarparts = NO-GO, kildematrisen §1). Neste steg: be Autoglass om leverandørbilder fra Pilkington/Saint-Gobain-avtalen (de eier rettighetslinjen).

## FASE 4 — Kundebilder (VERIFY-flyt)

**Designet mobil-først:** Bilde 1 = «Ta bilde av merkingen nederst i hjørnet» (eurocode-markering), Bilde 2 = «Ta bilde av området bak bakspeilet, fra utsiden» (sensor/kamera-verifisering).

**Krav per steg:** eksempelbilde-overlegg → kameraramme → kvalitetssjekk (uskarpt/mørkt/for langt unna) → retake-knapp → EXIF-stripping FØR opplasting → samtykkeboks → slettetid (maks 30 dager, konfigurerbar) → tydelig «Jeg får ikke tatt bilde»-valg → manuell fallback (kjører VERIFY-kandidatlisten manuelt). Kunden trenger ALDRI kjenne eurokoden.

**GDPR:** bilder = personopplysning-på-vei → behandlingsgrunnlag (berettiget interesse, formål: korrekt glass), minimering (kun de to bildene), lagring i R2 med autoslett, logg i resolution_audit.

## FASE 5 — AI/CV (flertrinnsmodell)

**Modellen returnerer ALDRI varenummer.** Kun signaler inn i `evidence-fusion.ts` (FASE 6 — bygget og testet).

| Trinn | Input | Output |
|---|---|---|
| 1 Bildekvalitet | kundebilde | score + avvisningsgrunn (uskarp/mørk/vinkel) |
| 2 Motivklassifisering | bilde | hjørne-markering vs bakspeil-område vs annet |
| 3 OCR | utsnitt | eurocode/OEM-tekst + confidence + boks (bevisområde) |
| 4 Featuredeteksjon | bilde 2 | sensor/kamera/HUD/varme/akustisk-markering — boolean + confidence |
| 5 Geometri/konturmatch | glass-form | form-signatur mot kandidater |
| 6 Lokal punktsmatching | feature-punkter | likhet mot kandidatbilder (R2) |
| 7 Embedding-shortlist | embedding | topp-N kandidater (ALDRI beslutning) |
| 8 Kandidatsammenligning | alle over | per-kandidat evidens-signaler |
| 9 Evidensrapport | signals | JSON: feature, verdi, confidence, bevisutsnitt, modellversjon, input-hash, forklaring, positiv/negativ/ukjent |

**Modellvalg (ikke besluttet):** OCR: PaddleOCR/vision-modell. CV: Cloudflare Workers AI (Ai Vision) vs egen modelleksport. Krav: modellversjon + input-hash i ALLE signaler (sporbarhet).

**Kill switch:** per kilde (media) + per modellversjon (CV) — deaktiverer øyeblikkelig til FALLBACK.
