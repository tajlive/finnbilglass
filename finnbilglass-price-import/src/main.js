import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { Actor, log } from 'apify';
import { pricePolicy } from './pricing.js';
import { allowedUrl, extractFromPage } from './extract.js';
import { directProductMode, startQueue, shouldFollowLink, shouldKeepProduct } from './crawl-plan.js';
import { applyReviewPolicy } from './side-review.js';

const LOGIN_URL = 'https://auto-glass.no/min-konto/';
const PRODUCT_PROBE_URL = 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-12-ventilrutesotet-2/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redactMessage(error) {
    // Do not risk printing browser URLs with credentials, cookies, or HTML form contents.
    const name = error?.name === 'TimeoutError' ? 'TimeoutError' : 'NavigationError';
    return `${name}; kontroller startadresse/tilgang i Apify.`;
}
function requireSettings(input) {
    if (!input.username?.trim() || !input.password) {
        throw new Error('Fyll ut de krypterte feltene Autoglass brukernavn og passord i Apify Input.');
    }
    const mode = input.mode || 'probe';
    if (!['probe', 'incremental', 'full'].includes(mode)) throw new Error('Ukjent mode.');
    
    // Typekode-only mode: when enabled, only collect typekode fields, never prices/stock
    const typekodeOnly = Boolean(input.typekodeOnly);
    
    const catalogUrls = Array.isArray(input.catalogUrls) && input.catalogUrls.length
        ? input.catalogUrls : ['https://auto-glass.no/varer/nettbutikk/autoglass/'];
    const urls = catalogUrls.map((entry) => allowedUrl(typeof entry === 'string' ? entry : entry?.url));
    if (urls.some((u) => !u)) throw new Error('Alle katalogadresser må ha https://auto-glass.no som domene.');
    
    // Hard limits - enforced strictly
    const maxPages = Math.max(1, Math.min(30000, Number(input.maxPages || 8)));
    const maxProducts = Math.max(1, Math.min(100000, Number(input.maxProducts || 50)));
    
    return {
        mode, username: input.username.trim(), password: input.password,
        urls, maxPages, maxProducts,
        includeProductPages: Boolean(input.includeProductPages),
        saveState: Boolean(input.saveState) && mode !== 'probe',
        typekodeOnly,
        minProductsForFull: Math.max(1, Number(input.minProductsForFull || 100)),
        throttleMs: Math.max(400, Math.min(30000, Number(input.throttleMs || 1100))),
        stockSelector: typekodeOnly ? '' : String(input.stockSelector || '').trim(),
        allowReconciliation: Boolean(input.allowReconciliation)
    };
}
async function saveLoginDiagnostics(page, phase, responseStatus = null) {
    // All fields are deliberately coarse; never write cookies, form contents, request headers,
    // full URLs, account identities, access tokens or screenshots to the dataset/logs.
    let pageSignals = {domInspectionFailed: true};
    try {
        pageSignals = await page.evaluate(() => {
            const body = (document.body?.innerText || '').slice(0, 4000);
            return {
                usernameFieldCount: document.querySelectorAll('input[name="username"]').length,
                visibleUsernameFields: Array.from(document.querySelectorAll('input[name="username"]'))
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        const style = getComputedStyle(el);
                        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
                    }).length,
                passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
                loginSubmitCount: document.querySelectorAll('button[name="login"], input[name="login"][type="submit"]').length,
                formCount: document.querySelectorAll('form').length,
                iframeCount: document.querySelectorAll('iframe').length,
                loginWallVisible: /du må være innlogget for å vise dette innholdet/iu.test(body),
                challengeVisible: /verify you are human|just a moment|captcha|sikkerhetssjekk/iu.test(body)
            };
        });
    } catch {
        // Browser page may not be reachable; retain the stage/error code without raw browser errors.
    }
    const current = page.url();
    let safePath = 'unavailable';
    try {
        const url = new URL(current);
        safePath = url.hostname === 'auto-glass.no' || url.hostname === 'www.auto-glass.no'
            ? url.pathname : 'external-or-browser';
    } catch { /* No URL */ }
    const report = {
        phase,
        observedAt: new Date().toISOString(),
        httpStatus: Number.isInteger(responseStatus) ? responseStatus : null,
        locationPath: safePath,
        ...pageSignals
    };
    await Actor.setValue('LOGIN_DIAGNOSTICS', report);
    log.info(`FBG_LOGIN_DIAGNOSTICS phase=${phase}, http=${report.httpStatus ?? 'unknown'}, ` +
        `path=${safePath}, usernameFields=${report.usernameFieldCount ?? 'unknown'}, ` +
        `visible=${report.visibleUsernameFields ?? 'unknown'}, ` +
        `passwordFields=${report.passwordFieldCount ?? 'unknown'}, challenge=${report.challengeVisible ?? false}`);
    return report;
}

async function login(page, { username, password }, setStage) {
    setStage('LOGIN_NAVIGATION');
    let response;
    try {
        response = await page.goto(LOGIN_URL, {waitUntil: 'domcontentloaded', timeout: 45000});
    } catch {
        await saveLoginDiagnostics(page, 'LOGIN_NAVIGATION_FAILED');
        throw new Error('LOGIN_NAVIGATION_FAILED');
    }
    setStage('LOGIN_FORM');
    // Keep a safe diagnostic even if the login form never becomes visible.
    await saveLoginDiagnostics(page, 'LOGIN_PAGE_LOADED', response?.status());
    try {
        await page.locator('input[name="username"]').waitFor({state: 'visible', timeout: 20000});
    } catch {
        await saveLoginDiagnostics(page, 'LOGIN_FORM_NOT_VISIBLE', response?.status());
        throw new Error('LOGIN_FORM_NOT_VISIBLE');
    }
    setStage('LOGIN_SUBMISSION');
    try {
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="password"]').fill(password);
        // Clicking the real WooCommerce form submits its site-generated nonce.
        await page.locator('button[name="login"], input[name="login"][type="submit"]')
            .first().click({timeout: 20000});
    } catch {
        await saveLoginDiagnostics(page, 'LOGIN_SUBMISSION_FAILED', response?.status());
        throw new Error('LOGIN_SUBMISSION_FAILED');
    }
    await page.waitForLoadState('domcontentloaded', {timeout: 25000}).catch(() => {});
    await sleep(1100);
    if (await page.locator('input[name="password"]').count()) {
        await saveLoginDiagnostics(page, 'LOGIN_NOT_ACCEPTED');
        throw new Error('LOGIN_NOT_ACCEPTED_OR_EXTRA_AUTH_REQUIRED');
    }
    setStage('SESSION_VERIFICATION');
    try {
        response = await page.goto(PRODUCT_PROBE_URL, {waitUntil: 'domcontentloaded', timeout: 45000});
    } catch {
        await saveLoginDiagnostics(page, 'SESSION_VERIFICATION_NAVIGATION_FAILED');
        throw new Error('SESSION_VERIFICATION_NAVIGATION_FAILED');
    }
    const blocked = await page.locator('body').evaluate((body) =>
        /du må være innlogget for å vise dette innholdet/iu.test(body.innerText || ''));
    if (blocked) {
        await saveLoginDiagnostics(page, 'SESSION_NOT_AUTHORIZED', response?.status());
        throw new Error('SESSION_NOT_AUTHORIZED');
    }
    await saveLoginDiagnostics(page, 'SESSION_VERIFIED', response?.status());
    log.info('Autoglass-sesjon verifisert på beskyttet produktadresse.');
}

function mergeRecord(old, incoming) {
    if (!old) return incoming;
    const better = {
        ...old,
        ...incoming,
        // An observed title always outranks a title derived from a URL slug.
        title: incoming.title && (incoming.titleSource !== 'URL_SLUG_DERIVED' || !old.title)
            ? incoming.title : old.title || incoming.title,
        titleSource: incoming.title && (incoming.titleSource !== 'URL_SLUG_DERIVED' || !old.title)
            ? incoming.titleSource : old.titleSource || incoming.titleSource,
        glassType: incoming.glassType !== 'UNKNOWN' ? incoming.glassType : old.glassType,
        glassTypeSource: incoming.glassTypeSource !== 'UNKNOWN' ? incoming.glassTypeSource : old.glassTypeSource,
        typeCodeRaw: incoming.typeCodeRaw || old.typeCodeRaw || null,
        typeCodeSource: incoming.typeCodeRaw ? incoming.typeCodeSource : old.typeCodeSource,
        typeCodeConflict: Boolean(old.typeCodeConflict || incoming.typeCodeConflict),
        typeCodeObservations: [...new Set([...(old.typeCodeObservations || []), ...(incoming.typeCodeObservations || []), old.typeCodeRaw, incoming.typeCodeRaw].filter(Boolean))],
        categoryEvidence: incoming.categoryEvidence || old.categoryEvidence,
        listPriceRaw: incoming.listPriceRaw || old.listPriceRaw,
        listPriceValue: incoming.listPriceValue ?? old.listPriceValue,
        priceEvidence: incoming.listPriceValue !== null ? incoming.priceEvidence : old.priceEvidence,
        sourcePriceKind: incoming.listPriceValue !== null ? incoming.sourcePriceKind : old.sourcePriceKind,
        stockStatus: incoming.stockStatus !== 'UNKNOWN' ? incoming.stockStatus : old.stockStatus,
        stockEvidence: incoming.stockStatus !== 'UNKNOWN' ? incoming.stockEvidence : old.stockEvidence,
        sourceUrl: incoming.sourceUrl || old.sourceUrl,
        scope: incoming.scope === 'DETAIL' ? 'DETAIL' : old.scope,
        accessories: [...new Map([...(old.accessories || []), ...(incoming.accessories || [])]
            .map(a => [a.sku ? 'sku:' + a.sku : 'url:' + a.sourceUrl, a])).values()],
        accessorySectionFound: Boolean(old.accessorySectionFound || incoming.accessorySectionFound)
    };
    // A verified source label is stronger than an inferred URL/card description,
    // but any disagreement is quarantined from automatic glass discounting.
    if (better.typeCodeConflict) {
        better.glassType = 'UNKNOWN';
        better.glassTypeSource = 'TYPECODE_CONFLICT_REVIEW';
    } else if (incoming.typeCodeRaw) {
        better.glassType = incoming.glassType;
        better.glassTypeSource = incoming.glassTypeSource;
    }
    better.discountPercentPolicy = pricePolicy(better.glassType).discountPercent;
    // Neither old nor incoming can ever set a trusted customer price automatically.
    better.customerPriceInclVat = null;
    better.vatBasis = 'UNKNOWN';
    better.verification = 'UNVERIFIED_DISCOVERY_ONLY';
    return applyReviewPolicy(better, [...(old.reviewReasons || []), ...(incoming.reviewReasons || [])]);
}

async function updateCatalogState(records, summary, config) {
    if (!config.saveState) return {saved: false, reason: 'saveState=false (trygg prøve)'};
    const store = await Actor.openKeyValueStore('finnbilglass-autoglass-catalog');
    const oldIndex = (await store.getValue('INDEX')) || {skus: [], lastFullRun: null};
    const newIndex = new Set(oldIndex.skus || []);
    const seen = new Set();

    // Only verified-complete full traversals can produce reconciliation candidates.
    // Reconciliation additionally requires an explicit user opt-in.
    const eligible = config.mode === 'full' && summary.linkTraversalComplete &&
        records.length >= config.minProductsForFull && config.allowReconciliation;
    const previousCount = (oldIndex.skus || []).length;
    const suspiciousShrink = previousCount > 0 && records.length < previousCount * 0.8;
    if (config.mode === 'full' && !summary.linkTraversalComplete) {
        log.warning('Full kjøring var begrenset: avstemming/utgåtte varer er sperret.');
    }
    if (config.mode === 'full' && suspiciousShrink) {
        log.warning('Antall funn falt med over 20 %: avstemming/utgåtte varer er sperret.');
    }

    const changes = {new: 0, changed: 0, unchanged: 0, missingUnconfirmed: 0};
    for (const product of records) {
        const sku = product.sku;
        const key = `SKU_${crypto.createHash('sha256').update(sku).digest('hex')}`;
        const previous = await store.getValue(key);
        const changed = !previous ||
            previous.listPriceValue !== product.listPriceValue ||
            previous.stockStatus !== product.stockStatus ||
            previous.glassType !== product.glassType;
        if (!previous) changes.new += 1;
        else if (changed) changes.changed += 1;
        else changes.unchanged += 1;
        await store.setValue(key, {
            ...product, firstSeenAt: previous?.firstSeenAt || summary.finishedAt,
            lastSeenAt: summary.finishedAt,
            lastChangedAt: changed ? summary.finishedAt : previous.lastChangedAt,
            state: 'OBSERVED',
            auditRequired: true
        });
        newIndex.add(sku);
        seen.add(sku);
    }

    if (eligible && !suspiciousShrink) {
        for (const sku of oldIndex.skus || []) {
            if (seen.has(sku)) continue;
            const key = `SKU_${crypto.createHash('sha256').update(sku).digest('hex')}`;
            const previous = await store.getValue(key);
            if (!previous) continue;
            await store.setValue(key, {
                ...previous,
                state: 'MISSING_UNCONFIRMED',
                auditRequired: true,
                lastMissingInFullScanAt: summary.finishedAt
            });
            changes.missingUnconfirmed += 1;
        }
    }
    await store.setValue('INDEX', {
        skus: [...newIndex],
        lastSuccessfulRun: summary.finishedAt,
        lastFullRun: eligible && !suspiciousShrink ? summary.finishedAt : oldIndex.lastFullRun
    });
    await store.setValue('LAST_CHANGE_SUMMARY', { ...changes, mode: config.mode,
        at: summary.finishedAt, reconciliationApplied: eligible && !suspiciousShrink });
    return {saved: true, ...changes, reconciliationApplied: eligible && !suspiciousShrink};
}

await Actor.init();
let browser;
let exitCode = 0;
let statusMessage = 'FinnBilGlass: fullført skrivebeskyttet innhenting.';
let stage = 'INPUT_VALIDATION';
const setStage = (nextStage) => {
    stage = nextStage;
    log.info(`FBG_STAGE ${nextStage}`);
};
try {
    const config = requireSettings((await Actor.getInput()) || {});
    setStage('BROWSER_LAUNCH');
    // The Apify Chrome image installs Google Chrome and exposes its executable path.
    // Using Playwright's implicit Chromium path can fail when the npm Playwright
    // version does not match the image's bundled Chromium revision.
    const chromeExecutable = process.env.APIFY_CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome';
    const browserDiagnostics = {
        stage: 'BROWSER_LAUNCH',
        checkedAt: new Date().toISOString(),
        chromePathSource: process.env.APIFY_CHROME_EXECUTABLE_PATH ? 'APIFY_ENV' : 'IMAGE_DEFAULT',
        chromeExecutablePresent: existsSync(chromeExecutable),
        implicitPlaywrightChromiumPresent: existsSync(chromium.executablePath()),
        platform: process.platform,
        errorCode: null
    };
    await Actor.setValue('BROWSER_DIAGNOSTICS', browserDiagnostics).catch(() => {});
    log.info(`FBG_BROWSER chrome_present=${browserDiagnostics.chromeExecutablePresent} ` +
        `bundled_chromium_present=${browserDiagnostics.implicitPlaywrightChromiumPresent}`);
    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: chromeExecutable,
            chromiumSandbox: false
        });
    } catch (error) {
        // The raw Playwright exception may contain URLs or local paths. Never save it.
        const detail = String(error?.message || '');
        const errorCode = /executable doesn't exist|no such file|ENOENT/iu.test(detail)
            ? 'BROWSER_BINARY_MISSING'
            : /lib[^\s]+\.so|shared libraries/iu.test(detail)
                ? 'BROWSER_SYSTEM_LIBRARY_MISSING'
                : /sandbox|namespace|permission denied|EPERM/iu.test(detail)
                    ? 'BROWSER_SANDBOX_OR_PERMISSION_ERROR'
                    : /target page, context or browser has been closed|browser has been closed/iu.test(detail)
                        ? 'BROWSER_CLOSED_DURING_LAUNCH'
                        : 'BROWSER_LAUNCH_FAILED_OTHER';
        await Actor.setValue('BROWSER_DIAGNOSTICS', {
            ...browserDiagnostics,
            errorCode,
            errorType: error?.name === 'TimeoutError' ? 'TimeoutError' : 'LaunchError'
        }).catch(() => {});
        throw new Error(errorCode);
    }
    setStage('BROWSER_CONTEXT');
    const context = await browser.newContext({
        locale: 'nb-NO',
        timezoneId: 'Europe/Oslo',
        viewport: {width: 1440, height: 1000}
    });
    setStage('BROWSER_PAGE');
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await login(page, config, setStage);
    setStage('CATALOG_CRAWL');

    const directProductRun = directProductMode(config.urls);
    const requestedProductUrls = new Set(config.urls.map(url => new URL(url).origin + new URL(url).pathname));
    const queue = startQueue(config.urls);
    if (directProductRun) log.info(`FBG_DIRECT_PRODUCT_MODE starts=${config.urls.length}; no catalog/breadcrumb traversal.`);
    const visited = new Set();
    const recordsBySku = new Map();
    const observations = [];
    let pageCount = 0;
    let hitItemLimit = false;
    let detailOnlyAfterCap = false;

    // Hard limit enforcement function
    const checkLimits = () => {
        if (pageCount >= config.maxPages) {
            log.info(`FBG_HARD_LIMIT: maxPages (${config.maxPages}) reached, stopping crawl`);
            return true;
        }
        if (recordsBySku.size >= config.maxProducts) {
            log.info(`FBG_HARD_LIMIT: maxProducts (${config.maxProducts}) reached, stopping crawl`);
            return true;
        }
        return false;
    };

    while (queue.length && pageCount < config.maxPages) {
        // Hard limit check BEFORE each page load
        if (checkLimits()) break;

        const next = queue.shift();
        const url = allowedUrl(next?.url);
        if (!url || visited.has(url)) continue;
        visited.add(url);

        if (pageCount) await sleep(config.throttleMs);
        try {
            await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 45000});
            await page.waitForTimeout(700);
        } catch (error) {
            throw new Error('Katalogside kunne ikke lastes: ' + redactMessage(error));
        }

        const result = await extractFromPage(page, {stockSelector: config.stockSelector, typekodeOnly: config.typekodeOnly});
        if (result.authWall) throw new Error('Autoglass-sesjonen utløp. Kjør på nytt med sikker innlogging.');
        pageCount += 1;
        observations.push({
            path: new URL(url).pathname,
            title: result.diagnostics.title,
            ...result.diagnostics
        });
        log.info(`Side ${pageCount}: ${result.products.length} kandidater; totalt ${recordsBySku.size} unike varer.`);

        // Process products on the current page BEFORE checking hard limits.
        // The hard limit must not discard products already extracted from
        // a page we have loaded and paid for. It only prevents loading NEW pages.
        for (const product of result.products) {
            if (!shouldKeepProduct(product, {directProductRun, requestedProductUrls})) continue;
            let key = product.sku?.toLocaleUpperCase('en-US');
            if (!key && next.kind === 'PRODUCT') {
                key = [...recordsBySku.entries()].find(([, p]) => p.sourceUrl === product.sourceUrl)?.[0];
            }
            if (!key || (!recordsBySku.has(key) && recordsBySku.size >= config.maxProducts)) continue;
            recordsBySku.set(key, mergeRecord(recordsBySku.get(key), product));
            
            // Hard limit check after each product
            if (recordsBySku.size >= config.maxProducts) {
                hitItemLimit = true;
                log.info(`FBG_HARD_LIMIT: maxProducts reached during product processing`);
                break;
            }
        }

        // Hard limit check after processing products on this page
        if (checkLimits()) break;

        const seenQueued = new Set(queue.map(x => x.url));
        const linksInPriorityOrder = [...result.links].sort((a, b) => {
            const rank = config.mode === 'probe'
                ? {PAGINATION: 0, PRODUCT: 1, CATEGORY: 2}
                : {PAGINATION: 0, CATEGORY: 1, PRODUCT: 2};
            return (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3);
        });
        for (const link of linksInPriorityOrder) {
            if (!shouldFollowLink(link, {directProductRun, includeProductPages:config.includeProductPages})) continue;
            const candidate = allowedUrl(link.url);
            if (!candidate || visited.has(candidate) || seenQueued.has(candidate)) continue;
            queue.push({url: candidate, kind: link.kind});
            seenQueued.add(candidate);
        }

        // Final hard limit check at end of loop
        if (checkLimits()) break;
    }
    // Final limit check after crawl
    if (recordsBySku.size >= config.maxProducts) {
        hitItemLimit = true;
    }
    setStage('WRITING_RESULTS');
    const records = [...recordsBySku.values()].slice(0, config.maxProducts);

    // Typekode-only mode: explicit allow-list of fields that may survive.
    // Every field not on this list is removed, including nested objects.
    // This is a positive allow-list, not a delete-list — any new field added
    // in the future is excluded by default unless explicitly listed here.
    if (config.typekodeOnly) {
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
        for (const r of records) {
            // Strip top-level fields not on the allow-list
            for (const key of Object.keys(r)) {
                if (!TOP_LEVEL_ALLOWED.has(key)) {
                    delete r[key];
                }
            }
            // Recursively strip accessories of all commercial fields
            if (Array.isArray(r.accessories)) {
                for (const a of r.accessories) {
                    for (const key of Object.keys(a)) {
                        if (!ACCESSORY_ALLOWED.has(key)) {
                            delete a[key];
                        }
                    }
                    // Accessories are never price-verified in Typekode-only mode
                    a.priceVerified = false;
                }
            }
        }
    }

    const summary = {
        mode: config.mode,
        directProductMode: directProductRun,
        finishedAt: new Date().toISOString(),
        pagesVisited: pageCount,
        items: records.length,
        withPrices: config.typekodeOnly ? 0 : records.filter(p => p.listPriceValue !== null).length,
        withStockSignals: config.typekodeOnly ? 0 : records.filter(p => p.stockStatus !== 'UNKNOWN').length,
        inStock: config.typekodeOnly ? 0 : records.filter(p => p.stockStatus === 'IN_STOCK').length,
        maybeStock: config.typekodeOnly ? 0 : records.filter(p => p.stockStatus === 'POSSIBLY_AVAILABLE').length,
        outOfStock: config.typekodeOnly ? 0 : records.filter(p => p.stockStatus === 'OUT_OF_STOCK').length,
        unknownStock: config.typekodeOnly ? 0 : records.filter(p => p.stockStatus === 'UNKNOWN').length,
        productTitles: records.filter(p => p.title).length,
        productTitlesDerivedFromUrl: records.filter(p => p.titleSource === 'URL_SLUG_DERIVED').length,
        knownGlassTypes: records.filter(p => ['FRONTRUTE','OVRIG_GLASS'].includes(p.glassType)).length,
        explicitTypeCodes: records.filter(p => p.typeCodeRaw).length,
        typeCodeConflicts: records.filter(p => p.typeCodeConflict).length,
        sideConflicts: records.filter(p => p.sideConflict).length,
        productsRequiringManualReview: records.filter(p => p.manualReviewRequired).length,
        automaticOrdersAllowed: records.filter(p => p.automaticOrderAllowed).length,
        excludedNonGlass: records.filter(p => p.glassType === 'EXCLUDED').length,
        accessorySectionsFound: records.filter(p => p.accessorySectionFound).length,
        accessoryLinksFound: records.reduce((n, p) => n + (p.accessories || []).length, 0),
        // Link traversal is not proof that the site's entire inventory was discovered.
        linkTraversalComplete: !directProductRun && queue.length === 0 && !hitItemLimit && pageCount < config.maxPages,
        siteInventoryCompletenessVerified: false,
        pricesVerified: false,
        notes: 'List prices, VAT status, completeness and stock colors require source verification.'
    };
    await Actor.setValue('SUMMARY', summary);
    await Actor.setValue('PAGE_DIAGNOSTICS', observations);
    await Actor.setValue('VALIDATION_DIAGNOSTICS', {
        verifiedCustomerPrices: 0,
        allowedForCustomerPricing: false,
        productsWithMissingTitles: records.filter(p => !p.title).length,
        productsWithUrlDerivedTitles: summary.productTitlesDerivedFromUrl,
        missingGlassClassifications: records.filter(p => p.glassType === 'UNKNOWN').length,
        typeCodeConflictsRequiringReview: summary.typeCodeConflicts,
        sideConflictsRequiringReview: summary.sideConflicts,
        productsRequiringManualReview: summary.productsRequiringManualReview,
        automaticOrdersAllowed: 0,
        productsWithExplicitTypeCode: summary.explicitTypeCodes,
        amberStockSignals: records.filter(p => p.stockStatus === 'POSSIBLY_AVAILABLE').length,
        accessoriesListedNotFitmentVerified: summary.accessoryLinksFound,
        catalogueCompletenessVerified: false,
        readyForProduction: false
    });
    if (records.length) {
        await Actor.pushData(records);
        const state = await updateCatalogState(records, summary, config);
        log.info(`Ferdig: ${records.length} varer, ${summary.withPrices} priser, ${summary.withStockSignals} lagerindikatorer. ` +
            `Tilstand lagret: ${state.saved ? 'ja' : 'nei'}.`);
    } else {
        log.warning('Ingen varenummer funnet. Se Key-value store → PAGE_DIAGNOSTICS. ' +
            'Ingen priser eller lagerstatus er importert. Produktlistens faktiske HTML må kartlegges.');
        // A zero-product run is a failure for automated schedules, not a successful empty import.
        throw new Error('0 produkter hentet. Katalogens strukturer må verifiseres før automatisk synk.');
    }
    statusMessage = `FinnBilGlass: ${records.length} varer; ${summary.withPrices} uverifiserte priser, ${summary.withStockSignals} lagerindikatorer.`;
} catch (error) {
    exitCode = 1;
    const message = String(error?.message || '');
    const safeCodes = new Set([
        'LOGIN_NAVIGATION_FAILED', 'LOGIN_FORM_NOT_VISIBLE', 'LOGIN_SUBMISSION_FAILED',
        'LOGIN_NOT_ACCEPTED_OR_EXTRA_AUTH_REQUIRED', 'SESSION_VERIFICATION_NAVIGATION_FAILED',
        'SESSION_NOT_AUTHORIZED',
        'BROWSER_BINARY_MISSING', 'BROWSER_SYSTEM_LIBRARY_MISSING',
        'BROWSER_SANDBOX_OR_PERMISSION_ERROR', 'BROWSER_CLOSED_DURING_LAUNCH',
        'BROWSER_LAUNCH_FAILED_OTHER'
    ]);
    const safeCode = safeCodes.has(message) ? message
        : /Autoglass|katalog|produkter|URL|mode|krypterte|0 produkter|sider/i.test(message)
            ? 'APPLICATION_VALIDATION_FAILED' : 'UNEXPECTED_RUNTIME_ERROR';
    // Do not log the raw error message/stack because Playwright can embed URLs or form fields.
    statusMessage = `FinnBilGlass: import stoppet ved ${stage}. Kode: ${safeCode}. ` +
        'Se Key-value store → BROWSER_DIAGNOSTICS eller LOGIN_DIAGNOSTICS (ingen hemmeligheter).';
    await Actor.setValue('ERROR_DIAGNOSTICS', {
        stage, code: safeCode, failedAt: new Date().toISOString()
    }).catch(() => {});
    log.error(statusMessage);
} finally {
    if (browser) await browser.close().catch(() => {});
    await Actor.exit({exitCode, statusMessage});
}
