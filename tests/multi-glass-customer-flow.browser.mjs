import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule);
const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const file = path === '/' ? 'index.html' : path.slice(1);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(join(root, file)));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/api/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/regnr') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bil: { merke: 'TEST', modell: 'MODELL', aar: 2020 }, resolver: null }) });
      if (path === '/api/frontrute') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anbefaling: { varenr: 'TEST-FRONT-1' }, kandidater: [] }) });
      if (path === '/api/opplaering') return route.fulfill({ status: 204, body: '' });
      if (path === '/api/inquiry') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiryId: 42 }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.goto(origin);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
    const types = await page.locator('.glassopt[data-type]').evaluateAll(elements => elements.map(el => el.dataset.type));
    assert.deepEqual(types, ['front']);
    assert.equal(await page.locator('#btn-annet').count(), 0);
    await page.locator('#input-regnr').fill('AB12345');
    await page.locator('#form-regnr button[type=submit]').click();
    await page.locator('#screen-glass:not(.hidden)').waitFor();
    await page.getByRole('heading', { name: 'Velg frontrute' }).waitFor();
    await page.locator('.glassopt[data-type="front"]').click();
    let attempts = 0;
    while (await page.locator('#screen-spm').isVisible() && attempts++ < 20) {
      await page.locator('#btn-vetikke').click();
    }
    assert.ok(attempts < 20, 'front questions should reach the windshield result');
    await page.getByRole('heading', { name: 'Mulig frontrute' }).waitFor();
    assert.equal(await page.getByText('Varenr. TEST-FRONT-1').count(), 0, 'Kunden skal ikke se varenummer');
    await page.locator('#btn-inquiry').click();
    await page.locator('#inquiry-navn').fill('Test Kunde');
    await page.locator('#inquiry-kontaktpreferanse').selectOption('epost');
    await page.locator('#inquiry-kontakt').fill('test@example.no');
    await page.locator('#inquiry-melding').fill('Forespørsel om frontrute');
    await page.locator('#btn-inquiry-send').click();
    await page.getByRole('status').filter({ hasText: 'saksnummer 42' }).waitFor();
    assert.equal(await page.locator('#inquiry-form').isVisible(), false);
    const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0,60), right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) })).filter(x => x.right > innerWidth + 1).slice(0,12) }));
    assert.ok(overflow.doc <= width, `No overflow at ${width}px: ${JSON.stringify(overflow)}`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  let inquiry = null;
  await page.route(`${origin}/api/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/regnr') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bil: { merke: 'MERCEDES', modell: 'VITO W447', aar: 2015 }, resolver: null }) });
    if (path === '/api/frontrute') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      kandidater: [
        { candidateId: '3345GNAM', varenavn: 'VITO W447 SENSOR ANTENNE', attributter: { ldw: false, hud: null, kamera: null } },
        { candidateId: '3345GNCM', varenavn: 'VITO W447 LDW SENSOR ANTENNE', attributter: { ldw: true, hud: null, kamera: null } },
      ], sporsmaal: ['ldw']
    }) });
    if (path === '/api/inquiry') {
      inquiry = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiryId: 43 }) });
    }
    if (path === '/api/opplaering') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto(origin);
  await page.locator('#input-regnr').fill('DP77335');
  await page.locator('#form-regnr button[type=submit]').click();
  await page.locator('.glassopt[data-type="front"]').click();
  await page.getByText('Har bilen feltskiftevarsling (LDW)?').waitFor();
  await page.locator('#btn-vetikke').click();
  await page.locator('#screen-resultat:not(.hidden)').waitFor();
  await page.locator('#btn-inquiry').click();
  await page.locator('#inquiry-navn').fill('Syntetisk test');
  await page.locator('#inquiry-kontaktpreferanse').selectOption('begge');
  await page.locator('#inquiry-kontakt').fill('qa@example.invalid');
  await page.locator('#inquiry-telefon-ekstra').fill('40408241');
  await page.locator('#btn-inquiry-send').click();
  await page.getByRole('status').filter({ hasText: 'saksnummer 43' }).waitFor();
  assert.equal(inquiry?.preferredCandidate, undefined, 'Vet ikke må ikke velge en variant automatisk');
  assert.equal(inquiry?.regnr?.replace(/\s/g, ''), 'DP77335');
  assert.equal(inquiry?.contactPreference, 'begge');
  assert.equal(inquiry?.contactPhone, '40408241');
  await page.close();
  console.log('PASS: front-only choices, LDW-spørsmål og kundens variantvalg, ingen horisontal overflow ved 320/390/1280 px');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
