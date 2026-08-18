import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsCenterUi } from '../src/ops-center-ui.js';

test('Operations Center declares that it cannot change fitment or orders', async () => {
  const body = await operationsCenterUi().text();
  assert.match(body, /kan aldri velge glass, endre fitment eller endre kundens ordre/);
  assert.match(body, /AI-støtte/);
});
