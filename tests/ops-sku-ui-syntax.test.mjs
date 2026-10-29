import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { skuDecisionUi } from '../src/sku-decision-ui.ts';

test('/ops/sku inline scripts are valid after rendering', async () => {
  const html = await skuDecisionUi().text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const source of scripts) assert.doesNotThrow(() => new Script(source));
});
