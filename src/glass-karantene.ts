/**
 * Karantene for prisliste-rader som er merket som glass, men som ikke er en
 * frontrute.
 *
 * Bakgrunn (verifisert i produksjons-D1 2026-10-31): ground_truth pekte på
 * seks «frontruter» for TOYOTA C-HR 2018, men tre av dem var andre artikler:
 *
 *   8421ASCHS  230 kr   kommentar «TORPEDOVEGG FRONTRUTE»      (dashbordpanel)
 *   8421AKCH   915 kr   kommentar «10X I KIT»                  (pakke/kit)
 *   8421ASGRT 1090 kr   kommentar «FRONTRUTE TOPP INDRE»       (innerlist)
 *
 * De lå som rad_type='glass' med frontrute-eurokode, men er ikke glasset
 * kunden skal ha. Uten karantene kan de presenteres som frontrute-kandidat.
 *
 * Regelen er bevisst smal: den matcher bare entydige ikke-glass-ord. Merknader
 * som «NB 6X KLIPS I PAKKEN» og «MÅ HA KLIPS TIL A-STOLPE» står på EKTE
 * frontruter og må ikke rammes. Kildedata endres aldri — raden filtreres bare
 * bort fra kandidatlista, og tellingen rapporteres.
 */

/** Entydige ikke-glass-markører i kommentarfeltet. */
const IKKE_GLASS_MARKORER: ReadonlyArray<{ monster: RegExp; grunn: string }> = [
  { monster: /TORPEDO\s*VEGG|TORPEDOVEGG/i, grunn: 'torpedovegg (dashbordpanel)' },
  { monster: /TOPP\s+INDRE|INNERLIST|INNER\s*LIST/i, grunn: 'innerlist/overdel' },
  { monster: /\bKUN\s+BUNNLIST\b|\bBARE\s+(EN\s+)?LIST\b|\bKUN\s+LIST\b/i, grunn: 'kun list' },
  { monster: /SELVKLEBENDELIST|TOPP\s*LIST\b/i, grunn: 'list-produkt' },
  { monster: /\bGUMMILIST\b/i, grunn: 'gummilist' },
];

/**
 * Returnerer en begrunnelse når raden skal i karantene, ellers null.
 * `kommentar` er prislistas fritekstfelt; `varenavn` brukes bare som
 * tilleggssignal (produktnavnet kan være rene bilbetegnelsen).
 */
export function karanteneGrunn(kommentar: string | null | undefined, varenavn?: string | null): string | null {
  const k = (kommentar ?? '').trim();
  if (k) {
    for (const { monster, grunn } of IKKE_GLASS_MARKORER) {
      if (monster.test(k)) return `${grunn}: «${k.slice(0, 40)}»`;
    }
  }
  const n = (varenavn ?? '').toUpperCase();
  // Navn som eksplisitt sier at dette ikke er en frontrute.
  if (/\b(TORPEDO|INNERLIST|GUMMILIST)\b/.test(n)) return 'produktnavn angir ikke-frontrute';
  return null;
}
