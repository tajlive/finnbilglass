/** SVV (Statens vegvesen) enkeltoppslag — kjennemerke → bil.
 *  Endepunkt: akfell-datautlevering.atlas.vegvesen.no (offisielt datautleverings-API).
 *  Auth: header `SVV-Authorization: Apikey <nøkkel>`.
 *  Returnerer null ved alle feiltyper — frontend faller tilbake til manuell innfylling.
 */
export interface SvvBil {
  merke: string;
  modell: string;
  aar: number | null;
  vin: string | null;
  farge: string | null;
  registrert: boolean;
  /** Full førstegangsregistreringsdato i Norge (ISO: 2005-04-20). */
  forstegangsregistrert: string | null;
  /** True hvis bilen er importert (fortollingsreferanse finnes). */
  import: boolean;
  /** Norsk navn på importland (f.eks. «Storbritannia») — null hvis ikke import/ukjent. */
  importLand: string | null;
}

/** ISO-3166 alpha-2 → norsk landnavn (vanligste importland til Norge). */
const LAND_NAVN: Record<string, string> = {
  SE: 'Sverige', DE: 'Tyskland', DK: 'Danmark', NL: 'Nederland', GB: 'Storbritannia',
  BE: 'Belgia', FI: 'Finland', FR: 'Frankrike', AT: 'Østerrike', CH: 'Sveits',
  PL: 'Polen', ES: 'Spania', IT: 'Italia', US: 'USA', JP: 'Japan', KR: 'Sør-Korea',
  CN: 'Kina', IE: 'Irland', CZ: 'Tsjekkia', LU: 'Luxembourg', NO: 'Norge',
  PT: 'Portugal', HU: 'Ungarn', SK: 'Slovakia', EE: 'Estland', LV: 'Latvia',
  LT: 'Litauen', RO: 'Romania', BG: 'Bulgaria', GR: 'Hellas', IS: 'Island',
  AU: 'Australia', CA: 'Canada', MX: 'Mexico', TR: 'Tyrkia', TH: 'Thailand',
};

/** Katalog-navn for merker avviker fra SVV (f.eks. MERCEDES-BENZ → MERCEDES). */
const MERKE_ALIAS: Record<string, string> = {
  'MERCEDES-BENZ': 'MERCEDES',
  'MERCEDES BENZ': 'MERCEDES',
  VOLKSWAGEN: 'VW',
  'OPEL VAUXHALL': 'OPEL',
};

export function aliasMerke(merke: string): string {
  const m = (merke || '').trim().toUpperCase();
  return MERKE_ALIAS[m] ?? m;
}

export async function svvLookup(regnrNorm: string, apiKey: string | undefined): Promise<SvvBil | null> {
  return svvOppslag('kjennemerke', regnrNorm, apiKey);
}

/** VIN-oppslag (understellsnummer) — brukes som backup når kjennemerke ikke gir treff. */
export async function svvLookupVin(vin: string, apiKey: string | undefined): Promise<SvvBil | null> {
  return svvOppslag('understellsnummer', vin, apiKey);
}

async function svvOppslag(
  param: 'kjennemerke' | 'understellsnummer',
  verdi: string,
  apiKey: string | undefined
): Promise<SvvBil | null> {
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(
      `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?${param}=${encodeURIComponent(verdi)}`,
      {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          'SVV-Authorization': `Apikey ${apiKey}`,
          'User-Agent': 'Finnbilglass/1.0',
        },
      }
    );
    if (!res.ok) return null;
    if (res.status === 204) return null; // ingen treff (tom body)
    const data = (await res.json()) as {
      kjoretoydataListe?: Array<{
        kjoretoyId?: { understellsnummer?: string };
        forstegangsregistrering?: { registrertForstegangNorgeDato?: string };
        registrering?: { registreringsstatus?: { kodeVerdi?: string } };
        godkjenning?: {
          tekniskGodkjenning?: {
            tekniskeData?: {
              generelt?: {
                merke?: Array<{ merke: string }>;
                handelsbetegnelse?: Array<string>;
              };
              karosseriOgLasteplan?: { rFarge?: Array<{ kodeNavn?: string }> };
            };
          };
          forstegangsGodkjenning?: {
            fortollingOgMva?: {
              fortollingsreferanse?: string;
              beskrivelse?: string;
            };
          };
        };
      }>;
    };
    const k = data.kjoretoydataListe?.[0];
    if (!k) return null;
    const g = k.godkjenning?.tekniskGodkjenning?.tekniskeData?.generelt;
    const merke = aliasMerke(g?.merke?.[0]?.merke ?? '');
    const modell = (g?.handelsbetegnelse?.[0] ?? '').trim().toUpperCase();
    if (!merke) return null;
    const regDato = k.forstegangsregistrering?.registrertForstegangNorgeDato ?? '';
    const aar = regDato ? parseInt(regDato.slice(0, 4), 10) : null;
    // Import-deteksjon: fortollingsreferanse finnes = bilen er fortollet/importert.
    // Land: første token i beskrivelsen er ISO-landkode (f.eks. «GB BMW X3 …»).
    const fortoll = k.godkjenning?.forstegangsGodkjenning?.fortollingOgMva;
    const importLandKode = fortoll?.beskrivelse ? /^([A-Z]{2})\b/.exec(fortoll.beskrivelse.trim())?.[1] : undefined;
    return {
      merke,
      modell,
      aar: aar && aar > 1900 && aar < 2100 ? aar : null,
      vin: k.kjoretoyId?.understellsnummer ?? null,
      farge: k.godkjenning?.tekniskGodkjenning?.tekniskeData?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn ?? null,
      registrert: k.registrering?.registreringsstatus?.kodeVerdi === 'REGISTRERT',
      forstegangsregistrert: regDato || null,
      import: !!fortoll?.fortollingsreferanse,
      importLand: importLandKode ? LAND_NAVN[importLandKode] ?? importLandKode : null,
    };
  } catch (e) {
    console.error('SVV-oppslag feilet:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(t);
  }
}
