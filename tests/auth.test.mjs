/**
 * Autentisering og tilgangsstyring — enhetstester (P0, Spor C).
 *
 * Dekker: magic-link (én gangs bruk, utløp, replay), økt (utløp), invitasjons-
 * binding (atomisk), roller (lesetilgang kan ikke skrive) og hash-determinisme.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genererToken,
  hashToken,
  opprettLoginToken,
  verifiserLoginToken,
  finnEllerOpprettKunde,
  opprettSesjon,
  sesjonKunde,
  slettSesjon,
  bindInvitasjon,
  adminRolle,
  kanSkrive,
} from '../src/auth.ts';

/** Minimal D1-attrapp med Map-baserte tabeller. */
function falskDb() {
  const tabeller = {
    login_tokens: new Map(),
    customers: new Map(),
    sessions: new Map(),
    pilot_invitations: new Map(),
    admin_roles: new Map(),
    admin_audit_log: new Map(),
  };
  const kunder = new Map(); // email -> id
  let nesteId = 1;
  return {
    tabeller,
    kunder,
    prepare(sql) {
      let args = [];
      return {
        bind(...v) { args = v; return this; },
        async run() {
          if (sql.startsWith('INSERT INTO login_tokens')) {
            const [hash, email, invite, created, expires] = args;
            tabeller.login_tokens.set(hash, { email, invite_code: invite ?? null, created_at: created, expires_at: expires, used_at: null });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE login_tokens SET used_at")) {
            const [naa, hash] = args;
            const r = tabeller.login_tokens.get(hash);
            if (r && r.used_at === null && r.expires_at > naa) { r.used_at = naa; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith('INSERT INTO customers')) {
            const [email, created] = args;
            const id = nesteId++; kunder.set(email, id);
            tabeller.customers.set(id, { email, invitation_code: null, created_at: created });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO sessions')) {
            const [sid, cid, created, expires] = args;
            tabeller.sessions.set(sid, { customer_id: cid, created_at: created, expires_at: expires });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM sessions')) {
            const [sid] = args; tabeller.sessions.delete(sid);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE pilot_invitations SET status = 'used'")) {
            const [naa, code] = args;
            const r = tabeller.pilot_invitations.get(code);
            if (r && r.status === 'unused') { r.status = 'used'; r.used_at = naa; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith('UPDATE customers SET invitation_code')) {
            const [code, email] = args;
            const id = kunder.get(email);
            const r = tabeller.customers.get(id);
            if (r) r.invitation_code = code;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO admin_audit_log')) return { meta: { changes: 1 } };
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('FROM login_tokens')) {
            const [hash] = args; const r = tabeller.login_tokens.get(hash);
            return r ? { email: r.email, invite_code: r.invite_code } : null;
          }
          if (sql.includes('FROM customers WHERE email')) {
            const [email] = args; const id = kunder.get(email);
            return id ? { id } : null;
          }
          if (sql.includes('FROM customers WHERE id')) {
            const [id] = args; const r = tabeller.customers.get(id);
            return r ? { id, email: r.email } : null;
          }
          if (sql.includes('FROM sessions')) {
            const [sid, naa] = args; const r = tabeller.sessions.get(sid);
            if (!r) return null;
            return r.expires_at > naa ? { customer_id: r.customer_id } : null;
          }
          if (sql.includes('FROM admin_roles')) {
            const [email] = args; const r = tabeller.admin_roles.get(email);
            return r ? { role: r.role } : null;
          }
          return null;
        },
      };
    },
  };
}

test('genererToken: 43 tegn, URL-trygg, unik', () => {
  const a = genererToken(); const b = genererToken();
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test('hashToken: deterministisk + ikke lik input', async () => {
  const h1 = await hashToken('abc'); const h2 = await hashToken('abc');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, 'abc');
});

test('magic link: verifiser én gang, replay avvises', async () => {
  const db = falskDb();
  const raw = await opprettLoginToken(db, 'kunde@example.no', 'INV123');
  const v1 = await verifiserLoginToken(db, raw);
  assert.deepEqual(v1, { email: 'kunde@example.no', inviteCode: 'INV123' });
  assert.equal(await verifiserLoginToken(db, raw), null, 'replay skal avvises');
});

test('magic link: utløpt token avvises', async () => {
  const db = falskDb();
  const naa = 1_000_000;
  const raw = await opprettLoginToken(db, 'kunde@example.no', null, naa);
  assert.equal(await verifiserLoginToken(db, raw, naa + 16 * 60 * 1000), null);
});

test('sesjon: gyldig → kunde-id, utløpt → null, slett → null', async () => {
  const db = falskDb();
  const cid = await finnEllerOpprettKunde(db, 'kunde@example.no', 1);
  const sid = await opprettSesjon(db, cid, 1000);
  assert.equal(await sesjonKunde(db, sid, 1001), cid);
  assert.equal(await sesjonKunde(db, sid, 1000 + 8 * 24 * 3600 * 1000), null, 'utløpt økt');
  await slettSesjon(db, sid);
  assert.equal(await sesjonKunde(db, sid, 1001), null, 'slettet økt');
});

test('bindInvitasjon: unused → used atomisk, dobbeltbind avvises', async () => {
  const db = falskDb();
  db.tabeller.pilot_invitations.set('INV1', { status: 'unused' });
  assert.equal(await bindInvitasjon(db, 'a@example.no', 'INV1', 5), true);
  assert.equal(db.tabeller.pilot_invitations.get('INV1').status, 'used');
  assert.equal(await bindInvitasjon(db, 'b@example.no', 'INV1', 6), false, 'dobbeltbind');
  assert.equal(await bindInvitasjon(db, 'c@example.no', 'UKJENT', 6), false, 'ukjent kode');
});

test('roller: lesetilgang kan ikke skrive, administrator/saksbehandler kan', () => {
  assert.equal(kanSkrive('administrator'), true);
  assert.equal(kanSkrive('saksbehandler'), true);
  assert.equal(kanSkrive('lesetilgang'), false);
  assert.equal(kanSkrive(null), false);
});

test('adminRolle: henter rolle, ukjent → null', async () => {
  const db = falskDb();
  db.tabeller.admin_roles.set('ansatt@finnbilglass.no', { role: 'saksbehandler' });
  assert.equal(await adminRolle(db, 'ansatt@finnbilglass.no'), 'saksbehandler');
  assert.equal(await adminRolle(db, 'ukjent@example.no'), null);
});
