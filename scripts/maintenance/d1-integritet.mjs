#!/usr/bin/env node
/**
 * d1-integritet.mjs — ekte databaseintegritet for et ISOLERT D1-miljø.
 *
 * D1 avviser `PRAGMA integrity_check` via API (SQLITE_AUTH), så vi eksporterer
 * databasen og kjører sjekken lokalt med sqlite3. Aldri mot produksjon uten
 * eksplisitt flagg.
 *
 * Bruk:
 *   node scripts/maintenance/d1-integritet.mjs --database <navn>
 *   node scripts/maintenance/d1-integritet.mjs --database finnbilglass-db --allow-production
 *
 * Kjøres ALDRI fra CI: den trenger Cloudflare-tilgang og en ekte database.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROD_DB = 'finnbilglass-db';
export const ACCOUNT_ID = '80d5b1d56a3e907150ba7348b6182894';

/** Fail-closed: produksjon krever eksplisitt flagg. */
export function sjekkMal(navn, { allowProduction } = {}) {
    if (typeof navn !== 'string' || !navn.trim()) return { ok: false, grunn: 'databasenavn mangler' };
    if (navn === PROD_DB && allowProduction !== true) {
        return { ok: false, grunn: 'produksjon krever --allow-production (destruktivt nei, men les hele prod)' };
    }
    return { ok: true, grunn: '' };
}

function wrangler(args) {
    return execFileSync('npx', ['wrangler', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
        maxBuffer: 64 * 1024 * 1024,
    });
}

function main() {
    const argv = process.argv.slice(2);
    const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : undefined; };
    const db = arg('database');
    const allowProduction = argv.includes('--allow-production');

    const vakt = sjekkMal(db, { allowProduction });
    if (!vakt.ok) { console.error(`AVVIST: ${vakt.grunn}`); process.exit(2); }

    const dir = mkdtempSync(join(tmpdir(), 'fbg-d1int-'));
    const sqlFil = join(dir, 'dump.sql');
    const dbFil = join(dir, 'dump.db');

    try {
        console.log(`eksporterer ${db} …`);
        wrangler(['d1', 'export', db, '--remote', '--output', sqlFil]);
        if (!existsSync(sqlFil)) throw new Error('eksporten ga ingen fil');

        console.log('importerer i lokal sqlite …');
        execFileSync('sqlite3', [dbFil], {
            input: execFileSync('cat', [sqlFil], { maxBuffer: 256 * 1024 * 1024 }),
            maxBuffer: 256 * 1024 * 1024,
        });

        const integ = execFileSync('sqlite3', [dbFil, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim();
        const fk = execFileSync('sqlite3', [dbFil, 'PRAGMA foreign_key_check;'], { encoding: 'utf8' }).trim();
        const tabeller = execFileSync(
            'sqlite3', [dbFil, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"],
            { encoding: 'utf8' }
        ).trim();

        console.log(`tabeller        : ${tabeller}`);
        console.log(`integrity_check : ${integ}`);
        console.log(`foreign_key     : ${fk ? `${fk.split('\n').length} avvik` : '0 avvik'}`);

        if (integ !== 'ok' || fk) {
            console.error('INTEGRITET FEILET');
            process.exit(1);
        }
        console.log('INTEGRITET OK');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

if (process.argv[1] && process.argv[1].endsWith('d1-integritet.mjs')) main();
