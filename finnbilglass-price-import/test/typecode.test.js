import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTypeCode, typeCodeGlassType, resolveGlassType} from '../src/typecode.js';

test('Ford Focus varekort: Typekode: Frontrute', () => {
    assert.equal(parseTypeCode('Typekode: Frontrute'), 'Frontrute');
    assert.equal(typeCodeGlassType('Typekode: Frontrute'), 'FRONTRUTE');
    assert.deepEqual(resolveGlassType({
        typeCodeRaw: 'Typekode: Frontrute',
        description: 'Ford Focus 5D HBK 4D SAL 5D EST 18- frontrute'
    }), {glassType:'FRONTRUTE',glassTypeSource:'EXPLICIT_TYPEKODE',typeCodeConflict:false});
});
test('Autoglass typekode for bakrute og ventil/siderute', () => {
    assert.equal(typeCodeGlassType('Typekode: Bakrute'), 'OVRIG_GLASS');
    assert.equal(typeCodeGlassType('Ventil/siderute fremre passasjerside'), 'OVRIG_GLASS');
    assert.equal(typeCodeGlassType('Typekode: Ikke oppgitt'), null);
});
test('Motstridende Typekode og produktbeskrivelse krever manuell kontroll', () => {
    assert.deepEqual(resolveGlassType({typeCodeRaw:'Typekode: Frontrute',description:'bakrute Fiat'}), {
        glassType:'UNKNOWN',glassTypeSource:'TYPECODE_CONFLICT_REVIEW',typeCodeConflict:true
    });
    assert.equal(resolveGlassType({typeCodeRaw:'Typekode: Frontrute',description:'vindusviskere for frontrute'}).glassType, 'UNKNOWN');
});
