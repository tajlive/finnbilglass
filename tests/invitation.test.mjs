/**
 * Pilot-invitasjoner — enhetstester (P0, Spor B/F).
 *
 * Dekker: hash-lagring (rå kode lagres aldri), maks-20-grense (atomisk),
 * utløp, tilbakekalling, dobbeltbruk, binding og at lister ikke lekker rå kode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genererInvitasjonskode,
  gyldigInvitasjonskode,
  hashInvitasjonskode,
  opprettInvitasjoner,
  forbrukInvitasjon,
  kodeErTilgjengelig,
  tilbakekallInvitasjon,
  listeInvitasjoner,
  MAX_PILOT_DELTAKERE,
} from '../src/invitation.ts';

/** Minimal D1-attrapp med hash-nøklet pilot_invitations-tabell. */
function falskDb() {
  const rader = new Map(); // invite_hash -> { status, created_at, used_at, revoked_at, expires_at, note, used_by_email }
  return {
    rader,
    prepare(sql) {
      let args = [];
      return {
        bind(...v) { args = v; return this; },
        async run() {
          if (sql.startsWith('INSERT INTO pilot_invitations')) {
            // Atomisk INSERT ... SELECT ... WHERE (COUNT active < MAX).
            const [hash, naa, by, note, expiresAt, naa2, max] = args;
            const aktive = [...rader.values()].filter((r) => r.status === 'unused' && (r.expires_at == null || r.expires_at > naa2)).length;
            if (aktive >= max) return { meta: { changes: 0 } };
            rader.set(hash, { status: 'unused', created_at: naa, used_at: null, revoked_at: null, expires_at: expiresAt, created_by: by, note, used_by_email: null });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'used'")) {
            const [naa, email, hash, naa2] = args;
            const r = rader.get(hash);
            if (r && r.status === 'unused' && (r.expires_at == null || r.expires_at > naa2)) {
              r.status = 'used'; r.used_at = naa; r.used_by_email = email; return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("SET status = 'revoked'")) {
            const [naa, hash] = args;
            const r = rader.get(hash);
            if (r && r.status === 'unused') { r.status = 'revoked'; r.revoked_at = naa; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('COUNT(*)')) {
            const [naa] = args;
            const n = [...rader.values()].filter((r) => r.status === 'unused' && (r.expires_at == null || r.expires_at > naa)).length;
            return { n };
          }
          if (sql.includes('FROM pilot_invitations WHERE invite_hash = ? AND status')) {
            const [hash, naa] = args;
            const r = rader.get(hash);
            if (r && r.status === 'unused' && (r.expires_at == null || r.expires_at > naa)) return { status: 'unused', expires_at: r.expires_at };
            return null;
          }
          if (sql.includes('FROM pilot_invitations WHERE invite_hash = ?')) {
            const [hash] = args; const r = rader.get(hash);
            return r ? { status: r.status, expires_at: r.expires_at } : null;
          }
          return null;
        },
        async all() {
          const ut = [...rader.entries()].map(([invite_hash, r]) => ({ invite_hash, status: r.status, created_at: r.created_at, used_at: r.used_at, revoked_at: r.revoked_at, expires_at: r.expires_at, note: r.note ?? null, used_by_email: r.used_by_email ?? null }));
          ut.sort((a, b) => b.created_at - a.created_at);
          return { results: ut };
        },
      };
    },
  };
}

test('genererInvitasjonskode: 43 tegn, URL-trygg, unik', () => {
  const a = genererInvitasjonskode(); const b = genererInvitasjonskode();
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test('gyldigInvitasjonskode: format-validering', () => {
  const k = genererInvitasjonskode();
  assert.equal(gyldigInvitasjonskode(k), k);
  assert.equal(gyldigInvitasjonskode('kort'), null);
  assert.equal(gyldigInvitasjonskode(k + '!'), null);
  assert.equal(gyldigInvitasjonskode(null), null);
});

test('hashInvitasjonskode: deterministisk, 64 hex, aldri rå kode', async () => {
  const k = genererInvitasjonskode();
  const h1 = await hashInvitasjonskode(k);
  const h2 = await hashInvitasjonskode(k);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, k);
});

test('opprettInvitasjoner: lagrer hash, returnerer kun rå koder ved opprettelse', async () => {
  const db = falskDb();
  const res = await opprettInvitasjoner(db, 3, 'ops', 'test');
  assert.equal(res.ok, true);
  assert.equal(res.koder.length, 3);
  for (const [hash, rad] of db.rader) {
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(rad.status, 'unused');
  }
  assert.ok(![...db.rader.keys()].some((h) => res.koder.includes(h)), 'rå kode skal ikke være nøkkel');
});

test('maks 20: nr 21 avvises atomisk', async () => {
  const db = falskDb();
  const res = await opprettInvitasjoner(db, 20, 'ops', 'fyll');
  assert.equal(res.ok, true);
  assert.equal(res.koder.length, 20);
  const over = await opprettInvitasjoner(db, 1, 'ops', 'over grensen');
  assert.equal(over.ok, false);
  assert.equal(over.koder.length, 0);
  assert.equal(db.rader.size, 20);
});

test('forbrukInvitasjon: unused → OK + binding; dobbeltbruk avvises', async () => {
  const db = falskDb();
  const res = await opprettInvitasjoner(db, 1, 'ops', 'x');
  const kode = res.koder[0];
  assert.equal(await forbrukInvitasjon(db, kode, 'a@example.no'), 'OK');
  assert.equal([...db.rader.values()][0].used_by_email, 'a@example.no');
  assert.equal(await forbrukInvitasjon(db, kode, 'b@example.no'), 'BRUKT', 'dobbeltbruk');
});

test('utløpt invitasjon: UTLOPT og kan ikke forbrukes', async () => {
  const db = falskDb();
  const naa = 1_000_000;
  const res = await opprettInvitasjoner(db, 1, 'ops', 'x', naa, naa + 1000);
  const kode = res.koder[0];
  assert.equal(await forbrukInvitasjon(db, kode, 'a@example.no', naa + 2000), 'UTLOPT');
  assert.equal(await kodeErTilgjengelig(db, kode, naa + 2000), false);
});

test('tilbakekallInvitasjon: unused → revoked; brukt/ukjent → false', async () => {
  const db = falskDb();
  const res = await opprettInvitasjoner(db, 1, 'ops', 'x');
  const kode = res.koder[0];
  assert.equal(await tilbakekallInvitasjon(db, kode), true);
  assert.equal([...db.rader.values()][0].status, 'revoked');
  assert.equal(await tilbakekallInvitasjon(db, kode), false, 'allerede revokert');
  assert.equal(await tilbakekallInvitasjon(db, genererInvitasjonskode()), false, 'ukjent');
});

test('listeInvitasjoner: aldri rå kode, kun hash-prefiks', async () => {
  const db = falskDb();
  const res = await opprettInvitasjoner(db, 2, 'ops', 'x');
  const liste = await listeInvitasjoner(db);
  assert.equal(liste.length, 2);
  for (const rad of liste) {
    assert.ok(rad.hash_prefix && rad.hash_prefix.length === 8);
    assert.ok(!res.koder.some((k) => JSON.stringify(rad).includes(k)), 'rå kode må ikke lekke i listen');
  }
});
