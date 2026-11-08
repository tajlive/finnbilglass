import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPPING_INCL_VAT_MINOR, buildLockedKustomOrder, nokToMinor, checkoutAuthorized,
  classifyKustomOrderManagement, apiBase, createKustomCheckout, createKustomHpp,
} from '../src/payments/kustom-core.ts';
const env = { ENVIRONMENT: 'staging', KUSTOM_ENABLED: 'true', KUSTOM_API_USERNAME: 'FAKE', KUSTOM_API_PASSWORD: 'FAKE' };
const input = { internalOrderId: 'ord_1234567890', amountMinor: 187375, shippingMinor: SHIPPING_INCL_VAT_MINOR, customerOrigin: 'https://finnbilglass.no', callbackToken: 'THIS_IS_AN_EXAMPLE_RANDOM_TOKEN_123456789012345' };
test('eksakt 699 + 25% frakt og laast total', () => {
  const order = buildLockedKustomOrder(input);
  assert.equal(order.order_amount, 187375);
  assert.equal(order.order_tax_amount, 37475);
  assert.deepEqual(order.order_lines.map(l=>l.total_amount), [100000,87375]);
  assert.equal(order.merchant_reference1, input.internalOrderId);
  assert.equal(nokToMinor(1873.75), 187375);
  assert.equal(nokToMinor(873.75), 87375);
});
test('avviser endret totalsum og feil frakt', () => {
  assert.throws(()=>buildLockedKustomOrder({...input, amountMinor:87375}));
  assert.throws(()=>buildLockedKustomOrder({...input, shippingMinor:69900}));
  assert.throws(()=>nokToMinor(123.456));
});
test('staging krever enable; prod krever ekstra eksplisitt godkjenning', () => {
  assert.equal(apiBase(env),'https://api.playground.kustom.co');
  assert.throws(()=>apiBase({...env, ENVIRONMENT:'production'}));
  assert.throws(()=>apiBase({...env, KUSTOM_ENABLED:'false'}));
});
test('hpp completion = autorisert, ikke betalt', () => {
  const ids = { internalOrderId:'ord_1234567890',amountMinor:187375,kustomOrderId:'48fa4f0f-b269-4b02-9e8c-71704199cc10',sessionId:'1f45bd80-9091-4b41-814e-205f787f5500' };
  const session = { session_id:ids.sessionId,order_id:ids.kustomOrderId,status:'COMPLETED' };
  const checkout = { order_id:ids.kustomOrderId,status:'checkout_complete', order_amount:187375,purchase_currency:'NOK',merchant_reference1:ids.internalOrderId };
  assert.equal(checkoutAuthorized(ids,session,checkout),true);
  assert.equal(checkoutAuthorized(ids,session,{...checkout,order_amount:187374}),false);
  assert.equal(checkoutAuthorized(ids,{...session,status:'IN_PROGRESS'},checkout),false);
  assert.equal(classifyKustomOrderManagement({status:'AUTHORIZED',captured_amount:0,refunded_amount:0,original_order_amount:187375,purchase_currency:'NOK'},187375),'AUTHORIZED');
  assert.equal(classifyKustomOrderManagement({status:'CAPTURED',captured_amount:187375,refunded_amount:0,original_order_amount:187375,purchase_currency:'NOK'},187375),'PAID');
  assert.equal(classifyKustomOrderManagement({status:'CAPTURED',captured_amount:187375,refunded_amount:187375,original_order_amount:187375,purchase_currency:'NOK'},187375),'REFUNDED');
});
test('Kustom HTTP: ordre og HPP blir laget i riktig rekkefolge', async () => {
  const orig = globalThis.fetch;
  const calls=[];
  const oid='48fa4f0f-b269-4b02-9e8c-71704199cc10';
  const sid='1f45bd80-9091-4b41-814e-205f787f5500';
  try {
    globalThis.fetch=async (url,init)=>{
      calls.push({url:String(url), body: JSON.parse(String(init.body))});
      if (calls.length===1) return Response.json({order_id:oid}, {status:201});
      return Response.json({session_id:sid, redirect_url:'https://pay.klarna.com/eu/hpp/payments/example'}, {status:201});
    };
    const ko=await createKustomCheckout(env,buildLockedKustomOrder(input));
    const hpp=await createKustomHpp(env,ko,input.customerOrigin,input.callbackToken);
    assert.equal(ko,oid);assert.equal(hpp.sessionId,sid);
    assert.match(calls[0].url,/playground\.kustom\.co\/checkout\/v3\/orders/);
    assert.match(calls[1].url,/playground\.kustom\.co\/hpp\/v1\/sessions/);
    assert.match(calls[1].body.payment_session_url,new RegExp(oid));
  } finally {globalThis.fetch=orig;}
});
