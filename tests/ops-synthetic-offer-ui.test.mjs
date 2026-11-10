import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsCenterUi } from '../src/ops-center-ui.ts';

test('manual offer UI labels synthetic recipients and does not offer a Resend action',async()=>{
  const response=operationsCenterUi();
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/dataset\.syntheticRecipient/);
  assert.match(html,/TESTSAK – ingen utsending til reservert testadresse/);
  assert.match(html,/actions=synthetic\?/);
  assert.match(html,/contact\.endsWith\('\.'\+t\)/);
});
