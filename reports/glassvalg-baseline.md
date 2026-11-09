# glassvalg-baseline — utgangspunkt før kandidatvalg-arbeidet

**Dato:** 2026-11-04 · **Branch:** `copy/kvittering-20261103` (pushes til `feat/katalogvarianter-20261104`)

| Måling | Verdi |
|---|---|
| SHA ved start | `dfbc86b` |
| QA | 549/549 pass, 0 fail |
| tsc --noEmit | grønn |
| verify-valgtre (prod-D1, 6 biler) | «Ingen brudd på invariantene», exit 0 |
| Prod `glass_prisliste` | 30 937 rader |
| Prod `glass_typekode` | **finnes ikke** (0047 ikke kjørt) — typekode-plassering kun i staging |
| Staging `glass_typekode` | 20 601 rader, 18 unike koder |

**Reproduserbare kommandoer (før endring):**

```bash
npm run qa                                              # 549/549
npx tsc --noEmit                                        # grønn
node --import tsx scripts/verify-valgtre.mjs            # «Ingen brudd», exit 0
node --import tsx --test tests/glass-valg.test.mjs      # 12 tester
```

**Identifisert rotårsak (behandlet i Oppgave 2):** `feltVerdi` i `src/glass-valg.ts`
returnerte `null` for tre kvalitativt forskjellige tilstander — ukjent, «begge sider»
og flere karosserier («SED+STV»). De to siste er dokumenterte mengder, ikke ukjent,
og forsvant dermed: en «begge sider»-rad dokumenterte høyre uten at høyre ble tilbudt,
og en «SED+STV»-rad ga aldri karosserispørsmål.

**117-bilersettet:** ikke re-målt her (Oppgave 6) — historiske tall (117 biler,
PINPOINT 15/VERIFY 78/FALLBACK 24) gjelder forrige koderunde, ikke denne.
