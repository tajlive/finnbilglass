DELETE FROM vin_glass_overrides;
INSERT INTO vin_glass_overrides (vin, eurocode, make, model, year, verified_by, confidence, source)
VALUES
('WV1ZZZ7HZ5H060934', '8579AGSGYAVZ1B', 'VW', 'TRANSPORTER T5', 2005, 'Tom-fasit 2026-08-16 (korrigert fra CSGY — 2525GYA er riktig, ikke coated)', 0.98, 'manual-fasit');
