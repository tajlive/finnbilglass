/**
 * Pilot-invitasjoner — P0 adgangskontroll.
 *
 * Kontrakt:
 *   gyldig kode (unused)  → OK, atomisk markert used (parallell kan ikke dobbeltbruke)
 *   ukjent kode           → UGYLDIG
 *   allerede brukt        → BRUKT
 *   tilbakekalt           → REVOKERT
 *   opprett N             → N distinkte, 43-tegns URL-trygge koder
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genererInvitasjonskode,
  gyldigInvitasjonskode,
  brukInvitasjon,
  opprettInvitasjoner,
  tilbakekallInvitasjon,
} from '../src/invitation.ts';

/** Minimal D1-attrapp som håndhever PRIMARY KEY + status-overgang på invite_code. */
function falskDb() {
  const rader = new Map();
  return {
    rader,
    prepare(sql) {
      let args = [];
      return {
        bind(...v) { args = v; return this; },
        async run() {
          if (sql.includes('INSERT INTO pilot_invitations')) {
            const [code, status, naa, by, note] = args;
            if (rader.has(code)) return { meta: { changes: 0 } };
            rader.set(code, { status, created_at: naa, used_at: null, revoked_at: null, created_by: by, note });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'used'")) {
            const [naa, code] = args;
            const r = rader.get(code);
            if (r && r.status === 'unused') { r.status = 'used'; r.used_at = naa; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("SET status = 'revoked'")) {
            const [naa, code] = args;
            const r = rader.get(code);
            if (r && r.status === 'unused') { r.status = 'revoked'; r.revoked_at = naa; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          return rader.get(args[0]) ?? null;
        },
      };
    },
  };
}

test('genererInvitasjonskode: 43 tegn, kun URL-trygge tegn, unik', () => {
  const a = genererInvitasjonskode();
  const b = genererInvitasjonskode();
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, 'to koder skal ikke kollidere');
});

test('gyldigInvitasjonskode: aksepterer 43-tegns URL-trygg, avviser resten', () => {
  const k = genererInvitasjonskode();
  assert.equal(gyldigInvitasjonskode(k), k);
  assert.equal(gyldigInvitasjonskode('kort'), null);
  assert.equal(gyldigInvitasjonskode(k + '!'), null, 'ulovlig tegn');
  assert.equal(gyldigInvitasjonskode(null), null);
  assert.equal(gyldigInvitasjonskode(''), null);
});

test('brukInvitasjon: unused → OK og atomisk forbrukt; parallell bruker ikke dobbelt', async () => {
  const db = falskDb();
  const kode = genererInvitasjonskode();
  db.rader.set(kode, { status: 'unused', created_at: 1, used_at: null, revoked_at: null });

  const [r1, r2] = await Promise.all([brukInvitasjon(db, kode), brukInvitasjon(db, kode)]);
  const oks = [r1, r2].filter((r) => r.status === 'OK').length;
  const brukte = [r1, r2].filter((r) => r.status === 'BRUKT').length;
  assert.equal(oks, 1, 'nøyaktig én parallell får OK');
  assert.equal(brukte, 1, 'den andre får BRUKT');
  assert.equal(db.rader.get(kode).status, 'used');
});

test('brukInvitasjon: ukjent kode → UGYLDIG', async () => {
  const db = falskDb();
  const r = await brukInvitasjon(db, genererInvitasjonskode());
  assert.equal(r.status, 'UGYLDIG');
});

test('brukInvitasjon: tilbakekalt kode → REVOKERT', async () => {
  const db = falskDb();
  const kode = genererInvitasjonskode();
  db.rader.set(kode, { status: 'revoked', created_at: 1, used_at: null, revoked_at: 2 });
  const r = await brukInvitasjon(db, kode);
  assert.equal(r.status, 'REVOKERT');
});

test('opprettInvitasjoner: N distinkte koder med metadata', async () => {
  const db = falskDb();
  const koder = await opprettInvitasjoner(db, 5, 'ops', 'test');
  assert.equal(koder.length, 5);
  assert.equal(new Set(koder).size, 5);
  for (const k of koder) assert.match(k, /^[A-Za-z0-9_-]{43}$/);
  for (const k of koder) assert.equal(db.rader.get(k).status, 'unused');
});

test('tilbakekallInvitasjon: unused → revoked; brukt/ukjent → false', async () => {
  const db = falskDb();
  const kode = genererInvitasjonskode();
  db.rader.set(kode, { status: 'unused', created_at: 1 });
  assert.equal(await tilbakekallInvitasjon(db, kode), true);
  assert.equal(db.rader.get(kode).status, 'revoked');
  assert.equal(await tilbakekallInvitasjon(db, kode), false, 'allerede revokert');
  assert.equal(await tilbakekallInvitasjon(db, genererInvitasjonskode()), false, 'ukjent');
});
