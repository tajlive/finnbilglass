import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const values = [{kind:'windshield'}, {kind:'door',side:'left',door:'front'}, {kind:'side',side:'right',section:'cargo',mounting:'body'}, {kind:'rear',layout:'split',splitSide:'left'}, {kind:'ventil',side:'unknown',placement:'rear'}, {kind:'roof',system:'fixed',panel:'front'}, {kind:'unknown'}];
async function call(body: unknown) {
  const env = { FINNBILGLASS_DB: {prepare(){throw new Error('pilot must not query or write catalogue');}} };
  return worker.fetch(new Request('https://test.invalid/api/glass/kandidater',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env as any,{} as any);
}
test('quote pilot preserves manual boundary for all six classes and unknown',async()=>{
 for(const selection of values){
  const response=await call({regnr:'TEST',schemaVersion:1,selection});
  assert.equal(response.status,200); const body=await response.json() as any;
  assert.equal(body.status,'MANUAL_REVIEW'); assert.deepEqual(body.kandidater,[]);
  for(const field of ['pris','vin','source','matchReason','klassifisering']) assert.equal(Object.hasOwn(body,field),false);
 }
});
test('invalid selections and conflicting aliases fail before any database access',async()=>{
 for(const body of [null,{}, {regnr:'TEST',selection:{kind:'door',side:'unknown'}}, {regnr:'TEST',selection:{kind:'hood'}}, {regnr:'TEST',glassklasse:'roof',selection:{kind:'windshield'}}]) assert.equal((await call(body)).status,400);
});
