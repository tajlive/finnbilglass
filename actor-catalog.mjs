/**
 * Apify Actor: FinnBilGlass Catalog Scraper
 *
 * Uses Glavista sitemap to fetch 20-50 front glass products
 * and stores results in an Apify Dataset for staging validation.
 * Supports checkpoint/resume for long-running crawls.
 *
 * @version 0.2.0
 */

import { Actor, log } from 'apify';
import cheerio from 'cheerio';

// ---------- CONSTANTS ----------
const PROBE_LIMIT = 5;
const MAX_PRODUCTS = 50;
const MIN_PRODUCTS = 20;
const CHECKPOINT_KEY = 'crawl-checkpoint';

// Glavista sitemap (from existing scraper)
const GLAVISTA_SITEMAP = 'https://www.glavista.com/sitemap-guardian-en-products.xml';

/**
 * Normalize eurocode
 */
function normEurocode(code) {
    return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Strip HTML tags and normalize whitespace
 */
function stripTags(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fetch all product URLs from Glavista sitemap
 * @returns {Array<string>} Array of product URLs
 */
async function getGlavistaProductUrls() {
    console.log('[glavista] Fetching sitemap...');
    const response = await fetch(GLAVISTA_SITEMAP, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinnBilGlassBot/1.0)' }
    });
    if (!response.ok) {
        throw new Error(`Sitemap HTTP ${response.status}`);
    }
    const xml = await response.text();
    
    // Extract URLs from sitemap - they point to guardianautomotiveglass.com but we use www.glavista.com
    const urls = [];
    const urlRegex = /<loc>(https:\/\/www\.guardianautomotiveglass\.com\/en\/windscreen\/[^<]+)<\/loc>/g;
    let match;
    while ((match = urlRegex.exec(xml)) !== null) {
        const url = match[1].replace('https://www.guardianautomotiveglass.com', 'https://www.glavista.com');
        urls.push(url);
    }
    
    console.log(`[glavista] Found ${urls.length} product URLs in sitemap`);
    return urls;
}

/**
 * Load checkpoint from KeyValueStore
 * @returns {Object|null} Checkpoint data or null if not found
 */
async function loadCheckpoint() {
    try {
        const kvs = await Actor.openKeyValueStore('finnbilglass-checkpoints');
        const checkpoint = await kvs.getValue(CHECKPOINT_KEY);
        if (checkpoint) {
            console.log(`[checkpoint] Resuming from index ${checkpoint.lastIndex}, ${checkpoint.processedUrls?.length || 0} URLs already processed`);
            return checkpoint;
        }
    } catch (err) {
        console.warn(`[checkpoint] Could not load checkpoint: ${err.message}`);
    }
    return null;
}

/**
 * Save checkpoint to KeyValueStore
 * @param {number} lastIndex - Last processed index
 * @param {Array<string>} processedUrls - Array of already processed URLs
 * @param {number} saved - Number of products saved
 */
async function saveCheckpoint(lastIndex, processedUrls, saved) {
    try {
        const kvs = await Actor.openKeyValueStore('finnbilglass-checkpoints');
        await kvs.setValue(CHECKPOINT_KEY, {
            lastIndex,
            processedUrls,
            saved,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.warn(`[checkpoint] Could not save checkpoint: ${err.message}`);
    }
}

/**
 * Clear checkpoint after successful completion
 */
async function clearCheckpoint() {
    try {
        const kvs = await Actor.openKeyValueStore('finnbilglass-checkpoints');
        await kvs.setValue(CHECKPOINT_KEY, null);
    } catch (err) {
        console.warn(`[checkpoint] Could not clear checkpoint: ${err.message}`);
    }
}

/**
 * Parse a price string from Glavista ("1,487.38 €" / "1.487,38 €" / "525 €")
 * Returns { amount: number|null, currency: string }
 * NEVER guesses a currency: EUR only when the € symbol is present.
 */
function parsePrice(raw) {
    const s = stripTags(raw);
    if (!s) return { amount: null, currency: null };

    const currency = s.includes('€') ? 'EUR' : (s.toUpperCase().includes('NOK') ? 'NOK' : null);
    const digits = s.replace(/[^\d.,-]/g, '').trim();
    if (!digits) return { amount: null, currency };

    const lastComma = digits.lastIndexOf(',');
    const lastDot = digits.lastIndexOf('.');
    let normalized = digits;

    if (lastComma > -1 && lastDot > -1) {
        // Both present: the rightmost one is the decimal separator
        if (lastComma > lastDot) normalized = digits.replace(/\./g, '').replace(',', '.');
        else normalized = digits.replace(/,/g, '');
    } else if (lastComma > -1) {
        // Only comma: decimal separator if exactly 2 trailing digits, else thousands
        const trailing = digits.length - lastComma - 1;
        normalized = trailing === 2 ? digits.replace(',', '.') : digits.replace(/,/g, '');
    }

    const amount = Number.parseFloat(normalized);
    return { amount: Number.isFinite(amount) ? amount : null, currency };
}

/**
 * Fetch a URL with retries (Glavista intermittently answers 504)
 */
async function fetchWithRetry(url, { attempts = 4, baseDelayMs = 2000 } = {}) {
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinnBilGlassBot/1.0)' },
                signal: AbortSignal.timeout(30000),
            });
            if (response.ok) return response;

            lastErr = new Error(`HTTP ${response.status}`);
            // Retry only transient upstream errors
            if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
                throw lastErr;
            }
        } catch (err) {
            lastErr = err;
            if (attempt === attempts) throw err;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[retry] ${lastErr.message} for ${url} — attempt ${attempt}/${attempts}, waiting ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr || new Error('fetch failed');
}

/**
 * Extract product data from Glavista product page
 * @param {CheerioAPI} $ - Cheerio API
 * @param {string} url - Source URL
 * @returns {Object|null} Product object or null if extraction fails
 */
function extractGlavistaProduct($, url = '') {
    const meta = (prop) => {
        const m = $('[itemprop="' + prop + '"]').attr('content');
        return m ? m.trim() : '';
    };
    
    // Get mpn (eurocode) from meta or URL
    const mpn = meta('mpn');
    const gtin = meta('gtin13');
    const brand = meta('brand');
    const desc = meta('description'); // "Eurocode: X OE Number: a, b Glavista Number: Y"
    
    // Name from h1
    const h1Text = $('h1').first().text().trim();
    const navn = stripTags(h1Text);
    
    // OE numbers from description
    let oe = [];
    const oeM = desc.match(/OE Number: ([^G]*?)Glavista Number:/);
    if (oeM) oe = oeM[1].split(',').map((s) => s.trim()).filter(Boolean);
    
    // Properties from card-detail list
    const felt = {};
    $('.card-detail__list-description').each((i, el) => {
        const key = stripTags($(el).text().replace(':', ''));
        const val = stripTags($(el).next('.card-detail__list-value').text());
        if (key && val) felt[key] = val;
    });
    
    // Features from product-features blocks
    const features = {};
    $('.product-features__description').each((i, el) => {
        const key = stripTags($(el).text().replace(':', ''));
        const val = stripTags($(el).next('.product-features__value').text());
        if (key && val) features[key] = val;
    });
    
    // Certificates
    const cert = [];
    if ($.html().includes('certificado-43R.png')) cert.push('43R');
    if ($.html().includes('certificado-43R-DOT.png')) cert.push('43R-DOT');
    
    // All eurocodes mentioned on page
    const koder = new Set([normEurocode(mpn)]);
    $('[itemprop="mpn"]').each((i, el) => koder.add(normEurocode($(el).attr('content'))));
    $('.card-product__ref').each((i, el) => koder.add(normEurocode($(el).text())));
    
    // Mounting accessories
    const tilbehor = $.html().includes('MOUNTING ACCESSORIES:') ? 'ja' : '';
    
    const eurocode = normEurocode(mpn);
    if (!eurocode) return null;

    // Price: Glavista exposes a suggested retail price. Record what the source
    // actually says (currency + origin) instead of inventing a NOK price.
    const srp = parsePrice(features['Suggested retail price']);

    return {
        varenr: eurocode,
        varenavn: navn || eurocode,
        eurokode: eurocode,
        pris: srp.currency === 'NOK' ? srp.amount : null,
        pris_valuta: srp.currency,
        pris_kilde: srp.amount !== null ? 'glavista_suggested_retail' : '',
        pris_eur: srp.currency === 'EUR' ? srp.amount : null,
        brand_title: brand,
        category_string: 'Windscreen',
        url: url,
        alias_av: '',
        // Extra fields
        glavistaNr: gtin || features['Glavista Number'] || '',
        oe_numre: oe.join(', '),
        properties: JSON.stringify(felt),
        features: JSON.stringify(features),
        cert: cert.join(', '),
        koder: [...koder].join(', '),
        tilbehor: tilbehor,
    };
}

export async function main() {
    // Initialize the Actor first
    await Actor.init();
    
    console.log('Starting FinnBilGlass Catalog Apify Actor...');
    
    // Get input or use defaults
    const actorInput = await Actor.getInput() || {};
    const envInput = process.env.APIFY_INPUT ? JSON.parse(process.env.APIFY_INPUT) : {};
    const combinedInput = { ...actorInput, ...envInput };
    const isProbeMode = combinedInput.probeMode === true;
    const limit = isProbeMode ? PROBE_LIMIT : (combinedInput.limit || MAX_PRODUCTS);
    const resume = combinedInput.resume === true;
    
    console.log(`Mode: ${isProbeMode ? 'PROBE' : 'FULL'}, Product limit: ${limit}, Resume: ${resume}`);
    
    // Get product URLs from Glavista sitemap
    let allUrls;
    try {
        allUrls = await getGlavistaProductUrls();
    } catch (err) {
        console.error(`Failed to get product URLs: ${err.message}`);
        throw err;
    }
    
    const startUrls = allUrls.slice(0, limit);
    console.log(`Total URLs to process: ${startUrls.length}`);
    
    // Open or create the dataset
    const dataset = await Actor.openDataset();
    
    // Load checkpoint if resume is enabled
    let checkpoint = null;
    let processedUrls = [];
    let saved = 0;
    let startIndex = 0;
    
    if (resume) {
        checkpoint = await loadCheckpoint();
        if (checkpoint) {
            processedUrls = checkpoint.processedUrls || [];
            saved = checkpoint.saved || 0;
            startIndex = checkpoint.lastIndex + 1;
            console.log(`[checkpoint] Resuming from index ${startIndex}, already processed ${processedUrls.length} URLs, saved ${saved} products`);
        } else {
            console.log('[checkpoint] No checkpoint found, starting fresh');
        }
    }
    
    let hasErrors = false;
    
    // Process each URL using global fetch (Node 24+)
    for (let i = startIndex; i < startUrls.length; i++) {
        const url = startUrls[i];
        
        // Skip already processed URLs
        if (processedUrls.includes(url)) {
            console.log(`[checkpoint] Skipping already processed: ${url}`);
            continue;
        }
        
        try {
            const response = await fetchWithRetry(url);
            
            const body = await response.text();
            const $ = cheerio.load(body);
            
            // Check if it's a 404 page
            if ($('title').text().includes('404')) {
                console.warn(`404 page for ${url}`);
                hasErrors = true;
                await saveCheckpoint(i, processedUrls, saved);
                continue;
            }
            
            const product = extractGlavistaProduct($, url);
            
            if (product) {
                // Parse JSON string fields to structured objects
                const parseJsonField = (field) => {
                    try {
                        if (typeof field === 'string' && field.trim().startsWith('{')) {
                            return JSON.parse(field);
                        }
                    } catch {
                        // Ignore parse errors
                    }
                    return {};
                };
                
                const processedProduct = {
                    ...product,
                    properties: parseJsonField(product.properties),
                    features: parseJsonField(product.features),
                };
                
                // Store in dataset
                await dataset.pushData(processedProduct);
                log.debug(`Product: ${product.varenr} - ${product.varenavn}`);
                saved++;
                console.log(`Saved: ${product.varenr} (${saved}/${limit})`);
            } else {
                console.warn(`No valid product extracted from ${url}`);
                hasErrors = true;
            }
            
            // Track processed URL
            processedUrls.push(url);
            
            // Save checkpoint every 5 products
            if (saved % 5 === 0 || i === startUrls.length - 1) {
                await saveCheckpoint(i, processedUrls, saved);
            }
            
        } catch (err) {
            console.error(`Error fetching ${url}: ${err.message}`);
            hasErrors = true;
            // Save checkpoint on error
            await saveCheckpoint(i, processedUrls, saved);
        }
    }
    
    // Print summary. `saved` is authoritative because the dataset itemCount
    // can lag behind by a moment; report both and warn on mismatch.
    const info = await dataset.getInfo();
    const rowCount = info?.itemCount ?? null;
    console.log(`Catalog crawl completed. Products saved: ${saved}, dataset itemCount: ${rowCount}`);
    if (rowCount !== null && rowCount !== saved) {
        console.warn(`[warn] dataset itemCount (${rowCount}) != saved counter (${saved})`);
    }
    
    if (saved === 0) {
        throw new Error(`SCRAPE_FAILED: No products saved`);
    }
    
    // Success gate: require at least 90% of the requested URLs to yield a product
    const successRate = saved / startUrls.length;
    if (successRate < 0.9) {
        throw new Error(`SCRAPE_INCOMPLETE: saved=${saved}/${startUrls.length} (${(successRate * 100).toFixed(1)}% < 90%)`);
    }
    if (hasErrors) {
        console.warn(`Crawl finished with recoverable errors (saved=${saved}/${startUrls.length})`);
    }
    
    // Clear checkpoint on successful completion
    await clearCheckpoint();
    
    // Exit successfully
    await Actor.exit();
}

// Run the main function
main().catch((err) => {
    console.error('Actor failed:', err);
    process.exit(1);
});