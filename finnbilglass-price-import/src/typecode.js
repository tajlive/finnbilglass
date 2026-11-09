import { classifyGlassType } from './pricing.js';

/** Explicit, visible supplier Typekode. Keep the raw source label for audit. */
export function parseTypeCode(raw) {
    const source = String(raw ?? '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!source) return null;
    const stripped = source.replace(/^typekode\s*[:：-]?\s*/iu, '')
        .split(/\s+(?:varenummer|varenr\.?|artikkelnummer|pris|lagerstatus|lager|oslo|trondheim)\s*:/iu)[0]
        .trim();
    if (!stripped || /^typekode$/iu.test(stripped)) return null;
    return stripped.slice(0, 140);
}

export function typeCodeGlassType(value) {
    const type = parseTypeCode(value)?.toLocaleLowerCase('nb-NO');
    if (!type) return null;
    if (/^frontrut/u.test(type)) return 'FRONTRUTE';
    if (/^(?:bakrut|siderut|ventilrut|trekantrut|dørrut|dorrut|ventil\s*\/\s*siderut|sideglass|bakglass)/u.test(type)) return 'OVRIG_GLASS';
    return null;
}

/** Typekode outranks text/URL inference; any contradiction is a manual-review item. */
export function resolveGlassType({ typeCodeRaw, description = '' } = {}) {
    const explicit = typeCodeGlassType(typeCodeRaw);
    const inferred = classifyGlassType(description);
    if (!explicit) return {
        glassType: inferred,
        glassTypeSource: inferred === 'UNKNOWN' ? 'UNKNOWN' : 'DESCRIPTION_OR_CATEGORY',
        typeCodeConflict: false
    };
    if (inferred !== 'UNKNOWN' && inferred !== explicit) return {
        glassType: 'UNKNOWN',
        glassTypeSource: 'TYPECODE_CONFLICT_REVIEW',
        typeCodeConflict: true
    };
    return { glassType: explicit, glassTypeSource: 'EXPLICIT_TYPEKODE', typeCodeConflict: false };
}

/** Find an explicitly labelled field, never infer Typekode from a product URL/name. */
export function typeCodeFromLabeledText(raw) {
    const source = String(raw ?? '').replace(/\u00a0/gu, ' ');
    const match = source.match(/\btypekode\s*[:：=\-]?\s*((?:frontrute|bakrute|siderute|ventilrute|trekantrute|dørrute|dorrute|ventil\s*\/\s*siderute|sideglass|bakglass)\b[^\n\r]{0,90})/iu);
    if (!match) return null;
    const value = parseTypeCode(match[1].split(/\s+(?:varenummer|varenr\.?|artikkelnummer|pris|lagerstatus|lager|oslo|trondheim|kategori|lagerbeholdning)\s*:?/iu)[0]);
    return typeCodeGlassType(value) ? value : null;
}
