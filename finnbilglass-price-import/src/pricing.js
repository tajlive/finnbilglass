/**
 * Business pricing policy only. Customer prices are deliberately not computed
 * until source "regular/list" price, VAT basis, and glass category are verified.
 */
export function classifyGlassType(text = '') {
    const t = String(text).toLocaleLowerCase('nb-NO');
    // Explicitly exclude windshield wipers and similar non-glass products from glass pricing.
    if (/vindusvisk|viskerblad|\bwiper|product_cat-vindusvisk/u.test(t)) return 'EXCLUDED';
    // Accessories are always manually priced, including when they mention a windshield.
    if (/\b(limkit|limsett|limpatron|limtube|tilbehør|primer|verktøy|klips|festeklips|pakning|dekorlist|pyntelist|listverk|sensor(?:gel|tape))\b|product_cat-(?:tilbehor|tilbehør|vindusviskere)/u.test(t)) return 'MANUELL';
    // Norwegian catalog URLs frequently concatenate material/color after the glass term,
    // for example frontruteklar and bakruteelgronn.
    if (/frontrut|vindskjerm|windshield|windscreen/u.test(t)) return 'FRONTRUTE';
    if (/siderut|bakrut|ventilrut|trekantrut|dørrut|dorrut|sideglass|bakglass/u.test(t)) return 'OVRIG_GLASS';
    return 'UNKNOWN';
}
export function parseNorwegianPrice(raw = '') {
    const text = String(raw).replace(/\u00a0|\u202f/gu, ' ');
    const match = text.match(/(?:kr|nok)?\s*(\d[\d\s.,]*\d|\d)\s*(?:kr|nok)?/iu);
    if (!match) return null;
    let amount = match[1].replace(/\s/gu, '');
    if (/[.,]/u.test(amount)) {
        const lastComma = amount.lastIndexOf(',');
        const lastDot = amount.lastIndexOf('.');
        const last = Math.max(lastComma, lastDot);
        const precision = amount.length - last - 1;
        if (precision === 1 || precision === 2) {
            amount = `${amount.slice(0, last).replace(/[.,]/gu, '')}.${amount.slice(last + 1)}`;
        } else {
            amount = amount.replace(/[.,]/gu, '');
        }
    }
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}
export function pricePolicy(glassType) {
    if (glassType === 'FRONTRUTE') return { discountPercent: 75, multiplier: 0.25 };
    if (glassType === 'OVRIG_GLASS') return { discountPercent: 50, multiplier: 0.5 };
    return { discountPercent: null, multiplier: null };
}
export function safeCustomerPrice({glassType, listPriceValue, vatBasis, sourcePriceKind}) {
    const policy = pricePolicy(glassType);
    if (policy.multiplier === null || sourcePriceKind !== 'VERIFIED_REGULAR_LIST' ||
        !['GROSS', 'NET'].includes(vatBasis) || !Number.isFinite(listPriceValue)) return null;
    const gross = vatBasis === 'NET' ? listPriceValue * 1.25 : listPriceValue;
    return Math.round(gross * policy.multiplier * 100) / 100;
}
