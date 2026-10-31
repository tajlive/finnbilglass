/**
 * NOK-prising for FinnBilGlass — testbar prismodell med eksplisitt kostnadsgrunnlag.
 *
 * Prinsipp (Tom: "Alltid fakta"):
 *   En pris kan bare kalles BEKREFTET når den bygger på et NOK-grunnlag vi faktisk
 *   har. Glavistas veiledende pris er i EUR og er en RETAIL-referanse, ikke vår
 *   kostnad — den gir derfor alltid ESTIMERT og aldri en kundepris.
 *
 * Priskjeden (mva ligger INNI kundeprisen — trinnprisene 3 990/5 490/6 990/8 490
 * er det kunden ser, "inkl. mva"):
 *
 *   PRISTLISTE_NOK    listepris × 0,60 → rund ned til trinn   → BEKREFTET
 *   SUPPLIER_INVOICE  fakturakostnad × påslag → rund ned til trinn → BEKREFTET
 *   GLAVISTA_SRP_EUR  EUR-beløp × datert kurs                  → ESTIMERT (ingen kundepris)
 *
 * MVA blir aldri lagt PÅ toppen: den brytes UT av kundeprisen (25 % → ×25/125).
 */

/**
 * Hvor prisen kommer fra. Rekkefølgen er også styrke: faktura > prisliste > EUR-veiledning.
 */
export type Prisgrunnlag = 'SUPPLIER_INVOICE' | 'PRISTLISTE_NOK' | 'GLAVISTA_SRP_EUR';

/** Kan prisen vises som endelig kundepris, eller er den bare en orientering? */
export type Prissikkerhet = 'BEKREFTET' | 'ESTIMERT';

/** Tom-vedtatt rabatt mot veiledende listepris (2026-08-13). */
export const PRISTLISTE_RABATT_FAKTOR = 0.6;

/** Prisgruppene kunden ser (inkl. mva). */
export const TRINN = [3990, 5490, 6990, 8490] as const;

/**
 * Laveste listepris som kan gi en siterbar kundepris.
 * Under dette gulvet blir raa prisen lavere enn det billigste trinnet, og
 * beregnPris nekter aa runde opp — kunden skal ikke faa en pris vi ikke kan
 * staa inne for. Brukes til aa sortere siterbare produkter foerst.
 */
export const LAVESTE_SITERBARE_LISTEPRIS = TRINN[0] / PRISTLISTE_RABATT_FAKTOR;

/** Norsk merverdiavgift. Trinnprisene er inkl. mva, så satsen brukes til uttrekk. */
export const MVA_SATS = 0.25;

/** Hvor gammel en valutakurs kan være før den flagges. */
export const MAKS_KURS_ALDER_DAGER = 7;

/**
 * Runder NED til nærmeste trinnpris. `null` = utenfor trinn (under laveste eller
 * over høyeste) → «Spesial», som krever manuell pris.
 *
 * Merk: dette er trinn-regelen ALENE. `tierPris()` i matcher gjør
 * `tilNaermesteTrinn(listepris × 0,60)` — den er ikke duplisert her fordi
 * fakturakostnad trenger trinn-runde uten prisliste-rabatten.
 */
export function tilNaermesteTrinn(pris: number): number | null {
    if (!Number.isFinite(pris) || pris <= 0) return null;
    if (pris > TRINN[TRINN.length - 1]) return null;
    const treff = TRINN.filter((t) => t <= pris).pop();
    return treff ?? null;
}

export interface Valutakurs {
    fra: 'EUR';
    til: 'NOK';
    /** NOK per EUR. */
    kurs: number;
    /** ISO-dato (YYYY-MM-DD) for observasjonen — ikke datoen den ble hentet. */
    dato: string;
    /** Datakilde, f.eks. 'Norges Bank EXR/B.EUR.NOK.SP'. */
    kilde: string;
}

export interface PrisInput {
    grunnlag: Prisgrunnlag;
    /** Beløp i grunnlagets valuta: NOK for NOK-grunnlag, EUR for GLAVISTA_SRP_EUR. */
    belop: number;
    /** Påkrevd når grunnlaget er EUR. Ignoreres for NOK-grunnlag. */
    valutakurs?: Valutakurs | null;
    /** Påslag på fakturakostnad (SUPPLIER_INVOICE). Default 1,0 = ingen påslag. */
    paslagFaktor?: number;
    /** Mva-sats. Default 0,25. */
    mvaSats?: number;
    /** «I dag» for alderssjekk av kurs — injiserbar for tester. Default new Date(). */
    idag?: Date;
}

export interface Prisresultat {
    sikkerhet: Prissikkerhet;
    grunnlag: Prisgrunnlag;
    /** Kundepris inkl. mva, etter trinn-runde. null når prisen ikke er bekreftet. */
    kundePris: number | null;
    /** Mva-beløp brutt UT av kundeprisen. */
    mva: number | null;
    /** Kundepris eks. mva. */
    prisEksMva: number | null;
    /** Beregnet pris FØR trinn-runde (inkl. mva) — sporing for hvorfor trinnet ble som det ble. */
    raaPris: number | null;
    /** EUR-beløp × kurs, kun for EUR-grunnlag. Alltid merket estimat. */
    estimatNok: number | null;
    valutakurs: Valutakurs | null;
    advarsler: string[];
}

/**
 * Deler ut mva fra en pris som allerede er inkl. mva.
 * 25 % → mva = pris × 25/125.
 */
export function mvaFraInkl(prisInklMva: number, mvaSats: number = MVA_SATS): { mva: number; eksMva: number } {
    const mva = prisInklMva * (mvaSats / (1 + mvaSats));
    return {
        mva: Math.round(mva * 100) / 100,
        eksMva: Math.round((prisInklMva - mva) * 100) / 100,
    };
}

function dagerSiden(datoIso: string, idag: Date): number | null {
    const d = new Date(`${datoIso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor((idag.getTime() - d.getTime()) / 86_400_000);
}

function gyldigKurs(k: Valutakurs | null | undefined): k is Valutakurs {
    return !!k && Number.isFinite(k.kurs) && k.kurs > 0 && /^\d{4}-\d{2}-\d{2}$/.test(k.dato);
}

/**
 * Regner ut pris etter FinnBilGlass-prisregelen.
 *
 * Kaster aldri. Returnerer et resultat med `advarsler` og `kundePris: null` når
 * grunnlaget ikke er godt nok — en ufullstendig pris skal aldri se ut som en pris.
 */
export function beregnPris(input: PrisInput): Prisresultat {
    const advarsler: string[] = [];
    const idag = input.idag ?? new Date();
    const mvaSats = Number.isFinite(input.mvaSats as number) ? (input.mvaSats as number) : MVA_SATS;

    const tomt = (sikkerhet: Prissikkerhet): Prisresultat => ({
        sikkerhet,
        grunnlag: input.grunnlag,
        kundePris: null,
        mva: null,
        prisEksMva: null,
        raaPris: null,
        estimatNok: null,
        valutakurs: input.valutakurs ?? null,
        advarsler,
    });

    if (!Number.isFinite(input.belop) || input.belop <= 0) {
        advarsler.push('UGYLDIG_BELOP');
        return tomt('ESTIMERT');
    }

    // ── EUR-grunnlag: kun orientering, aldri kundepris ──
    if (input.grunnlag === 'GLAVISTA_SRP_EUR') {
        if (!gyldigKurs(input.valutakurs)) {
            advarsler.push('MANGLER_VALUTAKURS');
            return tomt('ESTIMERT');
        }
        const kurs = input.valutakurs;
        const alder = dagerSiden(kurs.dato, idag);
        if (alder === null) {
            advarsler.push('UGYLDIG_KURSDATO');
            return tomt('ESTIMERT');
        }
        if (alder < 0) advarsler.push('KURSDATO_I_FREMTIDEN');
        if (alder > MAKS_KURS_ALDER_DAGER) advarsler.push(`KURS_FOR_GAMMEL_${alder}d`);

        advarsler.push('EUR_VEILEDNING_ER_IKKE_KOSTNAD');
        const estimat = Math.round(input.belop * kurs.kurs * 100) / 100;
        return {
            ...tomt('ESTIMERT'),
            estimatNok: estimat,
            // Mva er ikke regnet ut for estimatet: SRP er en utsalgspris i et annet
            // marked, og å pynte den med norsk mva ville gjort et estimat til en fasit.
            valutakurs: kurs,
        };
    }

    // ── NOK-grunnlag: bekreftet ──
    let faktor = 1;
    if (input.grunnlag === 'PRISTLISTE_NOK') {
        faktor = PRISTLISTE_RABATT_FAKTOR;
    } else if (input.grunnlag === 'SUPPLIER_INVOICE') {
        faktor = Number.isFinite(input.paslagFaktor as number) ? (input.paslagFaktor as number) : 1;
        if (faktor < 1) advarsler.push('PASLAG_UNDER_1_SELGER_MED_TAP');
    }

    const raa = input.belop * faktor;
    const kundePris = tilNaermesteTrinn(raa);
    if (kundePris === null) {
        // Over høyeste trinn (eller under laveste) → «Spesial»: krever manuell pris.
        advarsler.push('UTENFOR_TRINNSPRIS_SPESIAL');
        return {
            ...tomt('BEKREFTET'),
            raaPris: Math.round(raa * 100) / 100,
        };
    }

    const { mva, eksMva } = mvaFraInkl(kundePris, mvaSats);
    return {
        sikkerhet: 'BEKREFTET',
        grunnlag: input.grunnlag,
        kundePris,
        mva,
        prisEksMva: eksMva,
        raaPris: Math.round(raa * 100) / 100,
        estimatNok: null,
        // NOK-grunnlag bruker ingen valutakurs — ingen kurs å vise.
        valutakurs: null,
        advarsler,
    };
}
