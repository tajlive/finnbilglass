import { test } from 'node:test';
import assert from 'node:assert/strict';
import {validateKustomAcceptedQuote,safeKustomLink,sha256Hex,constantTimeHexMatch} from '../src/payments/kustom-ops-domain.ts';
const q=()=>({id:3,inquiry_id:5,versjon:2,pris_kr:1000,total_kr:1873.75,pris_type:'BEKREFTET',sendt_at:1,gyldig_til:null,kontakt:'kunde@example.no',navn:'Kunde',regnr:null,inquiry_status:'OFFERED'});
const input=()=>({accepted:true,acceptanceMethod:'PHONE',acceptanceNote:'Godkjent i telefon'});
test('locked Kustom quote enforces shipping 699 + 25% VAT in customer total',()=>{
  assert.deepEqual(validateKustomAcceptedQuote(q(),input()),{amountMinor:187375,glassMinor:100000,method:'PHONE',note:'Godkjent i telefon'});
  assert.throws(()=>validateKustomAcceptedQuote({...q(),total_kr:1874},input()),/FRAKT_AVVIK/);
  assert.throws(()=>validateKustomAcceptedQuote({...q(),total_kr:1873.74},input()),/FRAKT_AVVIK/);
  assert.throws(()=>validateKustomAcceptedQuote({...q(),total_kr:1873.755},input()),/desimaler/);
});
test('quote requires verified and sent current offer with accepted customer',()=>{
  assert.throws(()=>validateKustomAcceptedQuote({...q(),pris_type:'VEILEDENDE'},input()),/IKKE_BEKREFTET/);
  assert.throws(()=>validateKustomAcceptedQuote(q(),{...input(),accepted:false}),/KUNDEAKSEPT/);
  assert.throws(()=>validateKustomAcceptedQuote({...q(),gyldig_til:'2024-01-01'},input()),/UTLOPT/);
});
test('provider URL validation denies foreign and non-https hosts',()=>{
  assert.equal(safeKustomLink('https://pay.kustom.co/abc'),true);
  assert.equal(safeKustomLink('https://pay.kustom.co.attacker.test/abc'),false);
  assert.equal(safeKustomLink('http://pay.kustom.co/abc'),false);
});
test('callback token hashing and constant-time comparison',async()=>{
  const hash=await sha256Hex('0123456789abcdef'.repeat(4));
  assert.equal(constantTimeHexMatch(hash,hash),true);
  assert.equal(constantTimeHexMatch(hash,'0'.repeat(64)),false);
});
