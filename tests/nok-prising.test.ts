/**
 * NOK-prising: prisregelen, mva-uttrekk og skillet mellom estimat og bekreftet pris.
 *
 * Det viktigste som testes er at et EUR-estimat ALDRI blir en kundepris, og at mva
 * brytes UT av trinnprisen (den er inkl. mva) i stedet for å legges på toppen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    beregnPris,
    mvaFraInkl,
    MAKS_KURS_ALDER_DAGER,
    XLS_RABATT_FAKTOR,
    estimertKundeprisInklMva,
    estimertFrontruteKundeprisInklMva,
    type Valutakurs,
} from '../src/pricing/nok-prising.ts';
import { parseNorgesBankSdmx } from '../src/pricing/valutakurs.ts';
import { tierPris } from '../src/matcher.ts';

const IDAG = new Date('2026-10-31T12:00:00Z');
const KURS: Valutakurs = {
    fra: 'EUR',
    til: 'NOK',
    kurs: 10.312,
    dato: '2026-10-30',
    kilde: 'Norges Bank EXR/B.EUR.NOK.SP',
};

// ── Prisregelen ────────────────────────────────────────────────

test('prisliste 9 875 → estimat 3 085,94 (9 875 × 0,25 × 1,25)', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 9875, idag: IDAG });
    assert.equal(r.sikkerhet, 'ESTIMERT');
    assert.equal(r.raaPris, 3085.94);
    assert.equal(r.kundePris, 3085.94);
});

test('frontrute matcher bruker frontrutefaktor, mens generell prisregel står separat', () => {
    for (const listepris of [1000, 5000, 6650, 9875, 9980, 10745, 14860, 19425, 50000]) {
        assert.equal(estimertFrontruteKundeprisInklMva(listepris), tierPris(listepris), `avvik for listepris ${listepris}`);
    }
});

test('rabattfaktoren er 0,25 — XLS-pris er eks. mva (Tom 2026-10-29)', () => {
    assert.equal(XLS_RABATT_FAKTOR, 0.25);
    assert.equal(estimertKundeprisInklMva(10745), 3357.81);
});

test('frontrute får 60 % rabatt inkl. 25 % mva mens øvrig glass beholder 75 %', () => {
    assert.equal(estimertFrontruteKundeprisInklMva(10745), 5372.5);
    assert.equal(estimertKundeprisInklMva(10745), 3357.81);
});

test('prisliste 9 980 (VW T5) → estimat 3 118,75', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 9980, idag: IDAG });
    assert.equal(r.kundePris, 3118.75);
});

test('høy listepris gir fortsatt pris — ingen øvre trinn-grense', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 20000, idag: IDAG });
    assert.equal(r.kundePris, 6250);
    assert.equal(r.sikkerhet, 'ESTIMERT');
    assert.ok(r.advarsler.includes('ESTIMAT_MANUAL_KONTROLL'));
});

test('lav listepris gir fortsatt estimat — ingen nedre trinn-grense', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 4000, idag: IDAG });
    assert.equal(r.kundePris, 1250); // 4 000 × 0,25 × 1,25
    assert.equal(r.sikkerhet, 'ESTIMERT');
});

test('fakturakostnad med påslag 1,5 og mva: 3 000 → 5 625', () => {
    const r = beregnPris({
        grunnlag: 'SUPPLIER_INVOICE',
        belop: 3000,
        paslagFaktor: 1.5,
        idag: IDAG,
    });
    assert.equal(r.raaPris, 5625);
    assert.equal(r.kundePris, 5625);
    assert.equal(r.sikkerhet, 'BEKREFTET');
});

test('påslag under 1 flagges som tap', () => {
    const r = beregnPris({
        grunnlag: 'SUPPLIER_INVOICE',
        belop: 8000,
        paslagFaktor: 0.9,
        idag: IDAG,
    });
    assert.ok(r.advarsler.includes('PASLAG_UNDER_1_SELGER_MED_TAP'));
});

test('ugyldig beløp gir ingen pris', () => {
    for (const belop of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
        const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop, idag: IDAG });
        assert.equal(r.kundePris, null);
        assert.ok(r.advarsler.includes('UGYLDIG_BELOP'));
    }
});

// ── Mva brytes ut, legges ikke på ───────────────────────────────

test('mva brytes ut av trinnpris: 5 490 → 1 098 mva / 4 392 eks.', () => {
    const { mva, eksMva } = mvaFraInkl(5490);
    assert.equal(mva, 1098);
    assert.equal(eksMva, 4392);
    assert.equal(mva + eksMva, 5490, 'mva + eks. mva skal være lik kundeprisen');
});

test('mva legges PÅ toppen: 10 745 → 3 357,81 inkl. mva', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 10745, idag: IDAG });
    assert.equal(r.kundePris, 3357.81);
    assert.equal(r.mva, 671.56);
    assert.equal(r.prisEksMva, 2686.25);
    assert.equal(Math.round((r.mva! + r.prisEksMva!) * 100) / 100, 3357.81);
});

// ── EUR-estimat er aldri en kundepris ──────────────────────────

test('Glavista EUR gir ESTIMERT og ingen kundepris', () => {
    const r = beregnPris({
        grunnlag: 'GLAVISTA_SRP_EUR',
        belop: 486.25,
        valutakurs: KURS,
        idag: IDAG,
    });
    assert.equal(r.sikkerhet, 'ESTIMERT');
    assert.equal(r.kundePris, null, 'et EUR-estimat skal aldri bli en kundepris');
    assert.equal(r.mva, null, 'ingen mva på et estimat fra et annet marked');
    assert.equal(r.estimatNok, 5014.21);
    assert.ok(r.advarsler.includes('EUR_VEILEDNING_ER_IKKE_KOSTNAD'));
});

test('EUR uten valutakurs gir ingen pris', () => {
    const r = beregnPris({ grunnlag: 'GLAVISTA_SRP_EUR', belop: 486.25, idag: IDAG });
    assert.equal(r.estimatNok, null);
    assert.ok(r.advarsler.includes('MANGLER_VALUTAKURS'));
});

test('utdatert kurs flagges', () => {
    const gammel: Valutakurs = { ...KURS, dato: '2026-09-01' };
    const r = beregnPris({
        grunnlag: 'GLAVISTA_SRP_EUR',
        belop: 100,
        valutakurs: gammel,
        idag: IDAG,
    });
    assert.ok(r.advarsler.some((a) => a.startsWith('KURS_FOR_GAMMEL')));
    assert.equal(r.sikkerhet, 'ESTIMERT');
});

test(`kurs innenfor ${MAKS_KURS_ALDER_DAGER} dager gir ingen aldersadvarsel`, () => {
    const r = beregnPris({
        grunnlag: 'GLAVISTA_SRP_EUR',
        belop: 100,
        valutakurs: KURS,
        idag: IDAG,
    });
    assert.ok(!r.advarsler.some((a) => a.startsWith('KURS_FOR_GAMMEL')));
});

test('kurs datert i fremtiden flagges', () => {
    const framtid: Valutakurs = { ...KURS, dato: '2026-12-01' };
    const r = beregnPris({
        grunnlag: 'GLAVISTA_SRP_EUR',
        belop: 100,
        valutakurs: framtid,
        idag: IDAG,
    });
    assert.ok(r.advarsler.includes('KURSDATO_I_FREMTIDEN'));
});

test('ugyldig kursverdi avvises', () => {
    const dårlig: Valutakurs = { ...KURS, kurs: 0 };
    const r = beregnPris({
        grunnlag: 'GLAVISTA_SRP_EUR',
        belop: 100,
        valutakurs: dårlig,
        idag: IDAG,
    });
    assert.ok(r.advarsler.includes('MANGLER_VALUTAKURS'));
    assert.equal(r.estimatNok, null);
});

// ── Norges Bank-parser ─────────────────────────────────────────

test('parser Norges Bank SDMX-JSON (virkelig responsform)', () => {
    const payload = {
        data: {
            dataSets: [
                {
                    series: {
                        '0:0:0:0': { observations: { '0': ['10.312'] } },
                    },
                },
            ],
            structure: {
                dimensions: {
                    observation: [{ values: [{ id: '2026-10-30' }] }],
                },
            },
        },
    };
    const out = parseNorgesBankSdmx(payload);
    assert.deepEqual(out, { kurs: 10.312, dato: '2026-10-30' });
});

test('parser velger nyeste observasjon når flere finnes', () => {
    const payload = {
        data: {
            dataSets: [
                {
                    series: {
                        '0:0:0:0': { observations: { '0': ['10.3475'], '1': ['10.3315'], '2': ['10.312'] } },
                    },
                },
            ],
            structure: {
                dimensions: {
                    observation: [
                        { values: [{ id: '2026-10-28' }, { id: '2026-10-29' }, { id: '2026-10-30' }] },
                    ],
                },
            },
        },
    };
    const out = parseNorgesBankSdmx(payload);
    assert.deepEqual(out, { kurs: 10.312, dato: '2026-10-30' });
});

test('parser gir null på søppel — aldri en gjettet kurs', () => {
    assert.equal(parseNorgesBankSdmx(null), null);
    assert.equal(parseNorgesBankSdmx({}), null);
    assert.equal(parseNorgesBankSdmx({ data: {} }), null);
    assert.equal(
        parseNorgesBankSdmx({
            data: {
                dataSets: [{ series: { '0:0:0:0': { observations: { '0': ['ikke-et-tall'] } } } }],
                structure: { dimensions: { observation: [{ values: [{ id: '2026-10-30' }] }] } },
            },
        }),
        null
    );
});
