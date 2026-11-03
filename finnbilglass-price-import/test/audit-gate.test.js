import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAudit} from '../src/audit-gate.js';

const example = (patch={}) => ({metadata:{vulnerabilities:{low:0,moderate:0,high:0,critical:0}},vulnerabilities:{},...patch});
test('clean production dependency audit passes', () => {
    const r=summarizeAudit(example());
    assert.equal(r.blocked,false);
    assert.equal(r.vulnerabilities.length,0);
});
test('high severity findings block deployment and show package', () => {
    const r=summarizeAudit(example({
        metadata:{vulnerabilities:{low:1,moderate:2,high:1,critical:0}},
        vulnerabilities:{foo:{severity:'high',range:'<1.2.3',isDirect:false,fixAvailable:true,via:[{title:'Example advisory',url:'https://example.com/advisory'}]}}
    }));
    assert.equal(r.blocked,true);
    assert.deepEqual(r.vulnerabilities.map(v=>v.name),['foo']);
    assert.equal(r.vulnerabilities[0].fix,'compatible-fix');
});
test('critical findings also block deployment', () => {
    const r=summarizeAudit(example({metadata:{vulnerabilities:{low:0,moderate:0,high:0,critical:1}}}));
    assert.equal(r.blocked,true);
});
test('missing counts and npm network failures never count as clean', () => {
    assert.throws(()=>summarizeAudit({error:{code:'ENOTFOUND'}}), /ENOTFOUND/);
    assert.throws(()=>summarizeAudit({}), /mangler/);
});
