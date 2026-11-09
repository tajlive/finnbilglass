-- 0049: Uttrykksindeks for v_glass_med_typekode.
--
-- MÅLT 2026-11-04 (staging, D1):
--   SELECT count(*) FROM v_glass_med_typekode;
--   → feil 7429 «D1 DB exceeded its CPU time limit», etter 36,15 s.
--   Etter indeksen under: samme spørring svarte på 1,37 s.
--
-- ÅRSAK: view-en gjør
--   LEFT JOIN glass_typekode t ON UPPER(t.varenr) = UPPER(p.varenr)
-- Funksjonsinnpakningen på BEGGE sider gjør at SQLite ikke kan bruke indeksen
-- glass_typekode(varenr) (indeksen er på rå varenr, ikke UPPER(varenr)).
-- Planen blir en nestet løkke over 30 937 × 20 601 rader med to UPPER()-kall
-- per sammenligning ≈ 6·10^8 operasjoner.
--
-- LØSNING: indeks på uttrykket UPPER(varenr), slik at join-nøkkelen blir søkbar.
-- View-definisjonen er ikke endret (den er 0020/0047 sin), så kunde- og
-- /ops-spørringer som ikke bruker view-en er upåvirket.
--
-- Forutsetning: tabellen glass_typekode må finnes (0047). I produksjon er 0047
-- ikke kjørt ennå — denne filen ligger derfor i migrations/pending/ til 0047 er
-- godkjent, og er trygg å kjøre flere ganger (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_glass_typekode_varenr_upper
  ON glass_typekode(UPPER(varenr));
