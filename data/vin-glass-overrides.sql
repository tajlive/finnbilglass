DELETE FROM vin_glass_overrides;
INSERT INTO vin_glass_overrides (vin, eurocode, make, model, year, verified_by, confidence, source)
VALUES
('WV1ZZZ7HZ5H060934', '8579ACSGYAVZ1B', 'VW', 'TRANSPORTER T5', 2005, 'Tom/SU18018 fasit 2026-08-13', 0.95, 'manual-fasit');
