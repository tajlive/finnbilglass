/**
 * Conservative side-fitment review for supplier observations.
 * This module NEVER changes the supplier's Typekode and NEVER certifies fitment.
 * A previously reported SKU correction is a discrepancy to investigate, NOT authority
 * to overwrite the supplier or automatically sell a different side.
 */

const DISPUTED_PRODUCTS = Object.freeze({
    '29730YP': Object.freeze({
        urlPath: '/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/',
        reportedSide: 'PASSENGER',
        evidenceSource: 'PRIOR_USER_REPORTED_CORRECTION',
        evidenceStatus: 'UNVERIFIED_INDEPENDENTLY'
    })
});

function stringValue(value) {
    return String(value ?? '').replace(/\u00a0/gu, ' ').normalize('NFC').trim();
}

/** Read only explicitly stated driver/passenger labels, never infer from left/right or /-2 URL. */
export function explicitSide(text) {
    const normalized = stringValue(text).toLocaleLowerCase('nb-NO');
    const driver = /\bførersid(?:e|en)?\b|\bforersid(?:e|en)?\b|\bfører\s*side\b|\bførers\s*side\b/iu.test(normalized);
    const passenger = /\bpassasjersid(?:e|en)?\b|\bpassasjer\s*side\b/iu.test(normalized);
    if (driver && passenger) return 'AMBIGUOUS';
    if (driver) return 'DRIVER';
    if (passenger) return 'PASSENGER';
    return null;
}

/** Restrict reported exception to SKU, the expected supplier host and exact product path. */
export function reportedSideDiscrepancy({sku, sourceUrl} = {}) {
    const evidence = DISPUTED_PRODUCTS[stringValue(sku).toUpperCase()];
    if (!evidence) return null;
    try {
        const url = new URL(sourceUrl);
        if (url.protocol !== 'https:' || !['auto-glass.no', 'www.auto-glass.no'].includes(url.hostname.toLowerCase()) ||
            url.pathname !== evidence.urlPath) return null;
        return {...evidence};
    } catch { return null; }
}

const SIDE_REASONS = new Set([
    'SUPPLIER_TYPECODE_VS_REPORTED_SIDE',
    'SUPPLIER_TYPECODE_VS_PRODUCT_TITLE',
    'CONFLICTING_SUPPLIER_TYPECODE_SIDES',
    'AMBIGUOUS_SIDE_LABEL',
    'UNRESOLVED_REPORTED_SIDE_DISCREPANCY'
]);

/**
 * Review reasons are monotonic when merging catalog and product-detail evidence.
 * Automatic ordering stays OFF even for otherwise unflagged scraped observations.
 */
export function applyReviewPolicy(record, priorReasons = []) {
    const observations = [...new Set([
        ...(Array.isArray(record.typeCodeObservations) ? record.typeCodeObservations : []),
        record.typeCodeRaw
    ].map(stringValue).filter(Boolean))];
    const sourceSides = [...new Set(observations.map(explicitSide).filter(Boolean))];
    const typeCodeSide = explicitSide(record.typeCodeRaw);
    const titleSide = explicitSide(record.title);
    const priorReport = reportedSideDiscrepancy(record);
    const reasons = new Set([...priorReasons, ...(record.reviewReasons || [])].filter(
        reason => typeof reason === 'string' && /^[A-Z_]{3,90}$/u.test(reason)));

    if (sourceSides.includes('AMBIGUOUS') || titleSide === 'AMBIGUOUS') reasons.add('AMBIGUOUS_SIDE_LABEL');
    if (sourceSides.includes('DRIVER') && sourceSides.includes('PASSENGER')) {
        reasons.add('CONFLICTING_SUPPLIER_TYPECODE_SIDES');
    }
    if (typeCodeSide && titleSide && typeCodeSide !== 'AMBIGUOUS' && titleSide !== 'AMBIGUOUS' && typeCodeSide !== titleSide) {
        reasons.add('SUPPLIER_TYPECODE_VS_PRODUCT_TITLE');
    }
    if (priorReport) {
        // Even if the live Typekode has since been corrected, keep the reported
        // discrepancy in manual review until a separate, recorded resolution.
        reasons.add('UNRESOLVED_REPORTED_SIDE_DISCREPANCY');
        if (sourceSides.some(side => side !== 'AMBIGUOUS' && side !== priorReport.reportedSide)) {
            reasons.add('SUPPLIER_TYPECODE_VS_REPORTED_SIDE');
        }
    }
    if (record.typeCodeConflict) reasons.add('GLASS_CLASS_TYPECODE_CONFLICT');
    const sideConflict = [...reasons].some(reason => SIDE_REASONS.has(reason));
    const reviewStatus = reasons.size ? 'REQUIRES_MANUAL_REVIEW' : 'UNVERIFIED_DISCOVERY_ONLY';
    return {
        ...record,
        typeCodeObservations: observations,
        typeCodeSide,
        titleSide,
        priorReportedSide: priorReport?.reportedSide || null,
        priorReportedSideSource: priorReport?.evidenceSource || null,
        priorReportedSideVerified: false,
        sideConflict,
        reviewReasons: [...reasons].sort(),
        reviewStatus,
        manualReviewRequired: reasons.size > 0,
        automaticOrderAllowed: false,
        orderBlockReasons: [...new Set([
            'FITMENT_NOT_VERIFIED', 'CUSTOMER_PRICING_NOT_VERIFIED',
            ...(sideConflict ? ['SIDE_DISCREPANCY_REQUIRES_REVIEW'] : []),
            ...(record.typeCodeConflict ? ['GLASS_CLASS_REQUIRES_REVIEW'] : [])
        ])],
        // Preserve the original independent source-observation label.
        verification: 'UNVERIFIED_DISCOVERY_ONLY'
    };
}
