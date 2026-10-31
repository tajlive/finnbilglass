#!/usr/bin/env node
/**
 * ledger-backfill.mjs — Handling B: rekonsilier d1_migrations i produksjon.
 *
 * KUN etter eksplisitt Tom-godkjenning. Scriptet er fail-closed: alle
 * forhåndskontroller må passere før noe skrives, og produksjonsmålet krever
 * to uavhengige bekreftelser.
 *
 * Bruk:
 *   node scripts/maintenance/ledger-backfill.mjs preflight --database <navn>
 *   LEDGER_BACKFILL_APPROVED=1 node scripts/maintenance/ledger-backfill.mjs \
 *        apply --database finnbilglass-db --confirm finnbilglass-db
 *   node scripts/maintenance/ledger-backfill.mjs verify --database <navn>
 *
 * Ingen BEGIN/COMMIT: `wrangler d1 execute --file` sender hele filen som én
 * batch, som D1 gjør atomisk. Eksplisitt transaksjonsstyring feiler i D1.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROD_DB = 'finnbilglass-db';
export const ACCOUNT_ID = '80d5b1d56a3e907150ba7348b6182894';

/** Produksjonens skjema-fingerprint. Endres den, er vi på feil database. */
export const FORVENTET_FINGERPRINT =
    'dfeb735a28690108a740ad474128dcacbabfd5ef25295268de2a2863ccab4ea8';
export const FORVENTET_TABELLER = 60;

/** De 18 radene som skal finnes FØR backfill. */
export const BASELINE_LEDGER = [
    '0001_resolver_tables.sql', '0002_staging_baseline.sql', '0003_vin_glass_overrides.sql',
    '0004_canonical_glass_master.sql', '0005_feature_flags.sql', '0006_image_resolver.sql',
    '0007_b2b_sync.sql', '0008_tecdoc_snapshot_import.sql', '0009_ece_r43.sql',
    '0010_opplaering.sql', '0011_assistant_sessions.sql', '0012_evidence_ledger.sql',
    '0013_evidence_capture_v01.sql', '0014_support_evidence_workflow.sql',
    '0016_evidence_image_quality.sql', '0017_beta_inquiries.sql',
    '0035_inquiry_glass_request.sql', '0036_glass_search_snapshots.sql',
];

/** De 15 som skal legges til. */
export const BACKFILL = [
    '0018_beta_inquiries_ops.sql', '0019_inquiry_rate_limit.sql',
    '0021_manual_review_overrides.sql', '0022_glass_marking_and_sku_decisions.sql',
    '0023_glass_sku_attributes.sql', '0024_opplaering_thumbnail.sql',
    '0025_ai_observasjon_review.sql', '0026_evidence_thumbnail.sql',
    '0027_quality_events_fk_fix.sql', '0028_inquiry_commercial.sql',
    '0029_voice_lab.sql', '0030_voice_lab_tuning.sql', '0031_glass_reference.sql',
    '0032_glass_prisliste_lookup_indexes.sql', '0033_inquiry_reply_history.sql',
];

/** Skal aldri registreres som anvendt. */
export const ALDRI_REGISTRER = [
    '0019_oem_probe_queue.sql',   // delvis anvendt
    '0020_oem_probe_queue_fix.sql', // BLOCKED_DESTRUCTIVE
    '0034_glass_catalog_multi.sql', // PENDING
];

/**
 * Fail-closed databasevakt. Returnerer { ok, grunn }.
 * Eksportert slik at CI kan teste den uten nettverk.
 */
export function sjekkDatabase(navn, { bekreftet, godkjentEnv }) {
    if (typeof navn !== 'string' || !navn.trim()) {
        return { ok: false, grunn: 'databasenavn mangler' };
    }
    if (navn === PROD_DB) {
        if (bekreftet !== PROD_DB) {
            return { ok: false, grunn: `produksjonsmål krever --confirm ${PROD_DB}` };
        }
        if (godkjentEnv !== '1') {
            return { ok: false, grunn: 'produksjonsmål krever LEDGER_BACKFILL_APPROVED=1' };
        }
    }
    return { ok: true, grunn: '' };
}

/** Fingerprint av sorterte tabellnavn — samme algoritme som er målt mot prod. */
export function fingeravtrykk(tabeller) {
    return createHash('sha256').update([...tabeller].sort().join('\n')).digest('hex');
}

function sql(db, query) {
    const out = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', query],
        {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
            maxBuffer: 32 * 1024 * 1024,
        }
    );
    const start = out.indexOf('[');
    if (start < 0) throw new Error(`uventet svar fra wrangler: ${out.slice(0, 200)}`);
    const [first] = JSON.parse(out.slice(start));
    return first.results ?? [];
}

function hentTilstand(db) {
    // _cf_KV er D1 sin egen systemtabell og auto-opprettes i hver database.
    // Den er infrastruktur, ikke skjema, og holdes utenfor fingeravtrykket.
    const tabeller = sql(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name;").map((r) => r.name);
    const ledger = sql(db, 'SELECT name FROM d1_migrations ORDER BY name;').map((r) => r.name);
    return { tabeller, ledger };
}

function preflight(db, expectCommit) {
    const feil = [];
    const { tabeller, ledger } = hentTilstand(db);

    if (tabeller.length !== FORVENTET_TABELLER) {
        feil.push(`tabellcount ${tabeller.length} != ${FORVENTET_TABELLER}`);
    }
    const fp = fingeravtrykk(tabeller);
    if (fp !== FORVENTET_FINGERPRINT) {
        feil.push(`skjema-fingerprint ${fp.slice(0, 16)}… != ${FORVENTET_FINGERPRINT.slice(0, 16)}…`);
    }
    if (ledger.length !== BASELINE_LEDGER.length) {
        feil.push(`ledger har ${ledger.length} rader, forventet ${BASELINE_LEDGER.length}`);
    }
    const ledgerSet = new Set(ledger);
    const manglerBaseline = BASELINE_LEDGER.filter((n) => !ledgerSet.has(n));
    if (manglerBaseline.length) feil.push(`baseline-rader mangler: ${manglerBaseline.join(', ')}`);
    const uventet = ledger.filter((n) => !BASELINE_LEDGER.includes(n));
    if (uventet.length) feil.push(`uventede ledger-rader: ${uventet.join(', ')}`);
    const allerede = BACKFILL.filter((n) => ledgerSet.has(n));
    if (allerede.length) feil.push(`allerede registrert (backfill ikke nødvendig for): ${allerede.join(', ')}`);
    const forbudt = ALDRI_REGISTRER.filter((n) => ledgerSet.has(n));
    if (forbudt.length) feil.push(`ALDRI-REGISTRER finnes i ledgeren: ${forbudt.join(', ')}`);

    if (expectCommit) {
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
        if (!head.startsWith(expectCommit)) feil.push(`git HEAD ${head.slice(0, 8)} != forventet ${expectCommit}`);
    }

    return { feil, tilstand: { tabeller: tabeller.length, ledger: ledger.length, fingerprint: fp } };
}

function verify(db) {
    const feil = [];
    const { tabeller, ledger } = hentTilstand(db);
    const forventet = [...BASELINE_LEDGER, ...BACKFILL].sort();

    if (ledger.length !== 33) feil.push(`ledger har ${ledger.length} rader, forventet 33`);
    if (new Set(ledger).size !== ledger.length) feil.push('duplikater i ledgeren');
    const diff = ledger.filter((n) => !forventet.includes(n)).concat(forventet.filter((n) => !ledger.includes(n)));
    if (diff.length) feil.push(`avvik mot forventet sett: ${diff.join(', ')}`);
    if (tabeller.length !== FORVENTET_TABELLER) feil.push(`tabellcount endret: ${tabeller.length}`);
    if (fingeravtrykk(tabeller) !== FORVENTET_FINGERPRINT) feil.push('skjema-fingerprint endret');
    const forbudt = ALDRI_REGISTRER.filter((n) => ledger.includes(n));
    if (forbudt.length) feil.push(`ALDRI-REGISTRER i ledgeren: ${forbudt.join(', ')}`);

    return { feil, tilstand: { tabeller: tabeller.length, ledger: ledger.length } };
}

function main() {
    const [mode, ...rest] = process.argv.slice(2);
    const arg = (n) => {
        const i = rest.indexOf(`--${n}`);
        return i > -1 ? rest[i + 1] : undefined;
    };
    const db = arg('database');
    const bekreftet = arg('confirm');
    const expectCommit = arg('expect-commit');

    const vakt = sjekkDatabase(db, { bekreftet, godkjentEnv: process.env.LEDGER_BACKFILL_APPROVED });
    if (!vakt.ok) {
        console.error(`AVVIST: ${vakt.grunn}`);
        process.exit(2);
    }

    if (mode === 'preflight') {
        const { feil, tilstand } = preflight(db, expectCommit);
        console.log('tilstand:', JSON.stringify(tilstand));
        if (feil.length) {
            console.error('PREFLIGHT FEILET — ingen skriving:');
            for (const f of feil) console.error('  -', f);
            process.exit(1);
        }
        console.log('PREFLIGHT OK — klart for backfill av 15 rader');
        return;
    }

    if (mode === 'apply') {
        const { feil } = preflight(db, expectCommit);
        if (feil.length) {
            console.error('APPLY AVBRUTT — preflight feilet:');
            for (const f of feil) console.error('  -', f);
            process.exit(1);
        }
        const fil = join(ROOT, 'scripts', 'maintenance', 'ledger-backfill-15.sql');
        execFileSync(
            'npx',
            ['wrangler', 'd1', 'execute', db, '--remote', '--file', fil],
            {
                cwd: ROOT,
                stdio: 'inherit',
                env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: '' },
            }
        );
        const v = verify(db);
        if (v.feil.length) {
            console.error('ETTERKONTROLL FEILET:');
            for (const f of v.feil) console.error('  -', f);
            process.exit(1);
        }
        console.log('APPLY OK — 33 rader, 0 duplikater, skjema uendret');
        return;
    }

    if (mode === 'verify') {
        const { feil, tilstand } = verify(db);
        console.log('tilstand:', JSON.stringify(tilstand));
        if (feil.length) {
            console.error('VERIFY FEILET:');
            for (const f of feil) console.error('  -', f);
            process.exit(1);
        }
        console.log('VERIFY OK');
        return;
    }

    console.error('Bruk: preflight | apply | verify  --database <navn>');
    process.exit(2);
}

if (process.argv[1] && process.argv[1].endsWith('ledger-backfill.mjs')) main();

// Brukes av testene
export const _intern = { preflight, verify };
