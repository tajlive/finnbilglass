/**
 * glass-variant-kontroll — serverens kontroll av kundens valgte variant.
 *
 * Valgtreet hjelper kunden å velge; denne modulen kontrollerer at det som faktisk
 * sendes inn henger sammen med bilen OG med kundens egne svar om plassering,
 * karosseri og utstyr. Den bruker NØYAKTIG samme feltvurdering som valgtreet
 * (`posisjonFeltVerdier` + `vurderFelt`), slik at skjerm og server aldri kan
 * være uenige om hva et svar betyr.
 *
 * Tre utfall:
 *   - `avvist`     : dokumentert motstrid → 400 med forståelig tekst
 *   - `bekreftet`  : alle sjekkbare felt støtter svaret
 *   - `ukjent`     : minst ett felt er ukjent → kan gå videre, men lagres ALDRI
 *                    som bekreftet passform
 */
import { klassifiserGlass, erListeRad } from './glass-posisjon.js';
import { kropperIRad } from './fitment-v1/catalogue-candidates.js';
import { posisjonFeltVerdier, vurderFelt } from './glass-kandidat-vurdering.js';

export type Produkttype = 'glass' | 'list' | 'tilbehor' | 'ukjent';
export type Salgsenhet = 'enkel' | 'par' | 'uklar';

/**
 * Produkttype fra navn og varenr — ikke fra `rad_type`, som er upålitelig:
 * `2735PYKIT «PYNTELIST KIT V+H»` står med rad_type='glass' i produksjonsbasen.
 */
export function produkttype(varenavn: string | null | undefined, varenr: string | null | undefined): Produkttype {
  const navn = String(varenavn ?? '').toUpperCase();
  if (/PYNTELIST|PYLIST|YTTERLIST|INNRE LIST|LISTE?\b|KLIPS|PAKNING|GUMMILIST|SENSORGEL|SENSORTAPE|LIM\b/.test(navn)) return 'list';
  if (erListeRad(varenavn, varenr)) return 'list';
  if (/VINDUVISKER|VISKERBLAD|TILBEHØR|TILBEHOR/.test(navn)) return 'tilbehor';
  return 'glass';
}

/**
 * Salgsenhet. `V+H` viser at varen DEKKER begge sider, men er ikke bevis på at
 * pakken inneholder to glass. Derfor `par` kun når navnet uttrykkelig sier par/
 * sett; `V+H` alene gir `uklar` med grunnlag.
 */
export function salgsenhet(varenavn: string | null | undefined): { enhet: Salgsenhet; grunnlag: string } {
  const navn = String(varenavn ?? '').toUpperCase();
  if (/(?<![A-ZÆØÅ])(?:PAR|SETT|2-PAK|TO-PAK)(?![A-ZÆØÅ])/.test(navn)) {
    return { enhet: 'par', grunnlag: 'varenavn sier par/sett' };
  }
  if (/V\s*\+\s*H|VS\s*[\/+]\s*HS|VENSTRE\s*[\/+]\s*HØYRE/.test(navn)) {
    return { enhet: 'uklar', grunnlag: 'V+H i varenavn viser sidedekning, ikke bekreftet pakkeinnhold' };
  }
  return { enhet: 'enkel', grunnlag: 'ingen par-markering i varenavn' };
}

export interface VariantSvar {
  side?: string;
  door?: string;
  placement?: string;
  body?: string;
  /** Utstyrssvar fra kunden: { oppvarmet: 'ja'|'nei'|'vet-ikke', sensor: … } */
  answers?: Record<string, string>;
}

export type KontrollUtfall =
  | { status: 'bekreftet'; notat: string[] }
  | { status: 'ukjent'; notat: string[]; uavklart: string[] }
  | { status: 'avvist'; grunn: 'produkttype' | 'side' | 'dor' | 'plassering' | 'karosseri' | 'utstyr'; melding: string };

const FELT_TEKST: Record<string, { felt: string; valgt: string; motsatt: string }> = {
  side: { felt: 'side', valgt: 'venstre', motsatt: 'høyre' },
  door: { felt: 'door', valgt: 'fremre', motsatt: 'bakre' },
  placement: { felt: 'placement', valgt: 'foran', motsatt: 'bak' },
};

const SIDE_TEKST: Record<string, string> = { left: 'venstre', right: 'høyre' };
const DOR_TEKST: Record<string, string> = { front: 'fremre', rear: 'bakre' };
const BODY_TEKST: Record<string, string> = {
  sedan: 'sedan', estate: 'stasjonsvogn', hatchback: '5-dørs/hatchback',
  coupe: 'coupé', cabriolet: 'cabriolet', van: 'varebil', suv: 'SUV',
};

/**
 * Utstyr som kunden har svart på, sammenlignet med det katalogen dokumenterer.
 * Bare eksplisitt motsatt svar avvises; «vet ikke» er aldri en motsetning.
 */
const UTSTYR_FEATURE: Record<string, string> = {
  oppvarmet: 'heated',
  heated: 'heated',
  sensor: 'rainSensor',
  regnsensor: 'rainSensor',
  kamera: 'camera',
  camera: 'camera',
  coated: 'coated',
  akustisk: 'acoustic',
  acoustic: 'acoustic',
};

export function kontrollerVariant(
  rad: { varenr: string; varenavn: string | null; eurokode: string | null; kommentar?: string | null },
  svar: VariantSvar,
): KontrollUtfall {
  const navn = rad.varenavn ?? '';

  // 1) Produkttype: en pyntelist/klips er ikke et glass, uansett rad_type.
  const type = produkttype(navn, rad.varenr);
  if (type !== 'glass') {
    return {
      status: 'avvist',
      grunn: 'produkttype',
      melding: 'Valgt vare er ikke et glass. Velg en glassvariant, så kontrollerer vi den.',
    };
  }

  const pos = klassifiserGlass(navn, rad.varenr, rad.eurokode, null);
  if (pos.type === 'ukjent') {
    return { status: 'ukjent', notat: [], uavklart: ['glassplassering'] };
  }

  const notat: string[] = [];
  const uavklart: string[] = [];

  // 2) Side
  if (svar.side && svar.side !== 'unknown') {
    const { verdier, konflikt } = posisjonFeltVerdier(
      { type: pos.type, side: pos.side, dorLedd: pos.dorLedd, ventilLedd: pos.ventilLedd, konflikt: pos.typekonflikt || pos.typekodeKonflikt },
      'side',
      navn,
    );
    const v = vurderFelt(verdier, svar.side, konflikt);
    if (v === 'motstrid') {
      return {
        status: 'avvist',
        grunn: 'side',
        melding:
          'Du valgte ' + (SIDE_TEKST[svar.side] ?? svar.side) + ' side, men denne varen er dokumentert som ' +
          (verdier?.length === 1 ? (SIDE_TEKST[verdier[0]] ?? verdier[0]) : 'en annen side') +
          '. Velg riktig side på nytt, så kontrollerer vi glasset.',
      };
    }
    if (v === 'ukjent') uavklart.push('side');
    if (v === 'konflikt') uavklart.push('side (kildekonflikt)');
  } else {
    uavklart.push('side');
  }

  // 3) Dørledd
  if (svar.door && svar.door !== 'unknown' && pos.type === 'dor') {
    const { verdier, konflikt } = posisjonFeltVerdier({ side: pos.side, dorLedd: pos.dorLedd, konflikt: pos.typekonflikt || pos.typekodeKonflikt }, 'door', navn);
    const v = vurderFelt(verdier, svar.door, konflikt);
    if (v === 'motstrid') {
      return {
        status: 'avvist',
        grunn: 'dor',
        melding:
          'Du valgte ' + (DOR_TEKST[svar.door] ?? svar.door) + ' dørrute, men denne varen er dokumentert som ' +
          (DOR_TEKST[verdier?.[0] ?? ''] ?? 'en annen dør') + '. Velg på nytt, så kontrollerer vi glasset.',
      };
    }
    if (v === 'ukjent' || v === 'konflikt') uavklart.push('dørledd');
  }

  // 4) Plassering (ventilrute foran/bak)
  if (svar.placement && svar.placement !== 'unknown' && pos.type === 'ventil') {
    const { verdier, konflikt } = posisjonFeltVerdier({ side: pos.side, ventilLedd: pos.ventilLedd, konflikt: pos.typekonflikt || pos.typekodeKonflikt }, 'placement', navn);
    const v = vurderFelt(verdier, svar.placement, konflikt);
    if (v === 'motstrid') {
      return {
        status: 'avvist',
        grunn: 'plassering',
        melding:
          'Du valgte ' + (svar.placement === 'front' ? 'fremre' : 'bakre') +
          ' ventilrute, men denne varen er dokumentert som ' +
          (verdier?.[0] === 'front' ? 'fremre' : 'bakre') + '. Velg på nytt, så kontrollerer vi glasset.',
      };
    }
    if (v === 'ukjent' || v === 'konflikt') uavklart.push('plassering');
  }

  // 5) Karosseri — bare når kunden faktisk har oppgitt det.
  if (svar.body && svar.body !== 'unknown') {
    const kropper = [...kropperIRad(navn)];
    const v = vurderFelt(kropper.length ? kropper : null, svar.body, false);
    if (v === 'motstrid') {
      return {
        status: 'avvist',
        grunn: 'karosseri',
        melding:
          'Du valgte ' + (BODY_TEKST[svar.body] ?? svar.body) + ', men denne varen er dokumentert for ' +
          kropper.map((k) => BODY_TEKST[k] ?? k).join('/') + '. Velg på nytt, så kontrollerer vi glasset.',
      };
    }
    if (v === 'ukjent') uavklart.push('karosseri');
  }

  // 6) Utstyr kunden har svart på
  const features = featuresFraKommentar(rad.kommentar ?? null);
  for (const [nokkel, svarVerdi] of Object.entries(svar.answers ?? {})) {
    const svarLower = String(svarVerdi).toLowerCase();
    if (svarLower === 'vet-ikke' || svarLower === 'unknown' || svarLower === '') { uavklart.push('utstyr:' + nokkel); continue; }
    const feature = UTSTYR_FEATURE[nokkel];
    if (!feature) continue;
    const onsket = svarLower === 'ja' || svarLower === 'true';
    const dokumentert = features.includes(feature);
    // Katalogen dokumenterer utstyret bare når kommentaren nevner det. Mangler
    // dokumentasjonen, er svaret ukjent — ikke en motsetning.
    if (!dokumentert && onsket) { uavklart.push('utstyr:' + nokkel); continue; }
    if (dokumentert && !onsket) {
      return {
        status: 'avvist',
        grunn: 'utstyr',
        melding:
          'Du svarte at bilen ikke har ' + nokkel + ', men denne varen er dokumentert med ' + nokkel +
          '. Velg en annen variant, eller endre svaret — vi kontrollerer uansett manuelt før tilbud.',
      };
    }
  }

  if (uavklart.length) return { status: 'ukjent', notat, uavklart };
  return { status: 'bekreftet', notat };
}

/** Samme feature-utledning som kandidatgeneratoren bruker (én kilde). */
function featuresFraKommentar(kommentar: string | null): string[] {
  const k = String(kommentar ?? '').toUpperCase();
  const f: string[] = [];
  if (/EMB=10\d/.test(k)) f.push('encapsulated');
  if (/ANTENNEFESTE|ANTENNE/.test(k)) f.push('antenna');
  if (/REGN|SENSOR|REGNSENSOR/.test(k)) f.push('rainSensor');
  if (/CAMERA|KAMERA|LDW/.test(k)) f.push('camera');
  if (/COATED|SOLAR|IR-/.test(k)) f.push('coated');
  if (/HEATED|OPPVARMET/.test(k)) f.push('heated');
  if (/ACOUSTIC|AKUSTISK|NOISE/.test(k)) f.push('acoustic');
  return f;
}
