# Releasekandidat — tekstoppdatering (én samlet)

**Kandidat:** `1a40c24` · **Staging:** `e085d4c5-2e88-44d4-a792-e15518f8d844` · **QA:** 605/605 · `tsc`: grønn
**Produksjon i dag:** `90b8c660`

---

## 1. Sporbarhet: produksjonsversjon → Git-commit

Worker-versjonen har ingen Git-SHA fordi deploy skjer lokalt med `wrangler deploy`
(ikke Cloudflare Workers Builds). Koblingen er derfor bevist ved å sammenligne
**faktisk servert innhold** fra produksjon med markører som er innført/fjernet i
bestemte commits:

| Markør i prod-servert fil | Commit som innfører/fjerner | Funn i prod |
|---|---|---|
| `Frontrute-flyten går via resolveren` (app.js) | innført i `d8c858a` (Tilbake) | **1** → prod ≥ `d8c858a` |
| `Takk! Vi har mottatt forespørselen` (app.js) | fjernet i `21ebeb3` | **1** → prod < `21ebeb3` |
| `Beta for inviterte` (index.html) | fjernet i `0ad9af6` | **1** → prod < `0ad9af6` |
| `veiledende pris med 75` (frontrute-view.js) | fjernet i `13859c6` | **1** → prod < `13859c6` |

Eneste commit mellom `d8c858a` og `21ebeb3` som inneholder kode er `c62db43` (som selv
er dokumentasjon på toppen av `d8c858a`). **Produksjonskoden = `c62db43`.**

`git merge-base --is-ancestor c62db43 HEAD` → **ja**. Kandidaten bygger altså på den
aktive produksjonskoden, og ingen produksjonsendring kan overskrives.

## 2. Kodeendringer i kandidaten (alle tekst, ingen funksjon)

| Commit | Endring |
|---|---|
| `21ebeb3` | e-postemne «– sak #N», kvittering «bekrefter pris og frakt», felles bekreftelse i manuell-flyten |
| `61779b4` | frakt / retur / reklamasjon / selger (BLYT AS) på betalingssiden |
| `b752dc8` | personvern: lagringstid + behandlingsansvarlig |
| `0ad9af6` | all beta-tekst fjernet, merke «Pilot», beta-invitasjon fjernet |
| `13859c6` | **intern rabattopplysning fjernet** («75 % rabatt + mva») |
| `3fa4dcd` | Min side: «Vi avtaler levering» → «Levering og frakt avtales i tilbudet»; betaling uten nettbetaling-løfter |
| `1a40c24` | to teksttester oppdatert til pilot-teksten |

Ingen endring i `src/` utover kvitteringstekst i `21ebeb3`. Ingen flagg, migrasjon,
katalog, prisregel eller e-posttransport.

## 3. Tekstflater: status

**Ferdig gjennomgått:** forside (inkl. merke, footer, tilbehørsnote), personvern,
betaling, innlogging, min side, kvitteringse-post, bekreftelse i begge innsendingsflyter.

**Ikke gjennomgått (gjenstår):** `om-oss.html`, `bilglass-uten-forsikring.html`,
`404.html`, `/ops`-svarmaler og engangskode-e-posten. Disse er **ikke** endret i
kandidaten — den inneholder ingen påstander om dem.

## 4. Hvorfor dette bør ut nå

`13859c6` fjerner en **pågående lekkasje**: produksjon viser i dag kundens
innkjøpsrabatt («veiledende pris med 75 % rabatt + mva») i prisdetaljen.

## 5. Rollback

`wrangler rollback` til `90b8c660` (= `c62db43`). Ren kode-tilbakeføring; ingen
dataskriving i kandidaten.
