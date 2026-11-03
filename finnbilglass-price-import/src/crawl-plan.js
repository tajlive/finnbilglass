/** Pure crawl-planning rules. A direct product probe must never expand to a catalog. */
export function isProductPageUrl(url) {
    try { return /^\/produkt\/[^/]+\/?$/u.test(new URL(url).pathname); }
    catch { return false; }
}

export function directProductMode(startUrls) {
    return startUrls.length > 0 && startUrls.every(isProductPageUrl);
}

export function startQueue(startUrls) {
    return startUrls.map(url => ({ url, kind: isProductPageUrl(url) ? 'PRODUCT' : 'CATEGORY' }));
}

/** This mode is intentionally not an accessory crawler. Accessory references are data only. */
export function shouldFollowLink(link, {directProductRun, includeProductPages}) {
    if (directProductRun) return false;
    if (link.kind === 'PRODUCT' && !includeProductPages) return false;
    return ['PRODUCT', 'CATEGORY', 'PAGINATION'].includes(link.kind);
}

export function shouldKeepProduct(product, {directProductRun, requestedProductUrls}) {
    if (!directProductRun) return true;
    if (product.scope !== 'DETAIL') return false;
    try {
        const normalized = new URL(product.sourceUrl);
        normalized.search = '';
        normalized.hash = '';
        return requestedProductUrls.has(normalized.href);
    } catch { return false; }
}
