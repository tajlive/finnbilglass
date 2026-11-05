import {test} from 'node:test';
import assert from 'node:assert/strict';
import {priceLines, deliveryStatus, tokenFor, tokenValid, verifyWebhook} from '../src/ops-workbench/domain.ts';
test('money: exact ore, quantities and VAT; client totals ignored',()=>{
 const q=priceLines([{description:'Glass',quantity:1,price:'3357,81'},{description:'Frakt',quantity:1,price:'500.00'}]);
 assert.equal(q.totalOre,385781);assert.equal(q.vatOre+q.netOre,q.totalOre);
 assert.throws(()=>priceLines([{description:'x',quantity:1,price:'-1'}]));
 assert.throws(()=>priceLines([{description:'x',quantity:0,price:'1'}]));
 assert.throws(()=>priceLines([{description:'x',quantity:1,price:'1.001'}]));
});
test('delivery states do not regress after terminal event',()=>{
 assert.equal(deliveryStatus('DELIVERED','email.sent'),'DELIVERED');
 assert.equal(deliveryStatus('BOUNCED','email.delivered'),'BOUNCED');
 assert.equal(deliveryStatus('SENT','email.delivered'),'DELIVERED');
});
test('offer token authenticates exact id; missing secret fails closed',async()=>{
 const token=await tokenFor('q123','test-secret-that-is-long-enough-12345');
 assert.equal(await tokenValid(token,'test-secret-that-is-long-enough-12345'),'q123');
 assert.equal(await tokenValid(token.replace('q123','q124'),'test-secret-that-is-long-enough-12345'),null);
 assert.equal(await tokenValid(token,undefined),null);
});
test('webhook rejects unsigned, stale and tampered payload',async()=>{
 assert.equal(await verifyWebhook('{}',new Headers(),undefined),false);
 assert.equal(await verifyWebhook('{}',new Headers({'svix-id':'x','svix-timestamp':'1','svix-signature':'v1,abc'}),'whsec_dGVzdA=='),false);
});
