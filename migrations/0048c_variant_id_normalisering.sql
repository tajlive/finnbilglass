-- 0048c: Lik normalisering av variant_id overalt.
--
-- FEIL FUNNET I AVSTEMMING 2026-11-04: 0048 normaliserte eurokoden (fjernet
-- float-artefakten «.0» som importen laget av tallceller) men IKKE varenr.
-- 185 rader fikk derfor nøkkel som «41.0:3397110041» der importøren og
-- avstemmingen regnet «41:3397110041». Samme produkt fikk to identiteter
-- avhengig av hvilket ledd som regnet.
--
-- REGEL (kanonisk, gjelder migrasjon, import og avstemming):
--   kode = UPPER(TRIM(verdi)); hvis koden er rent tall med «.0» → fjern «.0».
--   Alle andre tegn (+, -, .) BEHOLDES — to eurokoder som bare skiller seg i
--   tegnsetting skal ikke smelte sammen.
--
-- 14 par viste seg å være ekte duplikater (samme varenr+eurokode to ganger).
-- De beholdes begge med deterministisk suffiks «#2» slik at konflikten er
-- synlig i v_variant_konflikt i stedet for at en rad forsvinner.

-- 1) Midlertidig unik verdi på ALLE rader, så unik-indeksen ikke kolliderer midt
--    i oppdateringen. Hele tabellen regnes på nytt; kjøringen er idempotent.
UPDATE glass_prisliste SET variant_id = variant_id || '~tmp';

-- 2) Kanonisk nøkkel for alle rader, med deterministisk suffiks der nøkkelen
--    allerede er brukt (total > 1).
UPDATE glass_prisliste
   SET variant_id = CASE WHEN rn = 1 THEN base ELSE base || '#' || rn END
  FROM (
    SELECT p.id,
           CASE
             WHEN p.eurokode IS NOT NULL AND TRIM(p.eurokode) <> '' THEN
               UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                          ELSE TRIM(p.varenr) END)
               || ':' ||
               UPPER(CASE WHEN p.eurokode LIKE '%.0' AND p.eurokode NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(p.eurokode), 1, LENGTH(TRIM(p.eurokode)) - 2)
                          ELSE TRIM(p.eurokode) END)
             ELSE
               UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                          ELSE TRIM(p.varenr) END)
               || ':~' || UPPER(TRIM(COALESCE(p.varenavn, '')))
           END AS base,
           ROW_NUMBER() OVER (
             PARTITION BY
               CASE
                 WHEN p.eurokode IS NOT NULL AND TRIM(p.eurokode) <> '' THEN
                   UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                              ELSE TRIM(p.varenr) END)
                   || ':' ||
                   UPPER(CASE WHEN p.eurokode LIKE '%.0' AND p.eurokode NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.eurokode), 1, LENGTH(TRIM(p.eurokode)) - 2)
                              ELSE TRIM(p.eurokode) END)
                 ELSE
                   UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                              ELSE TRIM(p.varenr) END)
                   || ':~' || UPPER(TRIM(COALESCE(p.varenavn, '')))
               END
             ORDER BY p.id
           ) AS rn,
           COUNT(*) OVER (
             PARTITION BY
               CASE
                 WHEN p.eurokode IS NOT NULL AND TRIM(p.eurokode) <> '' THEN
                   UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                              ELSE TRIM(p.varenr) END)
                   || ':' ||
                   UPPER(CASE WHEN p.eurokode LIKE '%.0' AND p.eurokode NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.eurokode), 1, LENGTH(TRIM(p.eurokode)) - 2)
                              ELSE TRIM(p.eurokode) END)
                 ELSE
                   UPPER(CASE WHEN p.varenr LIKE '%.0' AND p.varenr NOT LIKE '%.%.0'
                              THEN SUBSTR(TRIM(p.varenr), 1, LENGTH(TRIM(p.varenr)) - 2)
                              ELSE TRIM(p.varenr) END)
                   || ':~' || UPPER(TRIM(COALESCE(p.varenavn, '')))
               END
           ) AS total
      FROM glass_prisliste p
  ) AS ny
 WHERE glass_prisliste.id = ny.id;

-- 3) Konfliktregister. En rad havner her når variant_id ikke er identisk med
--    den kanoniske nøkkelen, dvs. den fikk suffiks «#n» fordi samme
--    (varenr, eurokode) fantes flere ganger. Navn som selv inneholder «#»
--    påvirker ikke registeret — sammenligningen er mot den beregnede nøkkelen.
CREATE TABLE IF NOT EXISTS glass_variant_konflikt (
  variant_id TEXT PRIMARY KEY,
  varenr     TEXT,
  eurokode   TEXT,
  varenavn   TEXT,
  pris       REAL,
  grunn      TEXT NOT NULL DEFAULT 'samme (varenr, eurokode) finnes flere ganger',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO glass_variant_konflikt (variant_id, varenr, eurokode, varenavn, pris)
SELECT variant_id, varenr, eurokode, varenavn, pris
  FROM glass_prisliste
 WHERE variant_id <> CASE
             WHEN eurokode IS NOT NULL AND TRIM(eurokode) <> '' THEN
               UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(varenr), 1, LENGTH(TRIM(varenr)) - 2)
                          ELSE TRIM(varenr) END)
               || ':' ||
               UPPER(CASE WHEN eurokode LIKE '%.0' AND eurokode NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(eurokode), 1, LENGTH(TRIM(eurokode)) - 2)
                          ELSE TRIM(eurokode) END)
             ELSE
               UPPER(CASE WHEN varenr LIKE '%.0' AND varenr NOT LIKE '%.%.0'
                          THEN SUBSTR(TRIM(varenr), 1, LENGTH(TRIM(varenr)) - 2)
                          ELSE TRIM(varenr) END)
               || ':~' || UPPER(TRIM(COALESCE(varenavn, '')))
           END;

CREATE VIEW IF NOT EXISTS v_variant_konflikt AS
SELECT variant_id, varenr, eurokode, varenavn, pris, grunn
  FROM glass_variant_konflikt
 ORDER BY variant_id;

-- 3) Fjern identiske duplikatrader som oppstod fordi en tidligere import brukte
--    en annen normalisering (samme varenr, eurokode, navn, pris og radtype).
--    Bare suffiks-rader kan fjernes, og bare når en identisk rad uten suffiks finnes.
DELETE FROM glass_prisliste
 WHERE variant_id LIKE '%#%'
   AND EXISTS (
     SELECT 1 FROM glass_prisliste q
      WHERE q.id <> glass_prisliste.id
        AND q.varenr = glass_prisliste.varenr
        AND COALESCE(q.eurokode, '') = COALESCE(glass_prisliste.eurokode, '')
        AND COALESCE(q.varenavn, '') = COALESCE(glass_prisliste.varenavn, '')
        AND COALESCE(q.pris, -1) = COALESCE(glass_prisliste.pris, -1)
        AND q.rad_type = glass_prisliste.rad_type
        AND q.variant_id NOT LIKE '%#%'
   );
