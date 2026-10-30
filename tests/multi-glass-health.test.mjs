import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.ts';

test('health liveness succeeds without any database access', async () => {
  let calls = 0;
  const env = { FINNBILGLASS_DB: { prepare() { calls++; throw new Error('database must not be read by health'); } } };
  const response = await worker.fetch(new Request('https://example.test/health'), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls, 0);
});
