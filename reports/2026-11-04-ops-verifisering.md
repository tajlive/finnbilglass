# /ops visuelt verifisert — sak #36, #39, #40, #41

**Dato:** 2026-11-04 · **Miljø:** staging (`ops-staging.finnbilglass.no`, Cloudflare Access, `tomarnejensen@gmail.com (access)`)
**Staging-versjon:** `c592d92b-132b-4b43-8ece-0c0a278315cd` · **Commit:** `6669784` (uendret kode under verifiseringen)
**Skjermbilder:** `reports/ops-verifisering/sak-36.png`, `sak-39.png`, `sak-40.png`, `sak-41.png`

---

## Forutsetning: nettleseren ble synlig

`browser_exec(local=true)` kjørte headless med virtuell 800×600-skjerm, så ingen kunne logge inn. Rettet i `~/.hermes/config.yaml`:

```yaml
browser:
  headed: true
  chromium_args: [--window-size=1440,1000, --window-position=120,90]
```

Etter det: `screen.width` 800 → **2560**, vindu `1400×950` på skjermen, og Access-innloggingen ble gjort i det synlige vinduet. Profilen `~/.hermes/browser-profile/chrome` er persistent — innloggingen holder.

**Merk:** `/ops`s saksliste bruker `tr[data-key="inquiry-N"]`; deep-link `?sak=` åpner ikke saken i denne versjonen.

## Resultat per sak

| Sak | Kunde/skilt | Variant (variantId) | Beskrivelse | Pris i saken | Leveringssted | Utstyrssvar | Test |
|---|---|---|---|---|---|---|---|
| **#36** | Testkunde Hermes · DS 30475 · 11:38:35 | `8432AGAC:8432AGACMV1L` | TOYOTA RAV 4 22- FR AKU LDW | **listepris 10 745** (historisk, uten estimatfelt) · tilhørighet bekreftet | Trondheim | `{"oppvarmet":"nei"}` | `is_test=1` |
| **#39** | Testkunde Hermes · DS 30475 · 11:40:01 | `8432AGAC:8432AGACMV1L` | TOYOTA RAV 4 22- FR AKU LDW | **listepris 10 745** (historisk) · tilhørighet bekreftet | Trondheim | `{"oppvarmet":"nei"}` | `is_test=1` |
| **#40** | Testkunde Hermes · DS 30475 | `8432AGAC:8432AGACMV1L` | TOYOTA RAV 4 22- FR AKU LDW | **listepris 10 745 eks. mva · estimert kundepris 3 357,81 kr inkl. mva** | Trondheim | `{"oppvarmet":"nei"}` | `is_test=1` |
| **#41** | Testkunde Hermes · DS 30475 | `8432AGAC:8432AGACHMV30` | TOYOTA RAV 4 22- WS GN ACO LDW | **listepris 14 860 eks. mva · estimert kundepris 4 643,75 kr inkl. mva** | Trondheim | – (eksplisitt variantvalg) | `is_test=1` |

Alle fire viser full eurokode, produktbeskrivelse, leveringssted og prismerking i `/ops`-flaten, med tidslinje «Forespørsel opprettet» og kunde/ kontaktopplysninger.

**Historisk prisgrunnlag er bevart:** #36 og #39 viser `listepris 10745` og har **ingen** estimattekst — de ble opprettet før estimatfeltet (2026-11-04). #40 og #41 viser estimatet i tillegg. Det er samme append-only notat, ikke omskrevet historikk.

**Funn underveis (kosmetisk, ikke blokkerende):** saksoverskriften viser «TOYOTA TOYOTA RAV4 2024» (merkenavnet duplisert) — samme feil som i kundereisen. Driftsstatus viser «Miljø: Produksjon» selv på staging-verten. Begge er notert, ikke rettet i denne releasen.

---

## Sluttstatus for PR #28

| Kontroll | Status |
|---|---|
| Prisregel (XLS × 0,25 × 1,25) | ✅ verifisert i API, kort, oppsummering, sak #40/#41 |
| Invariant hele katalogen (30 937 rader) | ✅ 0 avvik |
| 117-bilersettet | ✅ 0 endrede fitment-utfall, 0 tekniske feil |
| Eksplisitt variantvalg | ✅ sak #41 (valgt blant tre) |
| Tilbake-flyt 390/1280 | ✅ Nei/Ja/Vet ikke/Endre svar/Tilbake/nytt søk |
| **`/ops` visuelt** | ✅ **denne rapporten** |
| QA / typecheck | ✅ 549/549, grønn |
| Migrasjon + tilbakeføring prøvd | ✅ 29 627 → **30 937**, tilbake til 29 627 |

**Ingen åpne kontroller gjenstår.** Produksjon venter på Toms eksplisitte godkjenning.
