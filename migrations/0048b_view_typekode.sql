-- 0048b: Gjenopprett v_glass_med_typekode etter tabell-rebuilden i 0048.
--
-- Kjøres BARE i miljøer som har glass_typekode (staging). Produksjon har ikke
-- tabellen ennå (migrasjon 0047 er ikke kjørt der), og 0048 droppet derfor
-- view-en uten å kunne gjenopprette den.
--
-- Rekkefølge: 0048 → 0048b.

CREATE VIEW v_glass_med_typekode AS
SELECT p.varenr, p.varenavn, p.eurokode, p.pris, p.rad_type, p.variant_id,
       t.typekode, t.typekode_beskrivelse, t.kilde AS typekode_kilde
  FROM glass_prisliste p
  LEFT JOIN glass_typekode t ON UPPER(t.varenr) = UPPER(p.varenr);
