-- 0050: faktura- og transportfelt i `ordre`
--
-- STATUS: IKKE KJØRT. Ligger i migrations/pending/ fordi det er en
-- produksjonsskjemaendring som krever Toms godkjenning.
--
-- Bakgrunn (2026-11-04): /ops-rutinen «tilbud → aksept → faktura → betaling →
-- sendt → levert» har felt for alt unntatt fakturanummer og transportør:
--   betalings_status, betalings_metode, ordre_status, sporingsnummer, skade_sjekk
-- finnes fra før. Manglende: faktura_nummer, faktura_sendt_at, transportor.
--
-- Endringen er rent additiv: ingen kolonne endres eller slettes, ingen rad
-- skrives, ingen indeks bygges på nytt. Tilbakeføring er ikke nødvendig for
-- lesing; ønsker man å angre, kan kolonnene ligge urørt (de er nullbare).
--
-- Rekkefølge ved eventuell kjøring: denne migrasjonen er uavhengig av
-- katalogmigrasjonen 0048 og kan kjøres når som helst.

ALTER TABLE ordre ADD COLUMN faktura_nummer TEXT;
ALTER TABLE ordre ADD COLUMN faktura_sendt_at INTEGER;
ALTER TABLE ordre ADD COLUMN transportor TEXT;

-- Knytter fakturaen til saken den kom fra, uten å duplisere saksdata.
CREATE INDEX IF NOT EXISTS idx_ordre_faktura ON ordre(faktura_nummer);
