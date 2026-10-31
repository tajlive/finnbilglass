/**
 * Vakt for handling C (0019-indeksene + 0034).
 *
 * Helt statisk: leser SQL-filene og konstantene. Ingen nettverk, ingen D1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NYE_INDEKSER,
    NYE_TABELLER,
    PROD_DB,
    SQL_FIL,
    FORVENTET_SQL_SHA256,
    TABELLER_FOR,
    TABELLER_ETTER,
    sjekkDatabase,
} from '../scripts/maintenance/handling-c.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL = readFileSync(join(ROOT, SQL_FIL), 'utf8');
const ROLLBACK = readFileSync(join(ROOT, 'scripts/maintenance/handling-c-rollback.sql'), 'utf8');

test('SQL lager alle 6 indekser og 2 tabeller', () => {
    assert.equal(NYE_INDEKSER.length, 6);
    assert.equal(NYE_TABELLER.length, 2);
    for (const i of NYE_INDEKSER) assert.ok(SQL.includes(i), `${i} mangler i SQL`);
    for (const t of NYE_TABELLER) assert.ok(SQL.includes(t), `${t} mangler i SQL`);
});

test('alle CREATE er idempotente (IF NOT EXISTS)', () => {
    const creates = [...SQL.matchAll(/CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+([A-Z ]*)(\w+)/gi)];
    assert.ok(creates.length >= 8, `fant bare ${creates.length} CREATE-setninger`);
    const utenIfNotExists = [...SQL.matchAll(/CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+(?!IF NOT EXISTS)/gi)];
    assert.deepEqual(utenIfNotExists.map((m) => m[0]), [], 'CREATE uten IF NOT EXISTS er ikke idempotent');
});

test('SQL har ingen transaksjonsstyring — men trigger-BEGIN er greit', () => {
    // 0034 inneholder triggere med «BEGIN SELECT RAISE(...) … END;». Det er
    // SQLite-triggersyntaks, ikke transaksjonsstyring. Vi ser derfor bare etter
    // setninger som er transaksjonskontroll alene på sin linje.
    const kode = SQL.split('\n').filter((l) => !l.trim().startsWith('--'));
    const transaksjon = kode.filter((l) =>
        /^\s*(BEGIN(\s+(TRANSACTION|DEFERRED|IMMEDIATE|EXCLUSIVE))?|COMMIT|END\s+TRANSACTION|ROLLBACK)\s*;\s*$/i.test(l)
    );
    assert.deepEqual(transaksjon, [], 'transaksjonsstyring feiler i D1');
});

test('rollback fjerner kun de to nye tabellene', () => {
    const kode = ROLLBACK.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    assert.ok(kode.includes('glass_vehicle_applications'));
    assert.ok(kode.includes('glass_catalog_items'));
    // Skal ikke røre oem_probe_queue eller dens indekser
    assert.ok(!/oem_probe_queue/i.test(kode), 'rollback skal ikke røre oem_probe_queue');
});

test('tabellforventningene er konsistente', () => {
    assert.equal(TABELLER_ETTER - TABELLER_FOR, NYE_TABELLER.length);
});

test('godkjenningen er bundet til SQL-filens SHA256', () => {
    const faktisk = createHash('sha256').update(readFileSync(join(ROOT, SQL_FIL))).digest('hex');
    assert.equal(faktisk, FORVENTET_SQL_SHA256, 'SQL-filen er endret — oppdater konstanten bevisst');
});

test('produksjonsmål avvises uten --confirm og HANDLING_C_APPROVED', () => {
    assert.equal(sjekkDatabase(PROD_DB, {}).ok, false);
    assert.equal(sjekkDatabase(PROD_DB, { bekreftet: PROD_DB }).ok, false);
    assert.equal(sjekkDatabase(PROD_DB, { bekreftet: PROD_DB, godkjentEnv: '1' }).ok, true);
});

test('testdatabase tillates uten prod-bekreftelse', () => {
    assert.equal(sjekkDatabase('finnbilglass-handling-c-test', {}).ok, true);
});
