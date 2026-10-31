#!/usr/bin/env node
/**
 * E2E: kundereisen i staging — kjennemerke → bil → glass → pris → henvendelse.
 *
 * Verifiserer hele kjeden mot staging-Workeren (ingen prod-kall, ingen
 * produksjonsdata). Skriptet feiler med eksittkode 1 hvis et steg ikke holder —
 * «HTTP 200» alene er ikke bevis.
 *
 * Bruk:
 *   node scripts/e2e-kundereise-staging.mjs                 # SU18018
 *   node scripts/e2e-kundereise-staging.mjs AB12345
 *
 * Miljø:
 *   STAGING_URL   default https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev
 *   E2E_NAVN      default 'E2E Test Hermes'
 *   E2E_KONTAKT   default 'e2e-test@finnbilglass.no'
 */

const BASE =
    process.env.STAGING_URL || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const REGNR = (process.argv[2] || 'SU18018').toUpperCase().replace(/\s+/g, '');
const NAVN = process.env.E2E_NAVN || 'E2E Test Hermes';
const KONTAKT = process.env.E2E_KONTAKT || 'e2e-test@finnbilglass.no';

const steg = [];
let feilet = false;

function logg(navn, ok, detalj) {
    steg.push({ navn, ok, detalj });
    console.log(`${ok ? '✔' : '✖'} ${navn} — ${detalj}`);
    if (!ok) feilet = true;
}

async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'FinnBilGlass-E2E/1.0' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        /* ikke-JSON-svar rapporteres som tekst */
    }
    return { status: res.status, json, text };
}

console.log(`E2E kundereise — ${BASE}`);
console.log(`Kjennemerke: ${REGNR}\n`);

// ── Steg 1: kjennemerke → bil ─────────────────────────────────
const regnrRes = await post('/api/regnr', { regnr: REGNR });
const bil = regnrRes.json?.bil ?? null;
const resolver = regnrRes.json?.resolver ?? null;

if (regnrRes.status !== 200 || !regnrRes.json?.ok) {
    logg('1. regnr-oppslag', false, `HTTP ${regnrRes.status} ${regnrRes.text.slice(0, 200)}`);
} else if (!bil) {
    logg('1. regnr-oppslag', false, 'SVV ga ingen bil — kundereisen stopper (skal ikke skje med gyldig regnr)');
} else {
    logg(
        '1. regnr-oppslag',
        true,
        `${bil.merke} ${bil.modell} ${bil.aar} · VIN ${bil.vin ? bil.vin.slice(0, 8) + '…' : 'mangler'}`
    );
}

// ── Steg 2: bil → glass ───────────────────────────────────────
// Kundereisen bruker resolver-svaret fra /api/regnr når det finnes (VIN gir
// PINPOINT). /api/frontrute er reserveveien når resolveren ikke svarte — den
// matcher på merke/modell/år alene og gir løsere treff.
let valgtGlass = null;
let glassKilde = null;

if (bil) {
    const resolverKandidat = resolver?.varenr
        ? {
              varenr: resolver.varenr,
              varenavn: resolver.varenavn,
              eurokode: resolver.eurokode,
              pris: resolver.pris,
              listepris: resolver.listepris,
          }
        : null;

    if (resolverKandidat && (resolver.utfall === 'PINPOINT' || resolver.utfall === 'VERIFY')) {
        valgtGlass = resolverKandidat;
        glassKilde = `resolver ${resolver.utfall}`;
        logg(
            '2. bil → glass',
            true,
            `${resolver.utfall} (${resolver.grunn ?? 'uten grunn'}) · ${(resolver.kandidater ?? []).length} kandidat(er) · valgt ${valgtGlass.varenr} (${valgtGlass.varenavn})`
        );
    } else {
        const fr = await post('/api/frontrute', {
            merke: bil.merke,
            modell: bil.modell ?? undefined,
            aar: bil.aar ?? undefined,
        });
        const r = fr.json ?? {};
        const kandidater = Array.isArray(r.kandidater) ? r.kandidater : [];
        valgtGlass = r.anbefaling ?? kandidater[0] ?? null;
        glassKilde = `frontrute ${r.utfall ?? 'FALLBACK'}`;

        if (fr.status === 200 && kandidater.length > 0 && valgtGlass?.varenr) {
            // FALLBACK er et gyldig utfall (katalog-gap), men da er treffet ikke
            // bekreftet — det skal stå eksplisitt i beviset.
            const sikker = r.utfall === 'PINPOINT' || r.utfall === 'VERIFY';
            logg(
                '2. bil → glass',
                sikker,
                `${r.utfall ?? 'FALLBACK'} · ${kandidater.length} kandidat(er) · valgt ${valgtGlass.varenr} (${valgtGlass.varenavn})${sikker ? '' : ' — ikke bekreftet treff'}`
            );
        } else {
            logg(
                '2. bil → glass',
                false,
                `HTTP ${fr.status} utfall=${r.utfall ?? '?'} kandidater=${kandidater.length} ${r.grunn ?? ''}`
            );
        }
    }
} else {
    logg('2. bil → glass', false, 'hoppet over — ingen bil fra steg 1');
}

// ── Steg 3: glass → pris ──────────────────────────────────────
if (valgtGlass) {
    const pris = valgtGlass.pris;
    const listepris = valgtGlass.listepris;
    const gyldig =
        typeof pris === 'number' && pris > 0 && [3990, 5490, 6990, 8490].includes(pris);
    logg(
        '3. glass → pris',
        gyldig,
        `kundePris ${pris} kr (trinn) · listepris ${listepris ?? '?'} kr · eurokode ${valgtGlass.eurokode ?? '?'}`
    );
} else {
    logg('3. glass → pris', false, 'hoppet over — ingen glasskandidat');
}

// ── Steg 4: pris → kundehenvendelse ───────────────────────────
if (valgtGlass) {
    const inq = await post('/api/inquiry', {
        regnr: REGNR,
        navn: NAVN,
        kontakt: KONTAKT,
        melding: `E2E-verifisering av kundereise i staging (varenr ${valgtGlass.varenr}).`,
        valgt: {
            varenr: valgtGlass.varenr,
            eurokode: valgtGlass.eurokode ?? null,
            pris: valgtGlass.pris ?? null,
        },
    });
    const id = inq.json?.inquiryId;
    const okStatus = inq.status === 200 || inq.status === 201;
    if (okStatus && inq.json?.ok && Number.isInteger(id)) {
        logg('4. kundehenvendelse', true, `inquiryId ${id} opprettet (HTTP ${inq.status})`);
        console.log(`\ninquiryId=${id}`);
        console.log(`varenr=${valgtGlass.varenr}`);
        console.log(`eurokode=${valgtGlass.eurokode ?? ''}`);
        console.log(`pris=${valgtGlass.pris ?? ''}`);
        console.log(`glassKilde=${glassKilde ?? ''}`);
    } else {
        logg('4. kundehenvendelse', false, `HTTP ${inq.status} ${inq.text.slice(0, 200)}`);
    }
} else {
    logg('4. kundehenvendelse', false, 'hoppet over — ingen glasskandidat');
}

// ── Oppsummering ─────────────────────────────────────────────
const okCount = steg.filter((s) => s.ok).length;
console.log(`\nResultat: ${okCount}/${steg.length} steg OK`);
process.exit(feilet ? 1 : 0);
