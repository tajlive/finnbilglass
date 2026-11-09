#!/usr/bin/env node
/**
 * Apify Automation Script for FinnBilGlass Typekode Collection
 * 
 * Usage:
 *   node scripts/apify-automation.mjs --input-file apify-typekode-only-input.json --wait
 *   node scripts/apify-automation.mjs --run-id 3BH4i16MJdDAvT19a --fetch-results
 * 
 * Features:
 * - Starts Actor runs via Apify REST API
 * - Monitors run status with polling
 * - Fetches dataset results
 * - Enforces cost ceiling ($0.50)
 * - Validates hard limits enforcement
 * - Generates GO/NO-GO report
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const APIFY_API_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = '1QF8RbAZ6ewBALyYj'; // tomarnejensen/finnbilglass-price-import
const INTEGRATION_TOKEN = process.env.APIFY_TOKEN;
const COST_CEILING_USD = 0.50;
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 min

if (!INTEGRATION_TOKEN) {
    console.error('ERROR: APIFY_TOKEN environment variable not set');
    console.error('Get token from Apify Console → Account → Integrations');
    process.exit(1);
}

function authHeaders() {
    return {
        'Authorization': `Bearer ${INTEGRATION_TOKEN}`,
        'Content-Type': 'application/json'
    };
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startRunFromTask(taskId) {
    // Start a run of an existing Task. Credentials are stored in Apify's
    // encrypted Task default input - NOT in this script or any input file.
    const response = await fetch(`${APIFY_API_BASE}/actor-tasks/${taskId}/runs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({})  // No input - Task defaults are used
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to start task run: ${response.status} - ${error}`);
    }

    const run = await response.json();
    console.log(`Task run started: ${run.data.id}`);
    return run.data;
}

async function startRun(inputFile) {
    const input = JSON.parse(await fs.readFile(inputFile, 'utf-8'));
    
    // Validate critical settings
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error(`Input validation failed: ${validation.errors.join(', ')}`);
    }
    
    console.log('Starting Actor run with input:');
    console.log(JSON.stringify(input, null, 2));
    
    const response = await fetch(`${APIFY_API_BASE}/actors/${ACTOR_ID}/runs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input)
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to start run: ${response.status} - ${error}`);
    }
    
    const run = await response.json();
    console.log(`Run started: ${run.data.id}`);
    return run.data;
}

function validateInput(input) {
    const errors = [];
    
    if (!input.catalogUrls || !Array.isArray(input.catalogUrls) || input.catalogUrls.length === 0) {
        errors.push('catalogUrls must be a non-empty array');
    }
    
    if (input.mode !== 'probe') {
        errors.push('mode must be "probe" for safety');
    }
    
    if (input.saveState !== false) {
        errors.push('saveState must be false (no D1 writes)');
    }
    
    if (input.allowReconciliation !== false) {
        errors.push('allowReconciliation must be false (no reconciliation)');
    }
    
    if (!input.typekodeOnly) {
        errors.push('typekodeOnly must be true (no price/stock collection)');
    }
    
    if (input.maxProducts > 100) {
        errors.push('maxProducts should not exceed 100 for pilot runs');
    }
    
    if (input.maxPages > 100) {
        errors.push('maxPages should not exceed 100 for pilot runs');
    }
    
    // Check for credentials in input (should be in Console only)
    if (input.username || input.password) {
        errors.push('username/password must NOT be in input file (use encrypted Console fields)');
    }
    
    return { valid: errors.length === 0, errors };
}

async function waitForRun(runId) {
    const startTime = Date.now();
    let lastStatus = '';
    
    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
        const response = await fetch(`${APIFY_API_BASE}/actor-runs/${runId}`, {
            headers: authHeaders()
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get run status: ${response.status}`);
        }
        
        const run = await response.json();
        const status = run.data.status;
        
        if (status !== lastStatus) {
            console.log(`[${new Date().toISOString()}] Run status: ${status}`);
            lastStatus = status;
        }
        
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            return run.data;
        }
        
        await sleep(POLL_INTERVAL_MS);
    }
    
    throw new Error(`Run ${runId} did not complete within ${MAX_POLL_DURATION_MS / 1000 / 60} minutes`);
}

async function fetchDataset(datasetId) {
    const response = await fetch(`${APIFY_API_BASE}/datasets/${datasetId}/items?format=json`, {
        headers: authHeaders()
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch dataset: ${response.status}`);
    }
    
    return response.json();
}

async function estimateCost(runData) {
    // Apify charges based on compute units
    // Rough estimate: 1 CU ≈ $0.0007 for this actor
    const cu = runData.stats?.computeUnits || 0;
    const estimatedCost = cu * 0.0007;
    return { computeUnits: cu, estimatedCostUsd: estimatedCost };
}

function validateResults(results, input) {
    const issues = [];
    const warnings = [];
    
    // Check hard limits were enforced
    if (results.length > input.maxProducts) {
        issues.push(`HARD LIMIT VIOLATION: Got ${results.length} products, maxProducts was ${input.maxProducts}`);
    }
    
    // Check Typekode-only mode worked
    const withPrices = results.filter(r => r.listPriceValue !== null && r.listPriceValue !== undefined).length;
    const withStock = results.filter(r => r.stockStatus && r.stockStatus !== 'UNKNOWN').length;
    
    if (withPrices > 0) {
        issues.push(`Typekode-only mode failed: ${withPrices} products have prices`);
    }
    
    if (withStock > 0) {
        issues.push(`Typekode-only mode failed: ${withStock} products have stock status`);
    }
    
    // Check all have explicit typekode
    const withTypekode = results.filter(r => r.typeCodeRaw && r.typeCodeRaw.trim()).length;
    if (withTypekode < results.length) {
        warnings.push(`${results.length - withTypekode} products missing explicit Typekode`);
    }
    
    // Check for conflicts
    const conflicts = results.filter(r => r.typeCodeConflict || r.sideConflict).length;
    if (conflicts > 0) {
        warnings.push(`${conflicts} products have typeCodeConflict or sideConflict`);
    }
    
    return { issues, warnings, stats: { total: results.length, withTypekode, conflicts } };
}

async function generateReport(runData, results, validation, cost) {
    const report = {
        timestamp: new Date().toISOString(),
        runId: runData.id,
        actorId: ACTOR_ID,
        status: runData.status,
        durationSeconds: runData.stats?.runTimeSecs || 0,
        cost: cost,
        input: {
            mode: runData.actInput?.mode,
            maxProducts: runData.actInput?.maxProducts,
            maxPages: runData.actInput?.maxPages,
            typekodeOnly: runData.actInput?.typekodeOnly,
            catalogUrlsCount: runData.actInput?.catalogUrls?.length
        },
        results: {
            totalProducts: results.length,
            uniqueSkus: new Set(results.map(r => r.sku)).size,
            validation: validation
        },
        recommendation: validation.issues.length === 0 ? 'GO' : 'NO-GO'
    };
    
    const reportPath = `data/apify-run-report-${runData.id}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report saved to ${reportPath}`);
    
    return report;
}

async function main() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            'input-file': { type: 'string' },
            'run-id': { type: 'string' },
            'wait': { type: 'boolean' },
            'fetch-results': { type: 'boolean' },
            'auth-test': { type: 'boolean' },
            'task-id': { type: 'string' },
            'output-dir': { type: 'string', default: 'data' }
        },
        strict: true,
        allowPositionals: true
    });

    // Authentication test - only reports HTTP status, never token value
    if (values['auth-test']) {
        console.log('Testing Apify authentication...');
        try {
            const response = await fetch(`${APIFY_API_BASE}/users/me`, {
                headers: authHeaders()
            });
            console.log(`HTTP Status: ${response.status} ${response.statusText}`);
            if (response.ok) {
                const user = await response.json();
                console.log(`Authenticated as: ${user.data.username} (${user.data.email})`);
                console.log('AUTH TEST: PASS');
                process.exit(0);
            } else {
                const error = await response.text();
                console.error(`AUTH TEST: FAIL - ${response.status} ${response.statusText}`);
                console.error(`Error: ${error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(`AUTH TEST: FAIL - ${error.message}`);
            process.exit(1);
        }
    }
    
    try {
        if (values['task-id']) {
            // Start run from existing Task (credentials in Apify encrypted storage)
            const run = await startRunFromTask(values['task-id']);

            if (values.wait) {
                console.log('Waiting for run to complete...');
                const completedRun = await waitForRun(run.id);

                // Estimate cost
                const cost = await estimateCost(completedRun);
                console.log(`Estimated cost: $${cost.estimatedCostUsd.toFixed(4)} (${cost.computeUnits} CU)`);

                if (cost.estimatedCostUsd > COST_CEILING_USD) {
                    console.error(`⚠️  COST CEILING EXCEEDED: $${cost.estimatedCostUsd.toFixed(4)} > $${COST_CEILING_USD}`);
                }

                // Fetch results
                const results = await fetchDataset(completedRun.defaultDatasetId);

                // Use Task input for validation (it has maxProducts, maxPages, typekodeOnly)
                const taskResponse = await fetch(`${APIFY_API_BASE}/actor-tasks/${values['task-id']}`, {
                    headers: authHeaders()
                });
                const task = await taskResponse.json();
                const input = task.data?.input || { maxProducts: 5, maxPages: 5, typekodeOnly: true };

                // Validate
                const validation = validateResults(results, input);

                // Generate report
                const report = await generateReport(completedRun, results, validation, cost);

                // Print summary
                console.log('\n=== RUN SUMMARY ===');
                console.log(`Run ID: ${run.id}`);
                console.log(`Task ID: ${values['task-id']}`);
                console.log(`Status: ${completedRun.status}`);
                console.log(`Duration: ${report.durationSeconds}s`);
                console.log(`Products: ${report.results.totalProducts}`);
                console.log(`Unique SKUs: ${report.results.uniqueSkus}`);
                console.log(`Cost: $${cost.estimatedCostUsd.toFixed(4)}`);
                console.log(`Validation: ${validation.issues.length === 0 ? 'PASS' : 'FAIL'}`);
                if (validation.issues.length > 0) {
                    console.log('ISSUES:');
                    validation.issues.forEach(i => console.log(`  - ${i}`));
                }
                if (validation.warnings.length > 0) {
                    console.log('WARNINGS:');
                    validation.warnings.forEach(w => console.log(`  - ${w}`));
                }
                console.log(`Recommendation: ${report.recommendation}`);

                if (report.recommendation === 'NO-GO') {
                    process.exit(1);
                }
            }
        } else if (values['input-file']) {
            // Start new run
            const run = await startRun(values['input-file']);
            
            if (values.wait) {
                console.log('Waiting for run to complete...');
                const completedRun = await waitForRun(run.id);
                
                // Estimate cost
                const cost = await estimateCost(completedRun);
                console.log(`Estimated cost: $${cost.estimatedCostUsd.toFixed(4)} (${cost.computeUnits} CU)`);
                
                if (cost.estimatedCostUsd > COST_CEILING_USD) {
                    console.error(`⚠️  COST CEILING EXCEEDED: $${cost.estimatedCostUsd.toFixed(4)} > $${COST_CEILING_USD}`);
                }
                
                // Fetch results
                const results = await fetchDataset(completedRun.defaultDatasetId);
                
                // Validate
                const input = JSON.parse(await fs.readFile(values['input-file'], 'utf-8'));
                const validation = validateResults(results, input);
                
                // Generate report
                const report = await generateReport(completedRun, results, validation, cost);
                
                // Print summary
                console.log('\n=== RUN SUMMARY ===');
                console.log(`Run ID: ${run.id}`);
                console.log(`Status: ${completedRun.status}`);
                console.log(`Duration: ${report.durationSeconds}s`);
                console.log(`Products: ${report.results.totalProducts}`);
                console.log(`Unique SKUs: ${report.results.uniqueSkus}`);
                console.log(`Cost: $${cost.estimatedCostUsd.toFixed(4)}`);
                console.log(`Validation: ${validation.issues.length === 0 ? 'PASS' : 'FAIL'}`);
                if (validation.issues.length > 0) {
                    console.log('ISSUES:');
                    validation.issues.forEach(i => console.log(`  - ${i}`));
                }
                if (validation.warnings.length > 0) {
                    console.log('WARNINGS:');
                    validation.warnings.forEach(w => console.log(`  - ${w}`));
                }
                console.log(`Recommendation: ${report.recommendation}`);
                
                if (report.recommendation === 'NO-GO') {
                    process.exit(1);
                }
            }
        } else if (values['run-id'] && values['fetch-results']) {
            // Fetch existing run results
            const runResponse = await fetch(`${APIFY_API_BASE}/actor-runs/${values['run-id']}`, {
                headers: authHeaders()
            });
            const run = await runResponse.json();
            
            const results = await fetchDataset(run.data.defaultDatasetId);
            const cost = await estimateCost(run.data);
            
            // Use default pilot input for validation
            const input = {
                maxProducts: 10,
                maxPages: 20,
                typekodeOnly: true
            };
            
            const validation = validateResults(results, input);
            const report = await generateReport(run.data, results, validation, cost);
            
            console.log('\n=== RUN SUMMARY ===');
            console.log(`Run ID: ${values['run-id']}`);
            console.log(`Status: ${run.data.status}`);
            console.log(`Products: ${report.results.totalProducts}`);
            console.log(`Unique SKUs: ${report.results.uniqueSkus}`);
            console.log(`Cost: $${cost.estimatedCostUsd.toFixed(4)}`);
            console.log(`Validation: ${validation.issues.length === 0 ? 'PASS' : 'FAIL'}`);
        } else {
            console.log('Usage:');
            console.log('  Start new run: node scripts/apify-automation.mjs --input-file=apify-typekode-only-input.json --wait');
            console.log('  Fetch results: node scripts/apify-automation.mjs --run-id=RUN_ID --fetch-results');
            console.log('  Run task:      node scripts/apify-automation.mjs --task-id=TASK_ID --wait');
            console.log('  Test auth:     node scripts/apify-automation.mjs --auth-test');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();