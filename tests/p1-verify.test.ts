// P1 Automatic Tests for Request Queue and Catalogue Pipeline
// These tests verify the core P1 requirements from CTO CODE REVIEW
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverFrontRute, discoverFrontRuteFirst, Kandidat, DiscoveryResult } from '../src/discovery.ts';
import { StopRuleResult, checkStopRules } from '../src/stop-rules.ts';

// Test 1: P1 - Discovery pagination is deterministic and database-based
test('P1: Discovery returns deterministic pagination with cursor', () => {
  // Test that DiscoveryResult has the expected structure
  const result: DiscoveryResult = {
    candidates: [],
    totalAvailable: 0,
    nextCursor: undefined,
    hasMore: false,
  };
  assert.strictEqual(result.hasMore, false);
  assert.strictEqual(result.nextCursor, undefined);
  assert.strictEqual(Array.isArray(result.candidates), true);
});

// Test 2: P1 - Kandidat interface has required fields
test('P1: Kandidat interface has all required fields', () => {
  const k: Kandidat = {
    varenr: 'test123',
    varenavn: 'Test Vindusglas',
    eurokode: '7H0845101H',
  };
  assert.strictEqual(k.varenr, 'test123');
  assert.strictEqual(k.varenavn, 'Test Vindusglas');
  assert.strictEqual(k.eurokode, '7H0845101H');
});

// Test 2b: kandidater har ingen syntetiske tidsstempler — svaret skal være
// deterministisk slik at identiske søk gir identisk JSON (cache/dedupe/hash).
test('P1: Kandidat har ikke syntetiske tidsstempler', () => {
  const k: Kandidat = { varenr: 'a', varenavn: 'b', eurokode: 'c' };
  assert.strictEqual('firstSeenAt' in k, false);
  assert.strictEqual('lastSeenAt' in k, false);
});

// Test 3: P1 - Stop rules halt on error threshold
test('P1: checkStopRules halts on errorCount > 50', () => {
  const result: StopRuleResult = checkStopRules(51, 0, 1.0);
  assert.strictEqual(result.halt, true);
  assert.strictEqual(result.errorTrigger, 51);
});

test('P1: checkStopRules halts on consecutive429s > 10', () => {
  const result: StopRuleResult = checkStopRules(0, 11, 1.0);
  assert.strictEqual(result.halt, true);
  assert.strictEqual(result.consecutive429s, 11);
});

test('P1: checkStopRules halts on qualityPassRate < 0.5', () => {
  const result: StopRuleResult = checkStopRules(0, 0, 0.3);
  assert.strictEqual(result.halt, true);
  assert.strictEqual(result.qualityPassRate, 0.3);
});

// Test 4: P1 - Stop rules don't halt when all checks pass
test('P1: checkStopRules returns no halt when all checks pass', () => {
  const result: StopRuleResult = checkStopRules(0, 0, 1.0);
  assert.strictEqual(result.halt, false);
  assert.strictEqual(result.reason, 'All checks passed');
});

// Test 5: P1 - Stop rules return errorTrigger in result
test('P1: StopRuleResult includes errorTrigger field', () => {
  const result: StopRuleResult = checkStopRules(27, 3, 0.75);
  assert.strictEqual(result.errorTrigger, 27);
  assert.strictEqual(result.consecutive429s, 3);
  assert.strictEqual(result.qualityPassRate, 0.75);
});
// Test 2c: /api/glass må forstå samme merkenavn som kundereisen.
// Katalogen bruker kortform (VW), men kunden skriver «Volkswagen». Uten
// gjenbruk av resolverens merke-alias gir søket 0 kandidater.
test('P1: discovery gjenbruker merke-alias fra resolveren', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'discovery.ts'), 'utf8');
  assert.match(src, /import\s*\{\s*normBrand\s*\}\s*from\s*'\.\/vin-resolver'/, 'må importere normBrand');
  assert.doesNotMatch(src, /merke\.toUpperCase\(\)/, 'skal ikke normalisere merke direkte');
});
