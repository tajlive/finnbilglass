/**
 * Vakt for handling B (ledger-backfill).
 *
 * Tester KUN statisk: leser SQL-filen og de eksporterte konstantene. Ingen
 * nettverkskall, ingen D1-tilgang. CI kan derfor aldri røre produksjon.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BACKFILL,
    BASELINE_LEDGER,
    ALDRI_REGISTRER,
    PROD_DB,
    sjekkDatabase,
    fingeravtrykk,
} from '../scripts/maintenance/ledger-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL = readFileSync(join(ROOT, 'scripts', 'maintenance', 'ledger-backfill-15.sql'), 'utf8');

test('SQL inneholder eksakt de 15 verifiserte migrasjonsnavnene', () => {
    assert.equal(BACKFILL.length, 15);
    for (const navn of BACKFILL) {
        assert.ok(SQL.includes(`'${navn}'`), `${navn} mangler i SQL-filen`);
    }
    const antall = [...SQL.matchAll(/'([0-9]{4}_[a-z0-9_]+\.sql)'/g)].map((m) => m[1]);
    assert.equal(antall.length, 15, `SQL refererer ${antall.length} filnavn, forventet 15`);
    assert.deepEqual([...antall].sort(), [...BACKFILL].sort());
});

test('SQL inneholder ingen BEGIN/COMMIT — D1 støtter det ikke', () => {
    const kode = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(kode, /\bBEGIN\b/i, 'BEGIN vil feile i D1');
    assert.doesNotMatch(kode, /\bCOMMIT\b/i, 'COMMIT vil feile i D1');
});

test('SQL bruker INSERT OR IGNORE, ikke vanlig INSERT', () => {
    assert.match(SQL, /INSERT\s+OR\s+IGNORE\s+INTO\s+d1_migrations/i);
    const vanlig = SQL.split('\n').filter(
        (l) => /^\s*INSERT\s+INTO/i.test(l)
    );
    assert.deepEqual(vanlig, [], 'vanlig INSERT er ikke idempotent');
});

test('de tre som aldri skal registreres er ikke i SQL-filen', () => {
    for (const navn of ALDRI_REGISTRER) {
        assert.ok(!SQL.includes(navn), `${navn} må ikke registreres som anvendt`);
    }
});

test('baseline + backfill gir 33 unike rader', () => {
    assert.equal(BASELINE_LEDGER.length, 18);
    const alle = [...BASELINE_LEDGER, ...BACKFILL];
    assert.equal(new Set(alle).size, 33);
    assert.equal(alle.length, 33);
});

test('produksjonsmål avvises uten --confirm', () => {
    const r = sjekkDatabase(PROD_DB, { bekreftet: undefined, godkjentEnv: '1' });
    assert.equal(r.ok, false);
    assert.match(r.grunn, /confirm/);
});

test('produksjonsmål avvises uten LEDGER_BACKFILL_APPROVED=1', () => {
    const r = sjekkDatabase(PROD_DB, { bekreftet: PROD_DB, godkjentEnv: undefined });
    assert.equal(r.ok, false);
    assert.match(r.grunn, /LEDGER_BACKFILL_APPROVED/);
});

test('produksjonsmål tillates bare med begge bekreftelser', () => {
    const r = sjekkDatabase(PROD_DB, { bekreftet: PROD_DB, godkjentEnv: '1' });
    assert.equal(r.ok, true);
});

test('testdatabase tillates uten prod-bekreftelse', () => {
    const r = sjekkDatabase('finnbilglass-ledger-test-123', {});
    assert.equal(r.ok, true);
});

test('tomt databasenavn avvises', () => {
    for (const v of ['', '   ', undefined, null]) {
        const r = sjekkDatabase(v, { bekreftet: 'x', godkjentEnv: '1' });
        assert.equal(r.ok, false);
    }
});

test('fingeravtrykk er rekkefølge-uavhengig', () => {
    const a = fingeravtrykk(['b', 'a', 'c']);
    const b = fingeravtrykk(['c', 'a', 'b']);
    assert.equal(a, b);
    assert.notEqual(a, fingeravtrykk(['a', 'b']));
});
