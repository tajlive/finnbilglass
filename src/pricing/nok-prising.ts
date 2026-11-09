/**
 * NOK-prising for FinnBilGlass — testbar prismodell med eksplisitt kostnadsgrunnlag.
 *
 * Prinsipp (Tom: "Alltid fakta"):
 *   En pris kan bare kalles BEKREFTET når den bygger på et NOK-grunnlag vi faktisk
 *   har. En pris som er beregnet fra veiledende listepris er et ESTIMAT som
 *   kontrolleres manuelt før tilbud.
 *
 * Priskjeden (Tom-vedtatt 2026-10-29 for XLS-prislisten):
 *
 *   PRISTLISTE_NOK    veiledende XLS-pris EKS. mva × 0,25 × 1,25  → ESTIMERT
 *   SUPPLIER_INVOICE  fakturakostnad × påslag × 1,25              → BEKREFTET
 *   GLAVISTA_SRP_EUR  EUR-beløp × datert kurs                     → ESTIMERT (ingen kundepris)
 *
 * XLS-prisen i prislisten er EKS. mva. Kunden ser 75 % rabatt lagt til grunn,
 * og mva (25 %) legges PÅ toppen:
 *
 *   estimert kundepris = listeprisEksMva × 0,25 × 1,25
 *
 * Det er INGEN avrunding til faste pristrinn: hver variant får sin egen pris,
 * avrundet til nærmeste øre. Faste trinn (3 990/5 490/6 990/8 490) og
 * 0,60-faktoren er fjernet (2026-11-04) fordi de ga feil pris og gjorde at
 * varianter over høyeste trinn feilaktig havnet på «Pris på forespørsel».
 */

export type Prisgrunnlag = 'SUPPLIER_INVOICE' | 'PRISTLISTE_NOK' | 'GLAVISTA_SRP_EUR';

/** Kan prisen vises som endelig kundepris, eller er den bare en orientering? */
export type Prissikkerhet = 'BEKREFTET' | 'ESTIMERT';

/** Rabatt mot veiledende XLS-pris (eks. mva): kunden får 75 % avslag (Tom 2026-10-29). */
export const XLS_RABATT_FAKTOR = 0.25;
/** Frontruterabatt: 60 % av veiledende listepris. Øvrig glass bruker XLS_RABATT_FAKTOR. */
export const FRONTRUTE_RABATT_FAKTOR = 0.40;

/**
 * Minste listepris som gir en meningsfull pris. Med den nye regelen finnes det
 * ingen øvre grense og ingen faste trinn — 1 kr er nok til å regne en pris.
 * Brukes av discovery til å sortere rader uten pris bakerst.
 */
export const MINSTE_GYLDIGE_LISTEPRIS = 1;
/** Norsk merverdiavgift. Trinnprisene er inkl. mva, så satsen brukes til uttrekk. */
export const MVA_SATS = 0.25;

/** Hvor gammel en valutakurs kan være før den flagges. */
export const MAKS_KURS_ALDER_DAGER = 7;

/** Runder til nærmeste øre (norsk mynt). */
export function rundTilOre(belop: number): number {
    return Math.round(belop * 100) / 100;
}

/**
 * Estimert kundepris inkl. mva fra veiledende XLS-pris (eks. mva).
 *
 *   listeprisEksMva × 0,25 × 1,25
 *
 * Ingen trinn, ingen avrunding til faste priser — bare øre. `null` når
 * grunnlaget mangler eller er ugyldig (da skal kunden få «Pris på forespørsel»).
 */
export function estimertKundeprisInklMva(listeprisEksMva: number | null | undefined): number | null {
    if (typeof listeprisEksMva !== 'number' || !Number.isFinite(listeprisEksMva) || listeprisEksMva <= 0) return null;
    return rundTilOre(listeprisEksMva * XLS_RABATT_FAKTOR * (1 + MVA_SATS));
}

/** Estimat inkl. mva for frontrute: listepris eks. mva × 0,40 × 1,25. */
export function estimertFrontruteKundeprisInklMva(listeprisEksMva: number | null | undefined): number | null {
    if (typeof listeprisEksMva !== 'number' || !Number.isFinite(listeprisEksMva) || listeprisEksMva <= 0) return null;
    return rundTilOre(listeprisEksMva * FRONTRUTE_RABATT_FAKTOR * (1 + MVA_SATS));
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

    // ── NOK-grunnlag ──
    // XLS-prislisten er EKS. mva: kunden får 75 % rabatt og 25 % mva på toppen.
    // Fakturakostnad er vår egen kostnad og gir en bekreftet pris (påslag + mva).
    let raa: number;
    let sikkerhet: Prissikkerhet = 'BEKREFTET';
    if (input.grunnlag === 'PRISTLISTE_NOK') {
        const estimat = estimertKundeprisInklMva(input.belop);
        if (estimat === null) {
            advarsler.push('UGYLDIG_BELOP');
            return tomt('ESTIMERT');
        }
        raa = input.belop * XLS_RABATT_FAKTOR * (1 + mvaSats);
        sikkerhet = 'ESTIMERT';
        advarsler.push('ESTIMAT_MANUAL_KONTROLL');
    } else {
        const paslag = Number.isFinite(input.paslagFaktor as number) ? (input.paslagFaktor as number) : 1;
        if (paslag < 1) advarsler.push('PASLAG_UNDER_1_SELGER_MED_TAP');
        raa = input.belop * paslag * (1 + mvaSats);
    }

    const kundePris = rundTilOre(raa);
    const { mva, eksMva } = mvaFraInkl(kundePris, mvaSats);
    return {
        sikkerhet,
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
