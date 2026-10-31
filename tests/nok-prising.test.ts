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
    PRISTLISTE_RABATT_FAKTOR,
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

test('prisliste 9 875 → trinn 5 490 (9 875 × 0,60 = 5 925)', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 9875, idag: IDAG });
    assert.equal(r.sikkerhet, 'BEKREFTET');
    assert.equal(r.raaPris, 5925);
    assert.equal(r.kundePris, 5490);
});

test('beregnPris er ekvivalent med matcher.tierPris for prisliste-grunnlag', () => {
    // Regresjonsvern: prismodulen må ikke drive fra den etablerte prisregelen.
    for (const listepris of [5000, 6650, 8000, 9875, 9980, 11495, 14000, 50000]) {
        const fraModul = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: listepris, idag: IDAG }).kundePris;
        assert.equal(fraModul, tierPris(listepris), `avvik for listepris ${listepris}`);
    }
});

test('rabattfaktoren er 0,60 (Tom-vedtatt)', () => {
    assert.equal(PRISTLISTE_RABATT_FAKTOR, 0.6);
});

test('prisliste 9 980 (VW T5) → trinn 5 490', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 9980, idag: IDAG });
    assert.equal(r.kundePris, 5490);
});

test('pris over høyeste trinn → «Spesial», ingen kundepris', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 20000, idag: IDAG });
    assert.equal(r.kundePris, null);
    assert.ok(r.advarsler.includes('UTENFOR_TRINNSPRIS_SPESIAL'));
    assert.equal(r.sikkerhet, 'BEKREFTET', 'grunnlaget er fortsatt bekreftet — bare ikke trinnpriset');
});

test('pris under laveste trinn → «Spesial»', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 4000, idag: IDAG });
    // 4 000 × 0,60 = 2 400 → under 3 990
    assert.equal(r.kundePris, null);
    assert.ok(r.advarsler.includes('UTENFOR_TRINNSPRIS_SPESIAL'));
});

test('fakturakostnad med påslag 1,5: 3 000 → 4 500 → trinn 3 990', () => {
    const r = beregnPris({
        grunnlag: 'SUPPLIER_INVOICE',
        belop: 3000,
        paslagFaktor: 1.5,
        idag: IDAG,
    });
    assert.equal(r.raaPris, 4500);
    assert.equal(r.kundePris, 3990);
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

test('kundeprisen er ALDRI trinnpris × 1,25', () => {
    const r = beregnPris({ grunnlag: 'PRISTLISTE_NOK', belop: 9875, idag: IDAG });
    assert.equal(r.kundePris, 5490);
    assert.notEqual(r.kundePris, 5490 * 1.25);
    assert.equal(r.mva, 1098);
    assert.equal(r.prisEksMva, 4392);
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
