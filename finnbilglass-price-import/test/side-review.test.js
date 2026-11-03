import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitSide, reportedSideDiscrepancy, applyReviewPolicy} from '../src/side-review.js';
import {extractFromPage} from '../src/extract.js';

const MAZDA_URL = 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/';
const knownDispute = {
    sku: '29730YP',
    title: 'MAZDA CX5 5D SUV 12- VENTILRUTE+SOTET',
    sourceUrl: MAZDA_URL,
    typeCodeRaw: 'VENTIL/SIDERUTE FREMRE FØRERSIDE',
    typeCodeSource: 'SUPPLIER_TYPEKODE_DETAIL_FIELD',
    glassType: 'OVRIG_GLASS',
    typeCodeConflict: false,
    customerPriceInclVat: null,
    vatBasis: 'UNKNOWN'
};

test('side extracted only from explicit driver/passenger statements, not ambiguous URLs', () => {
    assert.equal(explicitSide('VENTIL/SIDERUTE FREMRE FØRERSIDE'), 'DRIVER');
    assert.equal(explicitSide('DØRRUTE FREMRE PASSASJERSIDEN'), 'PASSENGER');
    assert.equal(explicitSide('SIDERUTE FREMRE VENSTRE'), null);
    assert.equal(explicitSide('MAZDA CX5 VENTILRUTE 12-'), null);
    assert.equal(explicitSide('FØRERSIDE / PASSASJERSIDE'), 'AMBIGUOUS');
});

test('29730YP supplier Typekode preserved verbatim and discrepancy quarantined', () => {
    const r = applyReviewPolicy(knownDispute);
    assert.equal(r.typeCodeRaw, knownDispute.typeCodeRaw);
    assert.equal(r.typeCodeSide, 'DRIVER');
    assert.equal(r.priorReportedSide, 'PASSENGER');
    assert.equal(r.priorReportedSideVerified, false);
    assert.equal(r.reviewStatus, 'REQUIRES_MANUAL_REVIEW');
    assert.equal(r.sideConflict, true);
    assert.equal(r.manualReviewRequired, true);
    assert.equal(r.automaticOrderAllowed, false);
    assert.ok(r.reviewReasons.includes('SUPPLIER_TYPECODE_VS_REPORTED_SIDE'));
    assert.ok(r.reviewReasons.includes('UNRESOLVED_REPORTED_SIDE_DISCREPANCY'));
    assert.ok(r.orderBlockReasons.includes('SIDE_DISCREPANCY_REQUIRES_REVIEW'));
    assert.equal(r.customerPriceInclVat, null);
});

test('29730YP discrepancy is not silently cleared if supplier label changes', () => {
    const r = applyReviewPolicy({...knownDispute, typeCodeRaw:'VENTIL/SIDERUTE FREMRE PASSASJERSIDE'});
    assert.equal(r.sideConflict, true);
    assert.equal(r.manualReviewRequired, true);
    assert.ok(r.reviewReasons.includes('UNRESOLVED_REPORTED_SIDE_DISCREPANCY'));
    assert.ok(!r.reviewReasons.includes('SUPPLIER_TYPECODE_VS_REPORTED_SIDE'));
});

test('the 29730YP reported exception requires exact SKU + original supplier URL', () => {
    assert.equal(reportedSideDiscrepancy({...knownDispute, sourceUrl:'https://evil.example/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/'}), null);
    assert.equal(reportedSideDiscrepancy({...knownDispute, sourceUrl:'https://auto-glass.no/produkt/other/'}), null);
    assert.equal(reportedSideDiscrepancy({...knownDispute, sku:'29729YP'}), null);
    assert.equal(reportedSideDiscrepancy({...knownDispute, sku:' 29730yp '}).reportedSide, 'PASSENGER');
    assert.equal(applyReviewPolicy({...knownDispute, sku:'29729YP'}).sideConflict, false);
});

test('independent explicit title-side disagreement requires review on any SKU', () => {
    const r = applyReviewPolicy({
        sku:'OTHER123', sourceUrl:'https://auto-glass.no/produkt/test/',
        title:'SIDERUTE FREMRE PASSASJERSIDE', typeCodeRaw:'SIDERUTE FREMRE FØRERSIDE'
    });
    assert.equal(r.sideConflict, true);
    assert.ok(r.reviewReasons.includes('SUPPLIER_TYPECODE_VS_PRODUCT_TITLE'));
});

test('matching title and Typekode side is not a newly invented conflict', () => {
    const r = applyReviewPolicy({sku:'OTHER123', title:'DØRRUTE FREMRE FØRERSIDE', typeCodeRaw:'DØRRUTE FREMRE FØRERSIDE'});
    assert.equal(r.reviewStatus, 'UNVERIFIED_DISCOVERY_ONLY');
    assert.equal(r.sideConflict, false);
    assert.equal(r.automaticOrderAllowed, false); // all scraped data are unverified
});

test('conflicting raw Typekode observations remain blocked even if latest label looks correct', () => {
    const r = applyReviewPolicy({sku:'OTHER123', title:'VENTILRUTE',
        typeCodeRaw:'SIDERUTE PASSASJERSIDE',
        typeCodeObservations:['SIDERUTE FØRERSIDE', 'SIDERUTE PASSASJERSIDE']});
    assert.equal(r.sideConflict, true);
    assert.deepEqual(r.typeCodeObservations,['SIDERUTE FØRERSIDE', 'SIDERUTE PASSASJERSIDE']);
    assert.ok(r.reviewReasons.includes('CONFLICTING_SUPPLIER_TYPECODE_SIDES'));
});

test('existing class conflicts still require manual review and preserve raw source', () => {
    const r = applyReviewPolicy({sku:'ONE',typeCodeRaw:'BAKRUTE',typeCodeConflict:true});
    assert.equal(r.manualReviewRequired,true);
    assert.equal(r.sideConflict,false);
    assert.ok(r.reviewReasons.includes('GLASS_CLASS_TYPECODE_CONFLICT'));
});

test('review reasons survive a subsequent card/detail merge', () => {
    const current = applyReviewPolicy(knownDispute);
    const updated = applyReviewPolicy({
        ...current, typeCodeRaw:'VENTIL/SIDERUTE FREMRE PASSASJERSIDE',
        typeCodeObservations: [current.typeCodeRaw, 'VENTIL/SIDERUTE FREMRE PASSASJERSIDE']
    }, current.reviewReasons);
    assert.equal(updated.sideConflict,true);
    assert.ok(updated.reviewReasons.includes('CONFLICTING_SUPPLIER_TYPECODE_SIDES'));
    assert.equal(updated.automaticOrderAllowed,false);
});

test('integration: detail extraction marks 29730YP for review, without revising supplier label', async () => {
    const mockPage = {
        url: () => MAZDA_URL,
        evaluate: async () => ({
            authWall:false,
            products:[{
                sku:'29730YP',title:'MAZDA CX5 5D SUV 12- VENTILRUTE+SOTET',titleSource:'TEXT',url:MAZDA_URL,
                priceText:'Pris: kr 2 590', priceEvidence:'DISPLAYED_PRICE_ELEMENT',
                stockStatus:'POSSIBLY_AVAILABLE',stockEvidence:'Indikatorfarge: rgb(245, 166, 35)',
                categoryText:'product_cat-2012-2017-i',typeCodeRaw:'VENTIL/SIDERUTE FREMRE FØRERSIDE',
                typeCodeSource:'SUPPLIER_TYPEKODE_DETAIL_FIELD',scope:'DETAIL'
            }],
            accessories:[],accessorySectionFound:true,links:[],diagnostics:{title:'Mazda'}
        })
    };
    const out = await extractFromPage(mockPage);
    assert.equal(out.products.length,1);
    const p=out.products[0];
    assert.equal(p.typeCodeRaw, 'VENTIL/SIDERUTE FREMRE FØRERSIDE');
    assert.equal(p.glassType,'OVRIG_GLASS');
    assert.equal(p.listPriceValue,2590);
    assert.equal(p.sideConflict,true);
    assert.equal(p.reviewStatus,'REQUIRES_MANUAL_REVIEW');
    assert.equal(p.customerPriceInclVat,null);
    assert.equal(p.automaticOrderAllowed,false);
});

test('no URL suffix (-2) can itself be treated as passenger side', () => {
    assert.equal(explicitSide(MAZDA_URL),null);
    const p=applyReviewPolicy({sku:'SOMEOTHER',typeCodeRaw:null, title:'VENTILRUTE',sourceUrl:MAZDA_URL});
    assert.equal(p.titleSide,null);
    assert.equal(p.priorReportedSide,null);
    assert.equal(p.reviewStatus,'UNVERIFIED_DISCOVERY_ONLY');
});
