import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glassBodyRejection } from '../src/glass-body-compatibility.ts';
import { modellTokensAv, ordTreffKandidat } from '../src/vin-resolver.ts';
const product = 'MERCEDES GLE COUPE W167 20- WS';
test('GLE without body evidence requires clarification, not inferred SUV', () => {
 assert.ok(glassBodyRejection({merke:'MERCEDES',modell:'GLE 350 DE 4MATIC'},product));
});
test('explicit GLE Coupé keeps Coupé glass', () => {
 assert.equal(glassBodyRejection({merke:'MERCEDES',modell:'GLE 350 DE 4MATIC COUPÉ'},product),null);
});
test('explicit SUV/Coupé contradictions rejected in both directions', () => {
 assert.ok(glassBodyRejection({merke:'MERCEDES',modell:'GLE SUV'},product));
 assert.ok(glassBodyRejection({merke:'MERCEDES',modell:'GLE COUPE'},'MERCEDES GLE SUV 19- WS'));
});
test('body word cannot match an unrelated model even with matching year/make', () => {
 assert.equal(ordTreffKandidat('MERCEDES W203 2D COUPE 01-02',modellTokensAv('GLE 350 DE 4MATIC COUPE','MERCEDES')),false);
});
test('unknown product body and door counts are not fabricated contradictions', () => {
 assert.equal(glassBodyRejection({merke:'BMW',modell:'3 SERIES 2D'},'BMW 3 SERIES 2D'),null);
});

test('GLE cannot inherit CPE abbreviation or GLS-only materialised variants', () => {
 const bil={merke:'MERCEDES',modell:'GLE 350 DE 4MATIC'};
 assert.ok(glassBodyRejection(bil,'MERCEDES GLE C292 5D CPE 15-'));
 assert.ok(glassBodyRejection(bil,'MERCEDES GLS W166 5D SUV 15-'));
 assert.equal(glassBodyRejection(bil,'MERCEDES GLE W167 5D SUV 19- FR'),null);
});
test('CAB alone cannot make Dodge pickup match Viper convertible glass',()=>{
 assert.equal(ordTreffKandidat('DODGE VIPER 2D CAB+CPE 03-',modellTokensAv('PICKUP EXT CAB','DODGE')),false);
 assert.equal(ordTreffKandidat('DODGE PICKUP EXT CAB',modellTokensAv('PICKUP EXT CAB','DODGE')),true);
});
test('CPE alone cannot make Mustang match Puma coupe glass',()=>{
 assert.equal(ordTreffKandidat('FORD PUMA 2D CPE 98-',modellTokensAv('MUSTANG CPE+CAB','FORD')),false);
});
test('text fallback must not reintroduce Viper by matching CAB',async()=>{
 const {matchFrontrute}=await import('../src/matcher.ts');
 const row={varenr:'VTEST',eurokode:'DW01513GBY',varenavn:'DODGE VIPER 2D CAB+CPE 03- FRONTRUTE',pris:10000,kommentar:'',rad_type:'glass',alias_av:null};
 const db={prepare(){return{bind(){return this;},async all(){return{results:[row]};},async first(){return null;}};}};
 const r=await matchFrontrute({FINNBILGLASS_DB:db},{merke:'DODGE',modell:'PICKUP EXT CAB',aar:2006});
 assert.equal(r.kandidater.length,0);
});
test('English convertible is a body description, not a model match',()=>{
 assert.equal(ordTreffKandidat('FORD THUNDERBIRD CONVERTIBLE',modellTokensAv('MUSTANG CONVERTIBLE','FORD')),false);
});
