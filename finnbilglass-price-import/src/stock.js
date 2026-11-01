/** Supplier-colored stock indicators. Color alone never proves stock quantity. */
export function statusFromRgb(value) {
    const m = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/iu);
    if (!m) return 'UNKNOWN';
    const [, rr, gg, bb, aa] = m;
    if (aa !== undefined && Number(aa) < 0.6) return 'UNKNOWN';
    const [r, g, b] = [Number(rr), Number(gg), Number(bb)];
    // Actual Autoglass probe: amber rgb(245,166,35); red rgb(209,32,42).
    // Test yellow first; the previous red test incorrectly caught amber.
    if (r >= 170 && g >= 100 && g <= 220 && b <= 110 && r >= g && g > b * 1.4) {
        return 'POSSIBLY_AVAILABLE';
    }
    if (r >= 125 && r > g * 1.35 && r > b * 1.35) return 'OUT_OF_STOCK';
    if (g >= 90 && g > r * 1.2 && g > b * 1.18) return 'IN_STOCK';
    return 'UNKNOWN';
}

/** Independent post-extraction safeguard for observed color evidence. */
export function normalizeStock(status, evidence) {
    if (/^Indikator(?:farge|::before):/u.test(String(evidence || ''))) {
        const derived = statusFromRgb(evidence);
        if (derived !== 'UNKNOWN') return derived;
    }
    return ['IN_STOCK','POSSIBLY_AVAILABLE','OUT_OF_STOCK','UNKNOWN'].includes(status)
        ? status : 'UNKNOWN';
}
