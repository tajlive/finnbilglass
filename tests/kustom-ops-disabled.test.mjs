import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCreateKustomPaymentLink,handleKustomCallback } from '../src/routes/kustom-ops.ts';
test('new Ops Kustom checkout is disabled without explicit dual gates',async()=>{
  const req=new Request('https://staging.finnbilglass.no/api/ops/inquiries/1/payment-link',{method:'POST',body:'{}'});
  const res=await handleCreateKustomPaymentLink(req,{ENVIRONMENT:'staging',KUSTOM_ENABLED:'true'} ,1);
  assert.equal(res.status,503);
});
test('public Kustom webhook is disabled by default and requires environment gates',async()=>{
  const req=new Request('https://staging.finnbilglass.no/api/kustom/push',{method:'POST'});
  const res=await handleKustomCallback(req,{ENVIRONMENT:'staging'},'push');
  assert.equal(res.status,503);
});
