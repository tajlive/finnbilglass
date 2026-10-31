/**
 * Henter datert EUR/NOK-kurs fra Norges Bank (åpent API, ingen nøkkel).
 *
 * Datasett: EXR / B.EUR.NOK.SP — daglige noteringer på virkedager.
 * Vi lagrer OBSERVASJONSDATOEN, ikke hentedatoen. En pris som er merket med
 * kursdato er etterprøvbar; en pris merket med "i dag" er ikke det.
 *
 * Responsen er SDMX-JSON og krever Accept-header — uten den svarer API-et
 * «Unsupported format: json».
 */

import type { Valutakurs } from './nok-prising';

const NORGES_BANK_URL =
    'https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?format=sdmx-json&lastNObservations=1';
const KILDE = 'Norges Bank EXR/B.EUR.NOK.SP';

interface SdmxJson {
    data?: {
        dataSets?: Array<{ series?: Record<string, { observations?: Record<string, Array<string | number>> }> }>;
        structure?: { dimensions?: { observation?: Array<{ values?: Array<{ id?: string }> }> } };
    };
}

/**
 * Parser SDMX-JSON fra Norges Bank til { kurs, dato }.
 * Returnerer null hvis strukturen ikke er som forventet — aldri en gjettet kurs.
 */
export function parseNorgesBankSdmx(body: unknown): { kurs: number; dato: string } | null {
    const j = body as SdmxJson;
    const series = j?.data?.dataSets?.[0]?.series;
    if (!series) return null;
    const first = Object.values(series)[0];
    const obs = first?.observations;
    if (!obs) return null;

    const obsValues = j.data?.structure?.dimensions?.observation?.[0]?.values;
    if (!Array.isArray(obsValues)) return null;

    // Velg observasjonen med høyest indeks = nyeste notering.
    const keys = Object.keys(obs)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isInteger(n))
        .sort((a, b) => a - b);
    if (keys.length === 0) return null;

    const nyeste = keys[keys.length - 1];
    const raw = obs[String(nyeste)]?.[0];
    const kurs = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    const dato = obsValues[nyeste]?.id;

    if (!Number.isFinite(kurs) || kurs <= 0) return null;
    if (typeof dato !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dato)) return null;

    return { kurs, dato };
}

/**
 * Henter siste EUR/NOK-kurs. Kaster ved nettverksfeil slik at kalleren kan
 * velge å vise «pris ikke tilgjengelig» framfor en utdatert kurs.
 */
export async function hentEurNokKurs(): Promise<Valutakurs> {
    const res = await fetch(NORGES_BANK_URL, {
        headers: {
            Accept: 'application/vnd.sdmx.data+json;version=1.0.0',
            'User-Agent': 'FinnBilGlass/1.0 (+https://finnbilglass.no)',
        },
        // Norges Bank publiserer én gang i døgnet — en times cache er rikelig.
        cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);

    if (!res.ok) {
        throw new Error(`Norges Bank HTTP ${res.status}`);
    }

    const parsed = parseNorgesBankSdmx(await res.json());
    if (!parsed) {
        throw new Error('Norges Bank: uventet responsformat');
    }

    return { fra: 'EUR', til: 'NOK', kurs: parsed.kurs, dato: parsed.dato, kilde: KILDE };
}
