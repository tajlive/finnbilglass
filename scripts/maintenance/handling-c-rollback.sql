-- handling-c-rollback.sql — reverserer tabellene handling C oppretter.
--
-- Indeksene på oem_probe_queue beholdes bevisst: de er ikke-destruktive og
-- forbedrer oppslag. Kun de to nye tabellene fjernes.
--
-- KUN for isolert testdatabase, eller produksjon etter separat godkjenning.
-- Ingen BEGIN/COMMIT — D1 støtter det ikke gjennom wrangler d1 execute.

DROP TABLE IF EXISTS glass_vehicle_applications;
DROP TABLE IF EXISTS glass_catalog_items;
