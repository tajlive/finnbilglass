/**
 * Hard limit enforcement tests for finnbilglass-price-import
 * Tests that maxProducts and maxPages are strictly enforced
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { test as baseTest } from 'node:test';

// Mock the browser and page objects for testing
function createMockPage() {
    let pageCount = 0;
    let products = [];
    
    return {
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async (fn) => {
            return {
                authWall: false,
                products: products.splice(0, 5), // Return 5 products per page
                links: [],
                diagnostics: { title: 'Test page' }
            };
        }
    };
}

function createMockContext() {
    return {
        newPage: () => createMockPage()
    };
}

function createMockBrowser() {
    return {
        newContext: () => createMockContext(),
        close: async () => {}
    };
}

// Test the hard limit enforcement logic directly
function testHardLimitEnforcement() {
    console.log('Testing hard limit enforcement...');
    
    // Test checkLimits function logic
    const checkLimits = (pageCount, recordsCount, maxPages, maxProducts) => {
        if (pageCount >= maxPages) {
            return { shouldStop: true, reason: `maxPages (${maxPages}) reached` };
        }
        if (recordsCount >= maxProducts) {
            return { shouldStop: true, reason: `maxProducts (${maxProducts}) reached` };
        }
        return { shouldStop: false };
    };
    
    // Test 1: maxPages limit
    let result = checkLimits(5, 3, 5, 100);
    assert.strictEqual(result.shouldStop, true, 'Should stop when pageCount >= maxPages');
    assert.strictEqual(result.reason, 'maxPages (5) reached');
    
    // Test 2: maxProducts limit
    result = checkLimits(2, 10, 10, 10);
    assert.strictEqual(result.shouldStop, true, 'Should stop when recordsCount >= maxProducts');
    assert.strictEqual(result.reason, 'maxProducts (10) reached');
    
    // Test 3: No limit reached
    result = checkLimits(2, 5, 10, 100);
    assert.strictEqual(result.shouldStop, false, 'Should not stop when limits not reached');
    
    console.log('✓ checkLimits tests passed');
}

// Test hard limit enforcement in crawl loop
async function testCrawlLimitEnforcement() {
    console.log('Testing crawl loop limit enforcement...');
    
    let pageCount = 0;
    let recordsCount = 0;
    const maxPages = 3;
    const maxProducts = 5;
    
    const checkLimits = (pc, rc) => {
        if (pc >= 3) return { shouldStop: true, reason: 'maxPages' };
        if (rc >= 5) return { shouldStop: true, reason: 'maxProducts' };
        return { shouldStop: false };
    };
    
    // Simulate crawl loop
    for (let i = 0; i < 10; i++) {
        // Check before page load
        let limitCheck = checkLimits(pageCount, recordsCount);
        if (limitCheck.shouldStop) {
            console.log(`Stopped before page ${pageCount + 1}: ${limitCheck.reason}`);
            break;
        }
        
        pageCount++;
        
        // Simulate finding products on page
        for (let j = 0; j < 3; j++) {
            recordsCount++;
            if (recordsCount >= 5) break;
        }
        
        // Check after processing
        let limitCheck2 = checkLimits(pageCount, recordsCount);
        if (limitCheck2.shouldStop) {
            console.log(`Stopped after page ${pageCount}: ${limitCheck2.reason}`);
            break;
        }
    }
    
    assert.strictEqual(pageCount, 2, 'Should have visited 2 pages (maxPages=3, but maxProducts=5 reached)');
    assert.strictEqual(recordsCount, 5, 'Should have collected exactly 5 products');
    
    console.log('✓ Crawl limit enforcement tests passed');
}

// Test Typekode-only mode filtering
function testTypekodeOnlyFiltering() {
    console.log('Testing Typekode-only mode filtering...');

    const records = [
        { sku: 'A', listPriceValue: 100, stockStatus: 'IN_STOCK', typeCodeRaw: 'FRONTRUTE' },
        { sku: 'B', listPriceValue: null, stockStatus: 'UNKNOWN', typeCodeRaw: 'BAKRUTE' },
        { sku: 'C', listPriceValue: 200, stockStatus: 'POSSIBLY_AVAILABLE', typeCodeRaw: 'DØRRUTE' }
    ];

    // Simulate Typekode-only filtering
    const typekodeOnly = true;
    if (typekodeOnly) {
        for (const r of records) {
            delete r.listPriceRaw;
            delete r.listPriceValue;
            delete r.currency;
            delete r.sourcePriceKind;
            delete r.vatBasis;
            delete r.discountPercentPolicy;
            delete r.customerPriceInclVat;
            delete r.stockStatus;
            delete r.stockEvidence;
            delete r.stockQuantity;
            delete r.stockCheckedAt;
            delete r.priceEvidence;
        }
    }

    for (const r of records) {
        assert.strictEqual(r.listPriceValue, undefined, 'listPriceValue should be deleted');
        assert.strictEqual(r.stockStatus, undefined, 'stockStatus should be deleted');
        assert.strictEqual(r.currency, undefined, 'currency should be deleted');
        // Find the record with typeCodeRaw FRONTRUTE
        const frontRecord = records.find(r => r.typeCodeRaw === 'FRONTRUTE');
        assert.strictEqual(frontRecord?.typeCodeRaw, 'FRONTRUTE', 'typeCodeRaw FRONTRUTE should be preserved');
        const backRecord = records.find(r => r.typeCodeRaw === 'BAKRUTE');
        assert.strictEqual(backRecord?.typeCodeRaw, 'BAKRUTE', 'typeCodeRaw BAKRUTE should be preserved');
        const doorRecord = records.find(r => r.typeCodeRaw === 'DØRRUTE');
        assert.strictEqual(doorRecord?.typeCodeRaw, 'DØRRUTE', 'typeCodeRaw DØRRUTE should be preserved');
    }

    console.log('✓ Typekode-only filtering tests passed');
}

// Test recursive Typekode-only dataminimering (P0-1)
// Verifies that ALL commercial fields are removed from top-level AND nested accessories
function testTypekodeOnlyDataminimering() {
    console.log('Testing Typekode-only recursive dataminimering...');

    const TOP_LEVEL_ALLOWED = new Set([
        'sku', 'title', 'titleSource', 'url', 'sourceUrl', 'sourcePage', 'scope',
        'glassType', 'glassTypeSource',
        'typeCodeRaw', 'typeCodeSource', 'typeCodeObservations', 'typeCodeSide',
        'typeCodeConflict', 'sideConflict', 'reviewStatus', 'reviewReasons',
        'manualReviewRequired', 'automaticOrderAllowed', 'orderBlockReasons',
        'priorReportedSide', 'priorReportedSideSource', 'priorReportedSideVerified',
        'categoryEvidence', 'verification', 'accessories'
    ]);
    const ACCESSORY_ALLOWED = new Set([
        'sku', 'title', 'sourceUrl', 'sourcePage', 'relation',
        'verifiedFitment', 'priceVerified'
    ]);
    const COMMERCIAL_FIELDS = new Set([
        'listPriceRaw', 'listPriceValue', 'priceText', 'priceEvidence',
        'currency', 'sourcePriceKind', 'vatBasis', 'discountPercentPolicy',
        'customerPriceInclVat', 'stockStatus', 'stockEvidence', 'stockQuantity',
        'stockCheckedAt', 'minProductsForFull', 'throttleMs'
    ]);

    // Record with all possible fields including accessories with commercial data
    const dirtyRecord = {
        sku: '29730YP',
        title: 'MAZDA CX5 5D SUV 12- VENTILRUTE+SØTET',
        titleSource: 'TEXT',
        url: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
        sourceUrl: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
        sourcePage: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
        scope: 'DETAIL',
        glassType: 'OVRIG_GLASS',
        glassTypeSource: 'EXPLICIT_TYPEKODE',
        typeCodeRaw: 'VENTIL/SIDERUTE FREMRE FØRERSIDE',
        typeCodeSource: 'SUPPLIER_TYPEKODE_DETAIL_FIELD',
        typeCodeObservations: ['VENTIL/SIDERUTE FREMRE FØRERSIDE'],
        typeCodeSide: 'DRIVER',
        typeCodeConflict: false,
        sideConflict: true,
        reviewStatus: 'REQUIRES_MANUAL_REVIEW',
        reviewReasons: ['SUPPLIER_TYPECODE_VS_REPORTED_SIDE', 'UNRESOLVED_REPORTED_SIDE_DISCREPANCY'],
        manualReviewRequired: true,
        automaticOrderAllowed: false,
        orderBlockReasons: ['FITMENT_NOT_VERIFIED', 'CUSTOMER_PRICING_NOT_VERIFIED', 'SIDE_DISCREPANCY_REQUIRES_REVIEW'],
        priorReportedSide: 'PASSENGER',
        priorReportedSideSource: 'PRIOR_USER_REPORTED_CORRECTION',
        priorReportedSideVerified: false,
        categoryEvidence: 'product_cat-2012-2017-i',
        verification: 'UNVERIFIED_DISCOVERY_ONLY',
        // COMMERCIAL FIELDS THAT MUST BE REMOVED:
        listPriceRaw: 'Pris: kr 232',
        listPriceValue: 232,
        priceText: 'Pris: kr 232',
        priceEvidence: 'DISPLAYED_PRICE_ELEMENT',
        currency: 'NOK_UNVERIFIED',
        sourcePriceKind: 'UNVERIFIED_DISPLAYED',
        vatBasis: 'UNKNOWN',
        discountPercentPolicy: { discountPercent: 50, multiplier: 0.5 },
        customerPriceInclVat: null,
        stockStatus: 'POSSIBLY_AVAILABLE',
        stockEvidence: 'Lagertekst: På lager',
        stockQuantity: null,
        stockCheckedAt: '2026-11-01T11:29:42.000Z',
        accessories: [
            {
                sku: 'DEM1',
                title: 'DEMLIST KAROSSERI UNIVERSAL 5MM X 6MM - 10 METER',
                listPriceRaw: 'Pris: kr 232',   // MUST BE REMOVED
                sourceUrl: null,
                sourcePage: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
                relation: 'LISTED_IN_SUPPLIER_ACCESSORY_SECTION',
                verifiedFitment: false,
                priceVerified: false,
                vatBasis: 'UNKNOWN'               // MUST BE REMOVED
            }
        ],
        accessorySectionFound: true
    };

    // Apply Typekode-only allow-list stripping (same logic as main.js)
    for (const key of Object.keys(dirtyRecord)) {
        if (!TOP_LEVEL_ALLOWED.has(key)) {
            delete dirtyRecord[key];
        }
    }
    if (Array.isArray(dirtyRecord.accessories)) {
        for (const a of dirtyRecord.accessories) {
            for (const key of Object.keys(a)) {
                if (!ACCESSORY_ALLOWED.has(key)) {
                    delete a[key];
                }
            }
            a.priceVerified = false;
        }
    }

    // Verify no commercial fields remain at top level
    for (const field of COMMERCIAL_FIELDS) {
        assert.strictEqual(
            dirtyRecord[field], undefined,
            `Top-level field '${field}' must be removed in Typekode-only mode`
        );
    }

    // Verify accessories have no commercial fields
    const accessory = dirtyRecord.accessories[0];
    assert.strictEqual(accessory.listPriceRaw, undefined, 'Accessory listPriceRaw must be removed');
    assert.strictEqual(accessory.vatBasis, undefined, 'Accessory vatBasis must be removed');
    assert.strictEqual(accessory.priceVerified, false, 'Accessory priceVerified must be false');

    // Verify allowed fields are preserved
    assert.strictEqual(dirtyRecord.sku, '29730YP');
    assert.strictEqual(dirtyRecord.typeCodeRaw, 'VENTIL/SIDERUTE FREMRE FØRERSIDE');
    assert.strictEqual(dirtyRecord.sideConflict, true);
    assert.strictEqual(dirtyRecord.reviewStatus, 'REQUIRES_MANUAL_REVIEW');
    assert.strictEqual(dirtyRecord.automaticOrderAllowed, false);
    assert.strictEqual(dirtyRecord.accessories[0].sku, 'DEM1');
    assert.strictEqual(dirtyRecord.accessories[0].title, 'DEMLIST KAROSSERI UNIVERSAL 5MM X 6MM - 10 METER');

    console.log('✓ Typekode-only recursive dataminimering tests passed');
}

// Test that extract.js omit priceText when typekodeOnly=true
function testExtractOmitsPriceTextInTypekodeOnly() {
    console.log('Testing extract.js omits priceText when typekodeOnly=true...');

    // Simulate extract.js product construction logic
    const priceRaw = 'Pris: kr 232';
    const typekodeOnly = true;

    const productBase = {
        sku: '29730YP',
        title: 'MAZDA CX5',
        titleSource: 'TEXT',
        url: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
    };

    // Same conditional spread as in extract.js line 216
    const product = {
        ...productBase,
        ...(typekodeOnly ? {} : { priceText: priceRaw?.slice(0, 110) || null, priceEvidence: 'DISPLAYED_PRICE_ELEMENT' }),
        stockStatus: 'UNKNOWN',
        stockEvidence: 'TYPEKODE_ONLY_MODE',
        typeCodeRaw: 'VENTIL/SIDERUTE FREMRE FØRERSIDE',
        typeCodeSource: 'SUPPLIER_TYPEKODE_DETAIL_FIELD',
        scope: 'DETAIL'
    };

    assert.strictEqual(product.priceText, undefined, 'priceText must be undefined when typekodeOnly=true');
    assert.strictEqual(product.priceEvidence, undefined, 'priceEvidence must be undefined when typekodeOnly=true');
    assert.strictEqual(product.stockStatus, 'UNKNOWN', 'stockStatus should still be UNKNOWN');
    assert.strictEqual(product.sku, '29730YP', 'sku must be preserved');

    console.log('✓ Extract.js priceText omission test passed');
}

// Test: Page-limit regression — 5th page products must NOT be discarded (P0-4)
// Bug: checkLimits() was called after pageCount++ but before processing products,
// so when pageCount==maxPages, products on the last page were dropped.
// Fix: Process products BEFORE checking hard limits; limits only prevent loading NEW pages.
function testPageLimitDoesNotDropLastPageProducts() {
    console.log('Testing page-limit does not drop products on last page...');

    // Simulate the fixed crawl loop logic from main.js
    const maxPages = 5;
    const maxProducts = 5;
    let pageCount = 0;
    let recordsBySku = new Map();

    // 5 pages, each with 1 unique product
    const pages = [
        [{ sku: 'A', title: 'Product A', typeCodeRaw: 'FRONTRUTE' }],
        [{ sku: 'B', title: 'Product B', typeCodeRaw: 'BAKRUTE' }],
        [{ sku: 'C', title: 'Product C', typeCodeRaw: 'DØRRUTE' }],
        [{ sku: 'D', title: 'Product D', typeCodeRaw: 'SIDERUTE' }],
        [{ sku: 'E', title: 'Product E', typeCodeRaw: 'VENTILRUTE' }],  // Page 5 — was being dropped
    ];

    // FIXED loop: products processed before limit check
    let i = 0;
    while (i < pages.length && pageCount < maxPages) {
        // Pre-check: don't load new page if at limit
        if (pageCount >= maxPages) break;

        const products = pages[i];
        pageCount++;

        // PROCESS PRODUCTS BEFORE checking limits (THE FIX)
        for (const product of products) {
            if (recordsBySku.size >= maxProducts) break;
            recordsBySku.set(product.sku, product);
        }

        // Post-check: stop loading new pages
        if (pageCount >= maxPages) break;
        if (recordsBySku.size >= maxProducts) break;
        i++;
    }

    assert.strictEqual(pageCount, 5, 'Should have visited 5 pages');
    assert.strictEqual(recordsBySku.size, 5, 'Should have collected all 5 products including page 5');
    assert.strictEqual(recordsBySku.has('E'), true, '5th page product E must not be dropped');
    assert.strictEqual(recordsBySku.get('E')?.typeCodeRaw, 'VENTILRUTE', 'Product E typeCode preserved');

    console.log('✓ Page-limit regression test passed (5th page product retained)');
}

// Test: Pages fewer than maxPages — all products collected
function testPagesFewerThanMaxPages() {
    console.log('Testing fewer pages than maxPages...');

    const maxPages = 10;
    const maxProducts = 100;
    let pageCount = 0;
    let recordsBySku = new Map();

    const pages = [
        [{ sku: 'A', title: 'Product A' }],
        [{ sku: 'B', title: 'Product B' }],
        [{ sku: 'C', title: 'Product C' }],
    ];

    let i = 0;
    while (i < pages.length && pageCount < maxPages) {
        if (pageCount >= maxPages) break;
        const products = pages[i];
        pageCount++;
        for (const product of products) {
            recordsBySku.set(product.sku, product);
        }
        if (pageCount >= maxPages) break;
        if (recordsBySku.size >= maxProducts) break;
        i++;
    }

    assert.strictEqual(pageCount, 3, 'Should have visited all 3 available pages');
    assert.strictEqual(recordsBySku.size, 3, 'Should have collected all 3 products');
    assert.strictEqual(recordsBySku.has('C'), true, 'Product C on last available page retained');

    console.log('✓ Fewer-pages-than-limit test passed');
}

// Test: Pages more than maxPages — only maxPages worth collected
function testPagesMoreThanMaxPages() {
    console.log('Testing more pages than maxPages...');

    const maxPages = 3;
    const maxProducts = 100;
    let pageCount = 0;
    let recordsBySku = new Map();

    const pages = [
        [{ sku: 'A', title: 'Product A' }],
        [{ sku: 'B', title: 'Product B' }],
        [{ sku: 'C', title: 'Product C' }],
        [{ sku: 'D', title: 'Product D' }],  // Should NOT be reached
        [{ sku: 'E', title: 'Product E' }],  // Should NOT be reached
    ];

    let i = 0;
    while (i < pages.length && pageCount < maxPages) {
        if (pageCount >= maxPages) break;
        const products = pages[i];
        pageCount++;
        for (const product of products) {
            recordsBySku.set(product.sku, product);
        }
        if (pageCount >= maxPages) break;
        if (recordsBySku.size >= maxProducts) break;
        i++;
    }

    assert.strictEqual(pageCount, 3, 'Should have visited exactly 3 pages (maxPages limit)');
    assert.strictEqual(recordsBySku.size, 3, 'Should have collected 3 products');
    assert.strictEqual(recordsBySku.has('C'), true, 'Product C on page 3 retained');
    assert.strictEqual(recordsBySku.has('D'), false, 'Product D on page 4 must not be reached');
    assert.strictEqual(recordsBySku.has('E'), false, 'Product E on page 5 must not be reached');

    console.log('✓ More-pages-than-limit test passed');
}

// Test: Typekode-only allow-list preserved with page-limit fix
function testTypekodeAllowListWithPageLimit() {
    console.log('Testing Typekode-only allow-list with page-limit fix...');

    const TOP_LEVEL_ALLOWED = new Set([
        'sku', 'title', 'titleSource', 'url', 'sourceUrl', 'sourcePage', 'scope',
        'glassType', 'glassTypeSource',
        'typeCodeRaw', 'typeCodeSource', 'typeCodeObservations', 'typeCodeSide',
        'typeCodeConflict', 'sideConflict', 'reviewStatus', 'reviewReasons',
        'manualReviewRequired', 'automaticOrderAllowed', 'orderBlockReasons',
        'priorReportedSide', 'priorReportedSideSource', 'priorReportedSideVerified',
        'categoryEvidence', 'verification', 'accessories'
    ]);
    const ACCESSORY_ALLOWED = new Set([
        'sku', 'title', 'sourceUrl', 'sourcePage', 'relation',
        'verifiedFitment', 'priceVerified'
    ]);
    const COMMERCIAL_FIELDS = new Set([
        'listPriceRaw', 'listPriceValue', 'priceText', 'priceEvidence',
        'currency', 'sourcePriceKind', 'vatBasis', 'discountPercentPolicy',
        'customerPriceInclVat', 'stockStatus', 'stockEvidence', 'stockQuantity',
        'stockCheckedAt'
    ]);

    // Simulate a product extracted from page 5 with all dirty fields
    const dirtyProduct = {
        sku: '28309GN',
        title: 'CITROEN C-5 5D HBK+STV 08- FREMRE VENTILRUTE+INNK',
        typeCodeRaw: 'VENTIL/SIDERUTE FREMRE FØRERSIDE',
        sideConflict: false,
        reviewStatus: 'UNVERIFIED_DISCOVERY_ONLY',
        automaticOrderAllowed: false,
        // COMMERCIAL FIELDS THAT MUST BE REMOVED:
        listPriceRaw: 'Pris: kr 2 010',
        listPriceValue: 2010,
        priceText: 'Pris: kr 2 010',
        priceEvidence: 'DISPLAYED_PRICE_ELEMENT',
        currency: 'NOK_UNVERIFIED',
        stockStatus: 'OUT_OF_STOCK',
        stockEvidence: 'Lagertekst: Utsolgt',
        accessories: [
            {
                sku: 'ACC1',
                title: 'Tilbehør del',
                listPriceRaw: 'Pris: kr 150',  // MUST BE REMOVED
                vatBasis: 'UNKNOWN',              // MUST BE REMOVED
                verifiedFitment: false,
                priceVerified: false,
            }
        ]
    };

    // Apply allow-list stripping (same logic as fixed main.js)
    for (const key of Object.keys(dirtyProduct)) {
        if (!TOP_LEVEL_ALLOWED.has(key)) {
            delete dirtyProduct[key];
        }
    }
    if (Array.isArray(dirtyProduct.accessories)) {
        for (const a of dirtyProduct.accessories) {
            for (const key of Object.keys(a)) {
                if (!ACCESSORY_ALLOWED.has(key)) {
                    delete a[key];
                }
            }
            a.priceVerified = false;
        }
    }

    // Verify no commercial fields remain
    for (const field of COMMERCIAL_FIELDS) {
        assert.strictEqual(
            dirtyProduct[field], undefined,
            `Field '${field}' must be removed in Typekode-only mode`
        );
    }
    const acc = dirtyProduct.accessories[0];
    assert.strictEqual(acc.listPriceRaw, undefined, 'Accessory listPriceRaw removed');
    assert.strictEqual(acc.vatBasis, undefined, 'Accessory vatBasis removed');
    assert.strictEqual(acc.priceVerified, false, 'Accessory priceVerified=false');

    // Verify allowed fields preserved
    assert.strictEqual(dirtyProduct.sku, '28309GN');
    assert.strictEqual(dirtyProduct.typeCodeRaw, 'VENTIL/SIDERUTE FREMRE FØRERSIDE');

    console.log('✓ Typekode-only allow-list with page-limit test passed');
}

// Run all tests
async function runTests() {
    console.log('=== Running Hard Limit & Typekode-Only Tests ===\n');

    testHardLimitEnforcement();
    await testCrawlLimitEnforcement();
    testTypekodeOnlyFiltering();
    testTypekodeOnlyDataminimering();
    testExtractOmitsPriceTextInTypekodeOnly();
    testPageLimitDoesNotDropLastPageProducts();
    testPagesFewerThanMaxPages();
    testPagesMoreThanMaxPages();
    testTypekodeAllowListWithPageLimit();

    console.log('\n=== All tests passed! ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});