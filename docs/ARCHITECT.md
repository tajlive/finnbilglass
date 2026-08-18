# finnbilglass — Arkitektur

## Sannhetskilder (SSoT)

| Domene | System |
|---|---|
| Oppgaver/krav | Linear |
| Kode | GitHub |
| Data | Supabase |
| Runtime | Cloudflare Workers |
| Governance | Arch Control Plane (`.arch/`) |

## Roller

- **Codex:** hovedarkitekt, prosjektleder og ansvarlig implementering/verifisering i dette repoet
- **Hermes:** hjelpeagent for forslag, rapporter og avgrensede arbeidsoppgaver nar Tom/Codex ber om det
- **Kimi:** research (research-analyst)
- **Tom:** prioritering (eneste som flytter Ready for Tom → Approved)

## Eskalasjon

Kostnad/risiko/produksjonsendring utover tildelt oppgave → Linear-issue (label p0/incident)
→ Ready for Tom. Aldri ta kostnadsbeslutninger autonomt.

## Arvet kunnskap

Se `.arch/inherited-lessons.md` (generert av Arch Project Factory ved init).
