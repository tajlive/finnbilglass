/**
 * Access-JWT claim-validering — enhetstester (P0, Spor F, sikkerhetsretting).
 *
 * Verifiserer fail-closed: manglende exp avvises, utløpt exp avvises, feil iss
 * og feil aud avvises, og kun gyldige claims returnerer e-post.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerClaims, accessKonfigurert } from '../src/access-auth.ts';

const cfg = { teamDomain: 'tomarnejensen', aud: '5636455530f3188397dd61767b1728f59df582f645f44f7447a154b1a26c5a98' };
const iss = 'https://tomarnejensen.cloudflareaccess.com';
const now = 1_700_000_000;

test('validerClaims: gyldige claims returnerer e-post', () => {
  const r = validerClaims({ exp: now + 100, iss, aud: cfg.aud, email: 'tomarnejensen@gmail.com' }, cfg, now);
  assert.equal(r, 'tomarnejensen@gmail.com');
});

test('validerClaims: manglende exp avvises (fail-closed)', () => {
  assert.equal(validerClaims({ iss, aud: cfg.aud, email: 'a@b.no' }, cfg, now), null, 'uten exp → null');
});

test('validerClaims: utløpt exp avvises', () => {
  assert.equal(validerClaims({ exp: now - 1, iss, aud: cfg.aud, email: 'a@b.no' }, cfg, now), null);
});

test('validerClaims: feil issuer avvises', () => {
  assert.equal(validerClaims({ exp: now + 100, iss: 'https://feil.cloudflareaccess.com', aud: cfg.aud, email: 'a@b.no' }, cfg, now), null);
});

test('validerClaims: feil audience avvises', () => {
  assert.equal(validerClaims({ exp: now + 100, iss, aud: 'feil-aud', email: 'a@b.no' }, cfg, now), null);
});

test('validerClaims: nbf i fremtiden avvises (ikke gyldig ennå)', () => {
  assert.equal(validerClaims({ exp: now + 100, nbf: now + 1, iss, aud: cfg.aud, email: 'a@b.no' }, cfg, now), null);
  // nbf i fortiden er OK.
  assert.equal(validerClaims({ exp: now + 100, nbf: now - 1, iss, aud: cfg.aud, email: 'a@b.no' }, cfg, now), 'a@b.no');
});

test('validerClaims: manglende e-post avvises', () => {
  assert.equal(validerClaims({ exp: now + 100, iss, aud: cfg.aud }, cfg, now), null);
});

test('accessKonfigurert: krever både team-domene og aud', () => {
  assert.deepEqual(accessKonfigurert({ ACCESS_TEAM_DOMAIN: 'x', ACCESS_AUD: 'y' }), { teamDomain: 'x', aud: 'y' });
  assert.equal(accessKonfigurert({ ACCESS_TEAM_DOMAIN: 'x' }), null);
  assert.equal(accessKonfigurert({ ACCESS_AUD: 'y' }), null);
  assert.equal(accessKonfigurert({}), null);
});
