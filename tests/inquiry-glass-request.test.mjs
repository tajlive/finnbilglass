import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { persistInquiry } from '../src/inquiry-glass-request.ts';
import { parseGlassRequest } from '../src/glass-selection.ts';

test('additive inquiry migration persists legacy-null and new requests without duplicate case events', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(await readFile(new URL('../migrations/0017_beta_inquiries.sql', import.meta.url), 'utf8'));
    sqlite.exec(await readFile(new URL('../migrations/0018_beta_inquiries_ops.sql', import.meta.url), 'utf8'));
    sqlite.exec(await readFile(new URL('../migrations/0035_inquiry_glass_request.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO beta_inquiries (navn,kontakt) VALUES (?,?)').run('Legacy','legacy@example.no');
    const db = { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async run() { const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}; } }; } }; }, async batch(items) { sqlite.exec('BEGIN IMMEDIATE'); try {const out=[];for(const item of items)out.push(await item.run());sqlite.exec('COMMIT');return out;}catch(e){try{sqlite.exec('ROLLBACK')}catch{}throw e;} } };
    const glassRequest = parseGlassRequest({schemaVersion:1,selection:{kind:'rear',layout:'single'},answers:{}});
    const body={regnr:'AB12345',name:'Ny Kunde',contact:'new@example.no',message:'',sessionId:null,glassRequest,clientRequestId:'client-request-0000001',vehicleJson:null};
    const stored=await persistInquiry(db,body);
    assert.equal(stored.created,true);
    assert.equal(sqlite.prepare('SELECT glass_request_json FROM beta_inquiries WHERE id=?').get(stored.id).glass_request_json !== null,true);
    assert.equal(sqlite.prepare('SELECT glass_request_json FROM beta_inquiries WHERE id=1').get().glass_request_json,null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiry_events WHERE inquiry_id=?').get(stored.id).n,1);
  } finally { sqlite.close(); }
});
