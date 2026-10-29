import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { operationsCenterUi } from '../src/ops-center-ui.ts';

test('/ops inline scripts are valid JavaScript after HTML rendering', async () => {
  const html = await operationsCenterUi().text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const [index, source] of scripts.entries()) assert.doesNotThrow(() => new Script(source), `script ${index + 1}`);
});
