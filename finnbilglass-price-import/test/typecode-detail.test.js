import test from 'node:test';
import assert from 'node:assert/strict';
import {typeCodeFromLabeledText, resolveGlassType} from '../src/typecode.js';

test('Typekode tekst fra produktmetadata og linjeskift', () => {
    assert.equal(typeCodeFromLabeledText('Varenummer: 3593AGACHMVZ\nTypekode: Frontrute\nPris: kr 13 995'), 'Frontrute');
    assert.equal(typeCodeFromLabeledText('Typekode\nFrontrute\nPris: kr 13995'), 'Frontrute');
    assert.equal(typeCodeFromLabeledText('Typekode: Ventil/siderute fremre passasjerside\nPris: kr 2 590'), 'Ventil/siderute fremre passasjerside');
    assert.equal(typeCodeFromLabeledText('Typekode: Bakrute Pris: kr 4510'), 'Bakrute');
});

test('Bare product title eller irrelevant tekst skal ikke opphøyes til typekode', () => {
    assert.equal(typeCodeFromLabeledText('FORD FOCUS FRONTRUTE 18-'), null);
    assert.equal(typeCodeFromLabeledText('Relaterte varer / Typekode: Ukjent'), null);
    assert.deepEqual(resolveGlassType({typeCodeRaw:null,description:'FORD FOCUS FRONTRUTE'}), {
        glassType:'FRONTRUTE',glassTypeSource:'DESCRIPTION_OR_CATEGORY',typeCodeConflict:false
    });
});
