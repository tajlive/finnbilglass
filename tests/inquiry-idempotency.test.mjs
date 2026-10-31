/**
 * Idempotens for kundehenvendelser — P0 før pilot.
 *
 * Kontrakten som testes (Tom 2026-10-31):
 *   ny nøkkel                         → NY, én henvendelse
 *   samme nøkkel + identisk innhold   → REPLAY med samme inquiryId
 *   samme nøkkel + endret innhold     → KONFLIKT (409)
 *   parallell forespørsel             → PAGAR, aldri to innsendinger
 *   frigjort nøkkel                   → kan brukes på nytt
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gyldigNokkel,
  kanoniskBody,
  requestHash,
  reserver,
  fullfor,
  frigjor,
  ryddStale,
  STALE_MS,
} from '../src/inquiry-idempotency.ts';

/** Minimal D1-attrapp som håndhever PRIMARY KEY på idem_key. */
function falskDb() {
  const rader = new Map();
  return {
    rader,
    prepare(sql) {
      let args = [];
      return {
        bind(...v) { args = v; return this; },
        async run() {
          if (sql.includes('INSERT INTO inquiry_idempotency')) {
            const [key, hash, naa] = args;
            if (rader.has(key)) return { meta: { changes: 0 } };
            rader.set(key, { request_hash: hash, inquiry_id: null, state: 'PENDING', created_at: naa });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET inquiry_id = ?, state = 'DONE'")) {
            const [inquiryId, key] = args;
            const r = rader.get(key);
            if (r) { r.inquiry_id = inquiryId; r.state = 'DONE'; }
            return { meta: { changes: r ? 1 : 0 } };
          }
          if (sql.includes('SET request_hash = ?, created_at = ?')) {
            // Overtakelse av foreldet PENDING (betinget på uendret created_at).
            const [hash, naa, key, gammelTid] = args;
            const r = rader.get(key);
            if (r && r.state === 'PENDING' && r.created_at === gammelTid) {
              r.request_hash = hash; r.created_at = naa; r.inquiry_id = null;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("state = 'PENDING' AND created_at <")) {
            // ryddStale: cutoff, ikke nøkkel.
            const [cutoff] = args;
            let n = 0;
            for (const [k, r] of [...rader]) {
              if (r.state === 'PENDING' && r.created_at < cutoff) { rader.delete(k); n++; }
            }
            return { meta: { changes: n } };
          }
          if (sql.includes('DELETE FROM inquiry_idempotency')) {
            const [key] = args;
            const r = rader.get(key);
            const slett = r && r.state === 'PENDING';
            if (slett) rader.delete(key);
            return { meta: { changes: slett ? 1 : 0 } };
          }
          throw new Error(`ukjent SQL: ${sql}`);
        },
        async first() {
          return rader.get(args[0]) ?? null;
        },
      };
    },
  };
}

const BODY = { regnr: 'SU18018', navn: 'Kari Nordmann', kontakt: 'kari@example.com', melding: 'Trenger frontrute' };

test('nøkkel: avviser for kort, for lang og ugyldige tegn', () => {
  assert.equal(gyldigNokkel(null), null);
  assert.equal(gyldigNokkel('kort'), null);
  assert.equal(gyldigNokkel('a'.repeat(129)), null);
  assert.equal(gyldigNokkel('har mellomrom her'), null);
  assert.equal(gyldigNokkel('gyldig-nokkel-1234'), 'gyldig-nokkel-1234');
  assert.equal(gyldigNokkel('  550e8400-e29b-41d4-a716-446655440000  '), '550e8400-e29b-41d4-a716-446655440000');
});

test('kanonisk body: feltrekkefølge og mellomrom påvirker ikke hashen', async () => {
  const a = await requestHash({ navn: 'Kari  Nordmann', regnr: ' su18018 ', kontakt: 'kari@example.com', melding: 'Trenger frontrute' });
  const b = await requestHash({ melding: 'Trenger frontrute', kontakt: 'kari@example.com', regnr: 'SU18018', navn: 'Kari Nordmann' });
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('kanonisk body: endret innhold gir annen hash', async () => {
  const a = await requestHash(BODY);
  const b = await requestHash({ ...BODY, melding: 'Trenger bakrute' });
  assert.notEqual(a, b);
});

test('kanonisk body: ukjente felt ignoreres (diagnostikk lekker ikke inn)', () => {
  const a = kanoniskBody(BODY);
  const b = kanoniskBody({ ...BODY, intern_pris: 1234, debug: 'x' });
  assert.equal(a, b);
});

test('ny nøkkel gir NY og én reservasjon', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  assert.equal((await reserver(db, 'nokkel-12345678', h)).status, 'NY');
  assert.equal(db.rader.size, 1);
});

test('samme nøkkel + identisk innhold gir REPLAY med samme inquiryId', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  assert.equal((await reserver(db, 'nokkel-12345678', h)).status, 'NY');
  await fullfor(db, 'nokkel-12345678', 42);
  const igjen = await reserver(db, 'nokkel-12345678', h);
  assert.equal(igjen.status, 'REPLAY');
  assert.equal(igjen.inquiryId, 42);
  assert.equal(db.rader.size, 1, 'ingen ny rad');
});

test('samme nøkkel + endret innhold gir KONFLIKT etter fullført sak', async () => {
  const db = falskDb();
  const h1 = await requestHash(BODY);
  const h2 = await requestHash({ ...BODY, melding: 'Annen melding' });
  assert.equal((await reserver(db, 'nokkel-12345678', h1)).status, 'NY');
  await fullfor(db, 'nokkel-12345678', 1);
  assert.equal((await reserver(db, 'nokkel-12345678', h2)).status, 'KONFLIKT');
});

test('samme nøkkel + endret innhold mens den pågår gir PAGAR (409)', async () => {
  const db = falskDb();
  const h1 = await requestHash(BODY);
  const h2 = await requestHash({ ...BODY, melding: 'Annen melding' });
  await reserver(db, 'nokkel-12345678', h1);
  assert.equal((await reserver(db, 'nokkel-12345678', h2)).status, 'PAGAR');
});

test('parallell forespørsel gir PAGAR — aldri to innsendinger', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  const forste = await reserver(db, 'nokkel-12345678', h);
  const andre = await reserver(db, 'nokkel-12345678', h);
  assert.equal(forste.status, 'NY');
  assert.equal(andre.status, 'PAGAR');
  assert.equal(db.rader.size, 1);
});

test('frigjort nøkkel kan brukes på nytt (feilet innsending)', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  assert.equal((await reserver(db, 'nokkel-12345678', h)).status, 'NY');
  await frigjor(db, 'nokkel-12345678');
  assert.equal(db.rader.size, 0);
  assert.equal((await reserver(db, 'nokkel-12345678', h)).status, 'NY');
});

test('frigjor rører ikke en fullført nøkkel', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  await reserver(db, 'nokkel-12345678', h);
  await fullfor(db, 'nokkel-12345678', 7);
  await frigjor(db, 'nokkel-12345678');
  assert.equal(db.rader.size, 1);
  const igjen = await reserver(db, 'nokkel-12345678', h);
  assert.equal(igjen.status, 'REPLAY');
});

test('ny nøkkel ved bevisst ny innsending gir ny sak', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  await reserver(db, 'nokkel-aaaaaaaa', h);
  await fullfor(db, 'nokkel-aaaaaaaa', 1);
  assert.equal((await reserver(db, 'nokkel-bbbbbbbb', h)).status, 'NY');
  assert.equal(db.rader.size, 2);
});

// ── Kontrakts- og sikkerhetstester (statiske) ──────────────────────────────

const rot = join(import.meta.dirname, '..');

test('migrasjonen har PRIMARY KEY på idem_key (atomisk håndhevelse)', () => {
  const sql = readFileSync(join(rot, 'migrations', '0038_inquiry_idempotency.sql'), 'utf8');
  assert.match(sql, /idem_key\s+TEXT PRIMARY KEY/);
  assert.match(sql, /CHECK \(state IN \('PENDING','DONE'\)\)/);
});

test('idempotens-tabellen lagrer ikke personopplysninger', () => {
  const sql = readFileSync(join(rot, 'migrations', '0038_inquiry_idempotency.sql'), 'utf8');
  // Kun DDL-en teller — kommentarene forklarer nettopp at PII ikke lagres.
  const ddl = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  for (const pii of ['navn', 'kontakt', 'telefon', 'epost', 'email', 'melding']) {
    assert.doesNotMatch(ddl, new RegExp(`\\b${pii}\\b`, 'i'), `skal ikke lagre ${pii}`);
  }
});

test('handleren leser Idempotency-Key og beholder rate limiting', () => {
  const src = readFileSync(join(rot, 'src', 'index.ts'), 'utf8');
  assert.match(src, /request\.headers\.get\('Idempotency-Key'\)/);
  assert.match(src, /reserver\(/);
  assert.match(src, /fullfor\(/);
  assert.match(src, /frigjor\(/);
  assert.match(src, /MAX_PER_WINDOW/, 'rate limiting skal fortsatt være aktiv');
  assert.match(src, /'For mange forespørsler/, 'rate limiting skal fortsatt svare 429');
});

test('frontend sender nøkkel og fornyer den ved endret innhold', () => {
  const app = readFileSync(join(rot, 'public', 'app.js'), 'utf8');
  assert.match(app, /Idempotency-Key/);
  assert.match(app, /nyInquiryNokkel/);
  assert.match(app, /inquiryIdemKey = null/);
});

test('idempotens-logging inneholder ingen personopplysninger', () => {
  const mod = readFileSync(join(rot, 'src', 'inquiry-idempotency.ts'), 'utf8');
  const logger = mod.match(/console\.(log|info|warn|error)\([^)]*\)/g) ?? [];
  for (const linje of logger) {
    assert.doesNotMatch(linje, /body|navn|kontakt|melding/i, `logger PII: ${linje}`);
  }
});

// ── Krasj og gjenoppretting ────────────────────────────────────────────────
// En krasj mellom reservering og opprettelse skal ikke låse nøkkelen for alltid.

test('fersk PENDING gir PAGAR (parallell forespørsel pågår)', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  const naa = 1_000_000;
  await reserver(db, 'nokkel-12345678', h, naa);
  const svar = await reserver(db, 'nokkel-12345678', h, naa + 5_000);
  assert.equal(svar.status, 'PAGAR');
});

test('foreldet PENDING kan overtas — nøkkelen låses ikke permanent', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  const naa = 1_000_000;
  await reserver(db, 'nokkel-12345678', h, naa);
  const svar = await reserver(db, 'nokkel-12345678', h, naa + STALE_MS + 1);
  assert.equal(svar.status, 'OVERTATT');
});

test('overtakelse med nytt innhold gir OVERTATT, ikke KONFLIKT', async () => {
  const db = falskDb();
  const h1 = await requestHash(BODY);
  const h2 = await requestHash({ ...BODY, melding: 'Endret' });
  const naa = 1_000_000;
  await reserver(db, 'nokkel-12345678', h1, naa);
  assert.equal((await reserver(db, 'nokkel-12345678', h2, naa + STALE_MS + 1)).status, 'OVERTATT');
});

test('DONE gir REPLAY/FORTSATT KONFLIKT uansett alder', async () => {
  const db = falskDb();
  const h1 = await requestHash(BODY);
  const h2 = await requestHash({ ...BODY, melding: 'Endret' });
  await reserver(db, 'nokkel-12345678', h1, 1_000_000);
  await fullfor(db, 'nokkel-12345678', 9);
  assert.equal((await reserver(db, 'nokkel-12345678', h1, 9_999_999)).status, 'REPLAY');
  assert.equal((await reserver(db, 'nokkel-12345678', h2, 9_999_999)).status, 'KONFLIKT');
});

test('ryddStale fjerner bare foreldede PENDING-rader', async () => {
  const db = falskDb();
  const h = await requestHash(BODY);
  await reserver(db, 'gammel-nokkel-1', h, 1_000);
  await reserver(db, 'fersk-nokkel-2', h, 1_000_000);
  await fullfor(db, 'fersk-nokkel-2', 5);
  const slettet = await ryddStale(db, 1_000_000 + STALE_MS + 1);
  assert.equal(slettet, 1);
  assert.equal(db.rader.has('gammel-nokkel-1'), false);
  assert.equal(db.rader.has('fersk-nokkel-2'), true, 'fullført nøkkel skal bevares');
});

test('henvendelse og created-hendelse skrives i én batch (atomisk)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.match(src, /\.batch\(\[/);
  assert.match(src, /last_insert_rowid\(\)/, 'hendelsen må knyttes til raden i samme batch');
});

test('pilot-preflight blokkerer naar 0038 mangler', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'scripts', 'maintenance', 'pilot-preflight.mjs'), 'utf8');
  assert.match(src, /inquiry_idempotency/, 'ma sjekke idempotens-tabellen');
  assert.match(src, /PILOT BLOKKERT/);
  assert.match(src, /process\.exit\(1\)/);
  // Hver sjekk skal ha en forklarende grunn, ikke bare et feltnavn.
  assert.match(src, /grunn/);
});
