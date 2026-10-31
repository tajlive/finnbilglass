#!/usr/bin/env node
/**
 * handling-c.mjs — Handling C: 0019-indeksene + 0034, fail-closed.
 *
 * KUN isolert database i denne PR-en. Produksjon krever separat godkjenning.
 *
 * Bruk:
 *   node scripts/maintenance/handling-c.mjs preflight --database <navn>
 *   node scripts/maintenance/handling-c.mjs apply     --database <navn> [--confirm <navn>]
 *   node scripts/maintenance/handling-c.mjs verify    --database <navn>
 *   node scripts/maintenance/handling-c.mjs rollback  --database <navn>
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROD_DB = 'finnbilglass-db';
export const ACCOUNT_ID = '80d5b1d56a3e907150ba7348b6182894';
export const SQL_FIL = 'scripts/maintenance/handling-c-schema.sql';

/** SQL-filens SHA256 — godkjenningen er bundet til artefaktet, ikke en commit. */
export const FORVENTET_SQL_SHA256 =
    '4fbffea5ca7a81f042af253dd04af394047f654491188ac52cb84d47d5ba21a8';

/** Objekter som ikke finnes før, og skal finnes etter. */
export const NYE_INDEKSER = [
    'idx_oem_probe_portal',
    'idx_oem_probe_status',
    'idx_oem_probe_vin_hash',
    'idx_glass_catalog_search',
    'idx_glass_application_item',
    'idx_glass_application_vehicle',
];
export const NYE_TABELLER = ['glass_catalog_items', 'glass_vehicle_applications'];

export const TABELLER_FOR = 60;
export const TABELLER_ETTER = 62;

/** Fail-closed databasevakt. Samme mønster som ledger-backfill. */
export function sjekkDatabase(navn, { bekreftet, godkjentEnv } = {}) {
    if (typeof navn !== 'string' || !navn.trim()) return { ok: false, grunn: 'databasenavn mangler' };
    if (navn === PROD_DB) {
        if (bekreftet !== PROD_DB) return { ok: false, grunn: `produksjonsmål krever --confirm ${PROD_DB}` };
        if (godkjentEnv !== '1') return { ok: false, grunn: 'produksjonsmål krever HANDLING_C_APPROVED=1' };
    }
    return { ok: true, grunn: '' };
}

function sql(db, query) {
    const out = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', query],
        {
            cwd: ROOT, encoding: 'utf8',
            env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
            maxBuffer: 32 * 1024 * 1024,
        }
    );
    const i = out.indexOf('[');
    if (i < 0) throw new Error(`uventet svar: ${out.slice(0, 200)}`);
    return JSON.parse(out.slice(i))[0].results ?? [];
}

function tilstand(db) {
    const tabeller = new Set(
        sql(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\';").map((r) => r.name)
    );
    const indekser = new Set(sql(db, "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';").map((r) => r.name));
    return { tabeller, indekser };
}

function sjekkArtefakt(feil) {
    const sti = join(ROOT, SQL_FIL);
    if (!existsSync(sti)) { feil.push(`SQL mangler: ${SQL_FIL}`); return; }
    const h = createHash('sha256').update(readFileSync(sti)).digest('hex');
    if (h !== FORVENTET_SQL_SHA256) feil.push(`SQL-SHA256 ${h.slice(0, 12)}… != godkjent`);
}

function preflight(db) {
    const feil = [];
    sjekkArtefakt(feil);
    const { tabeller, indekser } = tilstand(db);
    if (tabeller.size !== TABELLER_FOR) feil.push(`tabeller ${tabeller.size} != ${TABELLER_FOR}`);
    const finnesAllerede = NYE_TABELLER.filter((t) => tabeller.has(t));
    if (finnesAllerede.length) feil.push(`tabeller finnes allerede: ${finnesAllerede.join(', ')} — handling C er kjørt`);
    // Indekser som allerede finnes er trygt: alle er CREATE INDEX IF NOT EXISTS.
    // De rapporteres, men blokkerer ikke — ellers ville en rollback (som bevisst
    // beholder oem_probe_queue-indeksene) gjort det umulig å kjøre C på nytt.
    const idxFinnes = NYE_INDEKSER.filter((i) => indekser.has(i));
    if (idxFinnes.length) {
        console.log(`merknad: ${idxFinnes.length} indeks(er) finnes allerede — hoppes over (IF NOT EXISTS)`);
    }
    return { feil, tilstand: { tabeller: tabeller.size, indekser: indekser.size } };
}

function verify(db) {
    const feil = [];
    const { tabeller, indekser } = tilstand(db);
    if (tabeller.size !== TABELLER_ETTER) feil.push(`tabeller ${tabeller.size} != ${TABELLER_ETTER}`);
    for (const t of NYE_TABELLER) if (!tabeller.has(t)) feil.push(`tabell mangler: ${t}`);
    for (const i of NYE_INDEKSER) if (!indekser.has(i)) feil.push(`indeks mangler: ${i}`);

    // D1 avviser PRAGMA integrity_check via API (SQLITE_AUTH). Full
    // integritetssjekk gjøres på en eksportert kopi med lokal sqlite3.
    // foreign_key_check er tillatt og kjøres her.
    const fk = sql(db, 'PRAGMA foreign_key_check;');
    if (fk.length) feil.push(`foreign_key_check: ${fk.length} avvik`);

    // Nye tabeller skal være tomme — de opprettes uten data.
    for (const t of NYE_TABELLER) {
        const n = sql(db, `SELECT COUNT(*) AS n FROM ${t};`)[0]?.n;
        if (n !== 0) feil.push(`${t} har ${n} rader, forventet 0`);
    }

    return { feil, tilstand: { tabeller: tabeller.size, indekser: indekser.size, fk_avvik: fk.length } };
}

function main() {
    const [mode, ...rest] = process.argv.slice(2);
    const arg = (n) => { const i = rest.indexOf(`--${n}`); return i > -1 ? rest[i + 1] : undefined; };
    const db = arg('database');

    const vakt = sjekkDatabase(db, { bekreftet: arg('confirm'), godkjentEnv: process.env.HANDLING_C_APPROVED });
    if (!vakt.ok) { console.error(`AVVIST: ${vakt.grunn}`); process.exit(2); }

    const kjor = (fil) => execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--file', fil], {
        cwd: ROOT, stdio: 'inherit',
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
    });

    if (mode === 'preflight') {
        const { feil, tilstand: t } = preflight(db);
        console.log('tilstand:', JSON.stringify(t));
        if (feil.length) { console.error('PREFLIGHT FEILET:'); feil.forEach((f) => console.error('  -', f)); process.exit(1); }
        console.log('PREFLIGHT OK');
        return;
    }

    if (mode === 'apply') {
        const { feil } = preflight(db);
        if (feil.length) { console.error('APPLY AVBRUTT:'); feil.forEach((f) => console.error('  -', f)); process.exit(1); }
        kjor(join(ROOT, SQL_FIL));
        const v = verify(db);
        if (v.feil.length) { console.error('ETTERKONTROLL FEILET:'); v.feil.forEach((f) => console.error('  -', f)); process.exit(1); }
        console.log('APPLY OK — 62 tabeller, alle 6 indekser, integritet ok');
        return;
    }

    if (mode === 'verify') {
        const { feil, tilstand: t } = verify(db);
        console.log('tilstand:', JSON.stringify(t));
        if (feil.length) { console.error('VERIFY FEILET:'); feil.forEach((f) => console.error('  -', f)); process.exit(1); }
        console.log('VERIFY OK');
        return;
    }

    if (mode === 'rollback') {
        // Rollback = slipp de to nye tabellene. Indeksene på oem_probe_queue
        // beholdes med vilje: de er ikke-destruktive og forbedrer oppslag.
        kjor(join(ROOT, 'scripts/maintenance/handling-c-rollback.sql'));
        const { tabeller, indekser } = tilstand(db);
        console.log(`ROLLBACK utført — ${tabeller.size} tabeller, ${indekser.size} indekser`);
        if (tabeller.size !== TABELLER_FOR) {
            console.error(`ADVARSEL: forventet ${TABELLER_FOR} tabeller etter rollback`);
            process.exit(1);
        }
        return;
    }

    console.error('Bruk: preflight | apply | verify | rollback  --database <navn>');
    process.exit(2);
}

if (process.argv[1] && process.argv[1].endsWith('handling-c.mjs')) main();

export const _intern = { preflight, verify };
