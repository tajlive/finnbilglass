import { classifyGlassType, parseNorwegianPrice, pricePolicy } from './pricing.js';
import { normalizeStock } from './stock.js';
import { parseTypeCode, resolveGlassType } from './typecode.js';
import { applyReviewPolicy } from './side-review.js';

const BASE_URL = 'https://auto-glass.no';

export function titleFromProductUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (!url.pathname.startsWith('/produkt/')) return null;
        const segment = url.pathname.split('/').filter(Boolean)[1] || '';
        if (!segment || segment.length < 6) return null;
        return decodeURIComponent(segment.replace(/[-_]+/gu, ' ')).slice(0, 180);
    } catch { return null; }
}

export async function extractFromPage(page, { stockSelector = '', typekodeOnly = false } = {}) {
    const result = await page.evaluate(({ stockSelector, typekodeOnly }) => {
        const host = location.hostname.replace(/^www\./u, '');
        const products = [];
        const isDetailPage = /^\/produkt\//u.test(location.pathname);
        const navigable = new Map();
        const clean = (s) => String(s ?? '').replace(/\s+/gu, ' ').trim();
        const text = (e) => clean(e?.textContent);
        const sameDomain = (href) => {
            try {
                const url = new URL(href, location.href);
                if (url.protocol !== 'https:' || url.hostname.replace(/^www\./u, '') !== host) return null;
                url.hash = '';
                return url;
            } catch {
                return null;
            }
        };
        const classText = (e) => {
            const cls = e?.getAttribute?.('class') || '';
            return clean([cls, e?.getAttribute?.('aria-label'), e?.getAttribute?.('title'),
                e?.getAttribute?.('data-stock'), e?.getAttribute?.('data-status')].filter(Boolean).join(' '));
        };
        const labels = (s) => {
            const t = clean(s).toLocaleLowerCase();
            if (/ikke på lager|utsolgt|out.of.stock|ikke tilgjengelig|sold.out|unavailable/u.test(t)) return 'OUT_OF_STOCK';
            if (/kanskje|usikker|på forespørsel|ved forespørsel|mulig|kan bestilles|restordre|bestillingsvare|limited|back.?order|unknown stock/u.test(t)) return 'POSSIBLY_AVAILABLE';
            if (/på lager|lagervare|in.stock|på eget lager|available|tilgjengelig/u.test(t)) return 'IN_STOCK';
            return 'UNKNOWN';
        };
        const colorClass = (css) => {
            const t = clean(css).toLocaleLowerCase();
            if (/(?:^|[\s_\-])(red|rod|rød|out-of-stock|outofstock)(?:$|[\s_\-])/u.test(t)) return 'OUT_OF_STOCK';
            if (/(?:^|[\s_\-])(yellow|amber|orange|gul|limited|maybe|pending)(?:$|[\s_\-])/u.test(t)) return 'POSSIBLY_AVAILABLE';
            if (/(?:^|[\s_\-])(green|gronn|grønn|instock|in-stock)(?:$|[\s_\-])/u.test(t)) return 'IN_STOCK';
            return 'UNKNOWN';
        };
        function rgbStatus(input) {
            const m = String(input ?? '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/iu);
            if (!m) return 'UNKNOWN';
            const [, rr, gg, bb, aa] = m;
            if (aa !== undefined && Number(aa) < 0.6) return 'UNKNOWN';
            const [r, g, b] = [Number(rr), Number(gg), Number(bb)];
            // The prior red-first check classified Autoglass amber rgb(245,166,35) as red.
            if (r >= 170 && g >= 100 && g <= 220 && b <= 110 && r >= g && g > b * 1.4) return 'POSSIBLY_AVAILABLE';
            if (r >= 125 && r > g * 1.35 && r > b * 1.35) return 'OUT_OF_STOCK';
            if (g >= 90 && g > r * 1.2 && g > b * 1.18) return 'IN_STOCK';
            return 'UNKNOWN';
        }
        function stockFrom(el, { isStockCell = false } = {}) {
            if (typekodeOnly) return { status: 'UNKNOWN', evidence: 'TYPEKODE_ONLY_MODE' };
            if (!el) return { status: 'UNKNOWN', evidence: null };
            const t = clean([el.getAttribute?.('aria-label'), el.getAttribute?.('title'),
                el.getAttribute?.('data-stock'), text(el)].join(' ')).slice(0, 240);
            const semantic = labels(t);
            if (semantic !== 'UNKNOWN') return { status: semantic, evidence: 'Lagertekst: ' + t.slice(0, 110) };

            const candidates = [el, ...Array.from(el.querySelectorAll('span,i,svg,circle,div,[role="img"]')).slice(0, 30)];
            for (const candidate of candidates) {
                const cls = classText(candidate);
                const named = /lager|stock|availability|status|indicator|dot|circle|badge|traffic|light|rød|rod|green|yellow|gul|grønn|red/u.test(cls.toLocaleLowerCase());
                const rect = candidate.getBoundingClientRect();
                const compact = rect.width > 0 && rect.width <= 44 && rect.height > 0 && rect.height <= 44;
                if (!named && !(isStockCell && compact)) continue;
                const classStatus = colorClass(cls);
                if (classStatus !== 'UNKNOWN') return {status: classStatus, evidence: 'Fargeklasse: ' + cls.slice(0, 110)};
                const style = getComputedStyle(candidate);
                const styles = [style.backgroundColor, style.borderTopColor, style.color, style.fill];
                for (const color of styles) {
                    const status = rgbStatus(color);
                    if (status !== 'UNKNOWN') {
                        return { status, evidence: 'Indikatorfarge: ' + color };
                    }
                }
                try {
                    const before = getComputedStyle(candidate, '::before');
                    const status = rgbStatus(before.backgroundColor);
                    if (status !== 'UNKNOWN') return { status, evidence: 'Indikator::before: ' + before.backgroundColor };
                } catch { /* CSS pseudo-element unavailable */ }
            }
            return { status: 'UNKNOWN', evidence: null };
        }
        function findStock(row, explicitCell) {
            if (explicitCell) return stockFrom(explicitCell, { isStockCell: true });
            if (stockSelector) {
                try {
                    const chosen = row.querySelector(stockSelector);
                    if (chosen) return stockFrom(chosen, { isStockCell: true });
                } catch { /* Invalid custom CSS selector: use auto-detection. */ }
            }
            const likely = Array.from(row.querySelectorAll(
                '[class*="stock" i], [class*="lager" i], [class*="availability" i], [class*="status" i], [data-stock], [data-status], [aria-label*="lager" i]'
            )).slice(0, 20);
            for (const e of likely) {
                const found = stockFrom(e, { isStockCell: true });
                if (found.status !== 'UNKNOWN') return found;
            }
            // Only semantic text here; never infer a color from unrelated UI elements.
            const sem = labels(text(row));
            return sem === 'UNKNOWN' ? {status:'UNKNOWN',evidence:null} :
                {status: sem, evidence: 'Varelinjetekst (kontroller manuelt)'};
        }
        function sourceUrl(row) {
            // Detail pages can contain accessories, so their own URL takes precedence.
            if (location.pathname.includes('/produkt/')) return location.href.split('#')[0];
            const anchors = Array.from(row.querySelectorAll('a[href]'));
            const a = anchors.find(x => /\/produkt\//u.test(sameDomain(x.href)?.pathname || ''));
            return a ? sameDomain(a.href)?.href : null;
        }
        function skuOf(row, explicit) {
            const data = row.getAttribute?.('data-sku') ||
                row.querySelector?.('[data-sku]')?.getAttribute('data-sku') ||
                row.querySelector?.('[itemprop="sku"], .sku, [class*="article-number" i], [class*="varenr" i], [class*="artikkelnummer" i]')?.textContent ||
                explicit;
            if (data && clean(data)) {
                return clean(data).replace(/^(?:sku|varenr\.?|varenummer|art(?:ikkel)?nr\.?)\s*[:#]?\s*/iu, '').slice(0, 70);
            }
            const m = text(row).match(/(?:varenr\.?|varenummer|art(?:ikkel)?\.?\s*nr\.?|sku)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{2,59})/iu);
            return m ? m[1] : null;
        }
        function typeCodeOf(row) {
            // Supplier Typekode is a label/value field, not a keyword inferred from the title.
            // Restrict all inspection to the main product element. No related-products or body scan.
            const validType = /^(?:frontrute|bakrute|siderute|ventilrute|trekantrute|dørrute|dorrute|ventil\s*\/\s*siderute|sideglass|bakglass)\b/iu;
            function field(raw) {
                const original = String(raw ?? '').replace(/\u00a0/gu, ' ');
                const m = original.match(/\btypekode\s*[:：=\-]?\s*((?:frontrute|bakrute|siderute|ventilrute|trekantrute|dørrute|dorrute|ventil\s*\/\s*siderute|sideglass|bakglass)\b[^\r\n]{0,90})/iu);
                if (!m) return null;
                const value = clean(m[1].split(/\s+(?:varenummer|varenr\.?|artikkelnummer|pris|lagerstatus|lager|oslo|trondheim|kategori)\s*:?/iu)[0]).slice(0, 140);
                return validType.test(value) ? value : null;
            }
            for (const candidate of Array.from(row.querySelectorAll('[data-typekode],[data-typecode]')).slice(0, 20)) {
                const value = clean(candidate.getAttribute('data-typekode') || candidate.getAttribute('data-typecode'));
                if (validType.test(value)) return {raw:value.slice(0, 140), source:'SUPPLIER_TYPEKODE_DATA_FIELD'};
            }
            const specific = Array.from(row.querySelectorAll(
                '.product-loop-typecode,[class*="typecode" i],[class*="typekode" i],.product-meta-row,' +
                '.woocommerce-product-attributes tr,.product_meta tr,.product-full-description,' +
                '.woocommerce-product-details__short-description,dl,dt,dd,th,td,label,strong,b'
            )).slice(0, 350);
            for (const candidate of specific) {
                // Match textContent and innerText independently: one may preserve label/value line breaks.
                const raw = field(candidate.innerText) || field(candidate.textContent);
                if (raw) return {raw, source:'SUPPLIER_TYPEKODE_DETAIL_FIELD'};
                const label = clean(candidate.innerText || candidate.textContent);
                if (/^typekode\s*[:：=\-]?$/iu.test(label)) {
                    const siblings = [candidate.nextElementSibling, candidate.parentElement?.nextElementSibling];
                    for (const sibling of siblings) {
                        const value = clean(sibling?.innerText || sibling?.textContent);
                        if (validType.test(value)) return {raw:value.slice(0, 140), source:'SUPPLIER_TYPEKODE_LABEL_VALUE'};
                    }
                }
            }
            // Final fallback is only the current main product's own text, never document.body.
            if (row !== document.body && row !== document.documentElement) {
                const raw = field(row.innerText) || field(row.textContent);
                if (raw) return {raw, source:'SUPPLIER_TYPEKODE_MAIN_PRODUCT_TEXT'};
            }
            return {raw:null, source:null};
        }
        function priceOf(row, explicit) {
                    if (typekodeOnly) return { raw: null, evidence: 'TYPEKODE_ONLY_MODE' };
                    const marked = row.querySelector('del .amount, del .woocommerce-Price-amount');
                    const el = marked || row.querySelector(
                        '[itemprop="price"]', '[class*="regular-price" i]', '.price', '[class*="list-price" i]', '[class*="pris" i]'
                    );
                    let raw = clean(explicit || text(el));
                    let field = explicit ? 'TABLE_PRICE_COLUMN' : marked ? 'DISPLAYED_DELETED_PRICE' : 'DISPLAYED_PRICE_ELEMENT';
                    if (!raw && !explicit) {
                        const m = text(row).match(/(?:kr|nok)\s*[\d\s.,]+|[\d\s.,]+\s*(?:kr|nok)/iu);
                        if (m) { raw = clean(m[0]); field = 'ROW_TEXT_GUESS'; }
                    }
                    return { raw: raw || null, evidence: raw ? field : 'UNKNOWN' };
                }
        function add(row, {skuCell=null, priceCell=null, stockCell=null, nameCell=null, scope='CARD'}={}) {
            const sku = skuOf(row, skuCell ? text(skuCell) : null);
            const url = sourceUrl(row);
            if (!sku && !url) return;
            const titleElement = row.querySelector('.woocommerce-loop-product__title,[itemprop="name"],h1,h2,h3,h4');
            const link = row.querySelector('a[href*="/produkt/"]');
            const img = row.querySelector('img[alt]');
            const titleCandidates = [
                ['TEXT', text(nameCell) || text(titleElement)],
                ['LINK_LABEL', clean(link?.getAttribute('aria-label') || link?.getAttribute('title'))],
                ['IMAGE_ALT', clean(img?.getAttribute('alt'))],
                ['LINK_TEXT', text(link)],
                ['DETAIL_DOCUMENT_TITLE', url && location.pathname.includes('/produkt/')
                    ? document.title.replace(/\s*[-|]\s*Autoglass.*/iu,'') : '']
            ];
            const chosenTitle = titleCandidates.find(([, value]) => value && !/^(?:vis|les|kjøp|details|produkt)$/iu.test(value));
            const title = chosenTitle?.[1] || null;
            const titleSource = chosenTitle?.[0] || 'MISSING';
            const typeCode = typeCodeOf(row);
            const price = priceOf(row, priceCell ? text(priceCell) : null);
            const stock = findStock(row, stockCell);
            const categories = [...row.classList].filter(c => /^product_cat-/u.test(c)).slice(0, 15);
            const parentCategory = row.closest('[data-category]')?.getAttribute('data-category') || '';
            products.push({ sku, title: title?.slice(0, 260) || null, titleSource, url,
                ...(typekodeOnly ? {} : { priceText: price.raw?.slice(0, 110) || null, priceEvidence: price.evidence }),
                stockStatus: stock.status, stockEvidence: stock.evidence,
                categoryText: clean([parentCategory, ...categories].join(' ')).slice(0, 450),
                typeCodeRaw: typeCode.raw, typeCodeSource: typeCode.source,
                scope });
        }
        function indexOfHeader(headers, re) { return headers.findIndex(h => re.test(h)); }

        if (!isDetailPage) for (const table of document.querySelectorAll('table')) {
            const headers = Array.from(table.querySelectorAll('thead tr:first-child th'))
                .map(th => clean(th.innerText).toLocaleLowerCase());
            const skuIndex = indexOfHeader(headers, /art|varenr|vare.nr|sku|nummer/u);
            const priceIndex = indexOfHeader(headers, /pris|price|kr\b/u);
            const stockIndex = indexOfHeader(headers, /lager|stock|beholdning|tilgjengelig/u);
            const nameIndex = indexOfHeader(headers, /navn|produkt|beskrivelse|vare\b/u);
            for (const row of Array.from(table.querySelectorAll('tbody tr')).slice(0, 2500)) {
                const cells = Array.from(row.children).filter(e => /^(?:TD|TH)$/u.test(e.tagName));
                if (!cells.length) continue;
                add(row, { skuCell: cells[skuIndex] || null,
                    priceCell: cells[priceIndex] || null,
                    stockCell: cells[stockIndex] || null,
                    nameCell: cells[nameIndex] || null, scope: 'TABLE' });
            }
        }
        const cards = Array.from(document.querySelectorAll(
            'li.product, .products .product, .product-card, [data-sku], [itemtype*="Product"], [class*="product-item" i], [class*="product-row" i], .product-list-item'
        )).slice(0, 4000);
        for (const row of cards) {
            // A detail page can also show 'related products'. They must not be
            // mistaken for the current product or confirmed accessories.
            if (isDetailPage) continue;
            if (row.closest('table')) continue;
            // Prefer outermost product cards to prevent duplicate nested records.
            if (cards.some(other => other !== row && other.contains(row) && (other.hasAttribute('data-sku') || other.matches('li.product, .product-card, [itemtype*="Product"]')))) continue;
            add(row);
        }
        const accessories = [];
        let accessorySectionFound = false;
        if (isDetailPage) {
            const detail = document.querySelector('.product.type-product, .single-product .product, main .product') || document.body;
            add(detail, {scope:'DETAIL'});
            // Autoglass lists accessories in .accessory-products rows without product links.
            // Extract evidence only; these are NOT independently verified fitment claims.
            for (const section of document.querySelectorAll('.accessory-products')) {
                accessorySectionFound = true;
                for (const row of Array.from(section.querySelectorAll('.product-row')).slice(0, 150)) {
                    const sku = clean(text(row.querySelector('.accessory-sku'))).replace(/^(?:varenr|varenummer|sku)\s*[:#-]?\s*/iu, '').slice(0, 70);
                    if (!sku || !/[a-z0-9]/iu.test(sku)) continue;
                    const link = Array.from(row.querySelectorAll('a[href]'))
                        .map(a => sameDomain(a.href)).find(u => u && u.pathname.startsWith('/produkt/'));
                    const titleEl = row.querySelector('.accessory-title, .accessory-name, .product-name, .product-title, .product-description');
                    const rawPrice = text(row.querySelector('.accessory-price')) || null;
                    accessories.push({
                        sku,
                        title: (text(titleEl) || null)?.slice(0, 180) || null,
                        ...(typekodeOnly ? {} : { listPriceRaw: rawPrice }),
                        sourceUrl: link?.href || null,
                        sourcePage: location.href.split('#')[0],
                        relation: 'LISTED_IN_SUPPLIER_ACCESSORY_SECTION',
                        verifiedFitment: false,
                        priceVerified: false,
                        ...(typekodeOnly ? {} : { vatBasis: 'UNKNOWN' })
                    });
                }
            }
            // Only explicitly labelled accessory sections. Do not treat generic related
            // products/upsells as fitment evidence.
            const headingNodes = Array.from(document.querySelectorAll('h2,h3,h4,h5,[role="heading"],.wc-tabs li a'));
            for (const heading of headingNodes) {
                const headingText = text(heading);
                if (!/^(?:tilbehør|tilhorende tilbehør|tilhørende tilbehør|accessories)\b/iu.test(headingText)) continue;
                accessorySectionFound = true;
                const section = heading.closest('section, .woocommerce-Tabs-panel, .tab-pane, .tab-content') ||
                    heading.nextElementSibling || heading.parentElement?.nextElementSibling;
                if (!section || section === document.body || section === document.documentElement) continue;
                for (const link of Array.from(section.querySelectorAll('a[href]')).slice(0, 120)) {
                    const linkUrl = sameDomain(link.href);
                    if (!linkUrl || !linkUrl.pathname.startsWith('/produkt/') || linkUrl.pathname === location.pathname) continue;
                    const card = link.closest('li.product,.product-card,[data-sku],tr') || link;
                    const linkedSku = card.getAttribute?.('data-sku') || card.querySelector?.('.sku')?.textContent || null;
                    accessories.push({
                        sku: linkedSku ? clean(linkedSku).slice(0, 70) : null,
                        title: (text(card.querySelector?.('.woocommerce-loop-product__title')) || text(link) || null)?.slice(0, 180) || null,
                        sourceUrl: linkUrl.href,
                        relation: 'LISTED_IN_ACCESSORIES_SECTION',
                        verifiedFitment: false
                    });
                }
            }
        }
        if (!isDetailPage) for (const a of document.querySelectorAll('a[href]')) {
            const u = sameDomain(a.href);
            if (!u) continue;
            const path = u.pathname.toLocaleLowerCase();
            const next = a.rel === 'next' || /\bnext\b|page-numbers.*next/u.test(a.className || '') ||
                /neste|next/i.test(clean(a.getAttribute('aria-label') || a.textContent).slice(0, 40));
            const pagination = next || /\/page\/\d+(?:\/|$)|[?&](?:paged|product-page|page)=\d+/u.test(u.href);
            const category = path.startsWith('/varer/nettbutikk/') || path === '/varer/nettbutikk/';
            const product = path.startsWith('/produkt/');
            if (!pagination && !category && !product) continue;
            const k = u.href;
            navigable.set(k, {url:k, kind:pagination?'PAGINATION':product?'PRODUCT':'CATEGORY'});
        }
        const bodyText = document.body?.innerText || '';
        return {
            authWall: /du må være innlogget for å vise dette innholdet|you must be logged in to view this content/iu.test(bodyText),
            products,
            accessories: [...new Map(accessories.map(a => [a.sku ? 'sku:' + a.sku : 'url:' + a.sourceUrl, a])).values()],
            accessorySectionFound,
            links: [...navigable.values()].slice(0, 6000),
            diagnostics: {
                title: document.title.slice(0, 130),
                tableCount: document.querySelectorAll('table').length,
                rowCount: document.querySelectorAll('tbody tr').length,
                productCardCount: cards.length,
                matchedRecords: products.length,
                typeCodeElements: document.querySelectorAll('[class*="typecode" i],[class*="typekode" i]').length,
                detailTypeCodeLabelPresent: isDetailPage && /\btypekode\s*[:：=\-]?/iu.test(
                    (document.querySelector('.product.type-product, .single-product .product, main .product')?.innerText || '').slice(0, 15000)),
                extractedTypeCodes: products.filter(p => p.typeCodeRaw).length,
                priceClassCount: document.querySelectorAll('[class*="price" i],[class*="pris" i]').length,
                stockClassCount: document.querySelectorAll('[class*="stock" i],[class*="lager" i]').length,
                productLinkCount: document.querySelectorAll('a[href*="/produkt/"]').length,
                tableHeaders: Array.from(document.querySelectorAll('table thead th')).slice(0, 20)
                    .map(el => clean(el.textContent).slice(0, 50)),
                relevantClassNames: [...new Set(Array.from(document.querySelectorAll('[class]'))
                    .flatMap(el => Array.from(el.classList || []))
                    .filter(cls => /product|sku|article|stock|lager|price|pris|catalog|table|inventory/iu.test(cls))
                )].slice(0, 28)
            }
        };
    }, { stockSelector });

    const products = result.products.map((p) => {
        // Category and product URL are source evidence, not inferred fitment.
        // A URL slug fallback is marked explicitly and cannot create a verified price.
        const urlTitle = p.title || titleFromProductUrl(p.url);
        const titleSource = p.title ? p.titleSource : urlTitle ? 'URL_SLUG_DERIVED' : 'MISSING';
        const desc = [p.title, p.categoryText, p.url ? new URL(p.url).pathname : ''].filter(Boolean).join(' ');
        const { glassType, glassTypeSource, typeCodeConflict } = resolveGlassType({
            typeCodeRaw: parseTypeCode(p.typeCodeRaw), description: desc
        });
        const stockStatus = normalizeStock(p.stockStatus, p.stockEvidence);
        const sourcePriceKind = p.priceEvidence === 'DISPLAYED_DELETED_PRICE'
            ? 'UNVERIFIED_DISPLAYED_REGULAR' : 'UNVERIFIED_DISPLAYED';
        return applyReviewPolicy({
            sku: p.sku?.trim() || null,
            title: urlTitle || null,
            titleSource,
            glassType,
            glassTypeSource,
            typeCodeRaw: parseTypeCode(p.typeCodeRaw),
            typeCodeSource: p.typeCodeSource || null,
            typeCodeConflict,
            categoryEvidence: p.categoryText || null,
            sourceUrl: p.url || page.url(),
            sourcePage: page.url(),
            listPriceRaw: p.priceText || null,
            listPriceValue: parseNorwegianPrice(p.priceText),
            currency: 'NOK_UNVERIFIED',
            sourcePriceKind,
            vatBasis: 'UNKNOWN',
            discountPercentPolicy: pricePolicy(glassType).discountPercent,
            customerPriceInclVat: null,
            stockStatus,
            stockEvidence: p.stockEvidence,
            stockQuantity: null,
            stockCheckedAt: new Date().toISOString(),
            priceEvidence: p.priceEvidence,
            scope: p.scope,
            accessories: p.scope === 'DETAIL' ? result.accessories : [],
            accessorySectionFound: p.scope === 'DETAIL' ? result.accessorySectionFound : false,
            verification: 'UNVERIFIED_DISCOVERY_ONLY'
        });
    });
    return { ...result, products };
}

export function allowedUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:' || u.hostname.replace(/^www\./u, '') !== new URL(BASE_URL).hostname) return null;
        u.hash = '';
        return u.href;
    } catch { return null; }
}
