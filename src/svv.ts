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
}

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
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(
      `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${encodeURIComponent(regnrNorm)}`,
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
    return {
      merke,
      modell,
      aar: aar && aar > 1900 && aar < 2100 ? aar : null,
      vin: k.kjoretoyId?.understellsnummer ?? null,
      farge: k.godkjenning?.tekniskGodkjenning?.tekniskeData?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn ?? null,
      registrert: k.registrering?.registreringsstatus?.kodeVerdi === 'REGISTRERT',
    };
  } catch (e) {
    console.error('SVV-oppslag feilet:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(t);
  }
}
