import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const out = '/tmp/finnbilglass-customer-qa';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const result = { viewport, errors: [], checks: [] };
    page.on('pageerror', e => result.errors.push(e.message));
    try {
      await page.goto(base);
      await page.getByRole('textbox', { name: 'Skiltnummer', exact: true }).fill('SU18018');
      const lookup = page.waitForResponse(r => r.url().endsWith('/api/regnr') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Finn glass', exact: true }).click();
      const response = await lookup;
      const vehicle = await response.json();
      assert.equal(vehicle.bil?.merke, 'VW');
      assert.equal(vehicle.resolver?.eurokode, '8579AGSGYAVZ1B');
      result.checks.push('vehicle and verified glass');
      const imagePaused = await page.locator('.evidence-capture').count() === 0
        || await page.locator('.evidence-capture').evaluate(el => el.hasAttribute('hidden'));
      assert.equal(imagePaused, true, 'image processing UI should be hidden while paused');
      result.checks.push('image processing UI hidden while paused');
      const inquiry = await context.request.post(`${base}/api/inquiry`, { data: {
        regnr: 'SU18018', navn: `QA staging ${viewport.width}`, kontakt: 'qa@example.invalid',
        melding: 'AUTOMATED QA TEST - do not process as customer inquiry',
      } });
      result.inquiry = { status: inquiry.status(), body: await inquiry.json() };
      assert.equal(inquiry.ok(), true);
      result.checks.push('test inquiry accepted by API');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'viewport overflow');
      result.checks.push('responsive width');
    } catch (e) { result.failure = e.message; }
    await page.screenshot({ path: `${out}/${viewport.width}.png`, fullPage: true });
    results.push(result);
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
for (const r of results) console.log(JSON.stringify(r));
if (results.some(r => r.failure || r.errors.length)) process.exitCode = 1;
