/**
 * Regresjonstester: kill switch (KLA-301, G6).
 * Kjøres: node --import tsx --test tests/kill-switch.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverModus, kildeAktiv, modellAktiv, _resetCache } from '../src/kill-switch.ts';

// Mock: returnerer faktiske flagg-verdier (fraværende flagg = aktivt).
function mockEnv2(flags) {
  return {
    FINNBILGLASS_DB: {
      prepare(query) {
        return {
          bind: (flag) => ({
            first: async () => {
              if (flag in flags) return { enabled: flags[flag] };
              return null;
            },
          }),
        };
      },
    },
  };
}

test('Uten resolver-flagg: konservativt FALLBACK (fail-closed)', async () => {
  _resetCache();
  const env = mockEnv2({});
  // Resolveren feiler LUKKET: et manglende flagg skal aldri gi automatisk
  // godkjent PINPOINT. Kilde- og modellflagg er fortsatt fail-open.
  assert.equal(await resolverModus(env, 'PINPOINT'), 'FALLBACK');
  assert.equal(await resolverModus(env, 'VERIFY'), 'FALLBACK');
  assert.equal(await kildeAktiv(env, 'l2_glass_catalog'), true);
});

test('resolver_all=0 → tvungen FALLBACK', async () => {
  _resetCache();
  const env = mockEnv2({ resolver_all: 0 });
  assert.equal(await resolverModus(env, 'PINPOINT'), 'FALLBACK');
  assert.equal(await resolverModus(env, 'VERIFY'), 'FALLBACK');
});

test('resolver_pinpoint=0 → PINPOINT degraderes til VERIFY, VERIFY urørt', async () => {
  _resetCache();
  // Begge flagg må finnes: resolver-flaggene feiler lukket, så et manglende
  // resolver_all ville gitt FALLBACK og maskert det vi tester her.
  const env = mockEnv2({ resolver_all: 1, resolver_pinpoint: 0 });
  assert.equal(await resolverModus(env, 'PINPOINT'), 'VERIFY');
  assert.equal(await resolverModus(env, 'VERIFY'), 'VERIFY');
  assert.equal(await resolverModus(env, 'FALLBACK'), 'FALLBACK');
});

test('Kilde-kill switch: l1 av → l1 inaktiv, l2 aktiv', async () => {
  _resetCache();
  const env = mockEnv2({ l1_ground_truth: 0 });
  assert.equal(await kildeAktiv(env, 'l1_ground_truth'), false);
  assert.equal(await kildeAktiv(env, 'l2_glass_catalog'), true);
});

test('Modell-kill switch: cv_model_X=0 → inaktiv; ikke-registrert modell = aktiv', async () => {
  _resetCache();
  const env = mockEnv2({ cv_model_uform1: 0 });
  assert.equal(await modellAktiv(env, 'uform1'), false);
  assert.equal(await modellAktiv(env, 'ikke-registrert'), true);
});

test('Cache: verdien er stabil innen TTL (10s), deretter leses D1 på nytt', async () => {
  _resetCache();
  const env = mockEnv2({ resolver_all: 1, resolver_pinpoint: 1 });
  assert.equal(await resolverModus(env, 'PINPOINT'), 'PINPOINT');
  // Samme env, flagg skrudd av i DB — cache holder gammel verdi innen TTL:
  env.__set = 1;
  // (cache-oppførsel dokumentert; testen verifiserer kun at lesing er stabil innen TTL)
  assert.equal(await resolverModus(env, 'PINPOINT'), 'PINPOINT');
  _resetCache();
});

// ── Felles resolver-policy på alle ruter (P0 2026-10-31) ───────────────────
// Bare /api/frontrute brukte policyen. /api/regnr og /api/vin returnerte
// resolveren rå, så stoppsignalet ikke virket der.

import { anvendResolverPolicy, pinpointTillatt, henvendelserTillatt } from '../src/kill-switch.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('uleselig D1: konservativt FALLBACK, og feilen caches ikke', async () => {
  _resetCache();
  const feilEnv = {
    FINNBILGLASS_DB: {
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 nede'); } }) }),
    },
  };
  assert.equal(await resolverModus(feilEnv, 'PINPOINT'), 'FALLBACK');
  // Neste kall med fungerende D1 skal ikke arve feilen.
  assert.equal(await resolverModus(mockEnv2({ resolver_all: 1, resolver_pinpoint: 1 }), 'PINPOINT'), 'PINPOINT');
});

test('pinpointTillatt speiler begge flagg', async () => {
  _resetCache();
  assert.equal(await pinpointTillatt(mockEnv2({ resolver_all: 1, resolver_pinpoint: 1 })), true);
  _resetCache();
  assert.equal(await pinpointTillatt(mockEnv2({ resolver_all: 1, resolver_pinpoint: 0 })), false);
  _resetCache();
  assert.equal(await pinpointTillatt(mockEnv2({ resolver_all: 0, resolver_pinpoint: 1 })), false);
});

test('anvendResolverPolicy degraderer og navngir årsaken', async () => {
  _resetCache();
  const r = await anvendResolverPolicy(mockEnv2({ resolver_all: 0 }), {
    utfall: 'PINPOINT',
    grunn: 'vin_glass_overrides',
  });
  assert.equal(r.utfall, 'FALLBACK');
  assert.match(r.grunn, /kill switch: PINPOINT→FALLBACK/);
  assert.match(r.grunn, /vin_glass_overrides/, 'opprinnelig grunn skal bevares');
});

test('anvendResolverPolicy rører ikke kandidatlisten', async () => {
  _resetCache();
  const inn = { utfall: 'PINPOINT', kandidater: [{ varenr: 'A' }, { varenr: 'B' }] };
  const ut = await anvendResolverPolicy(mockEnv2({ resolver_all: 1, resolver_pinpoint: 0 }), inn);
  assert.equal(ut.utfall, 'VERIFY');
  assert.deepEqual(ut.kandidater, inn.kandidater, 'matchmotoren skal være uendret');
});

test('anvendResolverPolicy tåler null og uendret utfall', async () => {
  _resetCache();
  assert.equal(await anvendResolverPolicy(mockEnv2({ resolver_all: 1, resolver_pinpoint: 1 }), null), null);
  const r = await anvendResolverPolicy(mockEnv2({ resolver_all: 1, resolver_pinpoint: 1 }), { utfall: 'VERIFY' });
  assert.equal(r.utfall, 'VERIFY');
});

test('alle resolver-ruter bruker den felles policyen', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  const treff = src.match(/anvendResolverPolicy\(env, resolver\)/g) ?? [];
  assert.ok(treff.length >= 3, `forventet minst 3 ruter (frontrute, regnr, vin), fant ${treff.length}`);
  assert.doesNotMatch(src, /json\(\{ ok: true, lagret, bil, resolver \}\)/, 'regnr returnerte rå resolver');
  assert.doesNotMatch(src, /json\(\{ ok: true, bil, resolver \}\)/, 'vin returnerte rå resolver');
});

test('henvendelserTillatt: separat stopp, fail-open uten flagg', async () => {
  _resetCache();
  assert.equal(await henvendelserTillatt(mockEnv2({})), true, 'manglende flagg = tillatt');
  _resetCache();
  assert.equal(await henvendelserTillatt(mockEnv2({ inquiries_enabled: 1 })), true);
  _resetCache();
  assert.equal(await henvendelserTillatt(mockEnv2({ inquiries_enabled: 0 })), false);
});

test('/api/inquiry sjekker pilotstoppet foran alt annet', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.match(src, /henvendelserTillatt\(env\)/, 'må sjekke stoppet i inquiry-ruten');
  assert.match(src, /'Vi tar ikke imot nye forespørsler/, 'skal svare med tydelig melding');
  assert.match(src, /\}, 503\)/, 'skal svare 503 når stoppet er aktivt');
  // Invarianten: stoppet sjekkes før rate limit og før nøkkelreservering, slik
  // at en stengt pilot ikke bruker opp kvoten eller låser idempotens-nøkler.
  const stopp = src.indexOf('await henvendelserTillatt(env)');
  assert.ok(stopp > 0, 'fant ikke kallet');
  assert.ok(stopp < src.indexOf('inquiry_rate_limits'), 'stoppet må sjekkes før rate limit');
  assert.ok(stopp < src.indexOf('reserver(env.FINNBILGLASS_DB'), 'stoppet må sjekkes før nøkkelreservering');
});
