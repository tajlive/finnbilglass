// Generer testbilde av 43R-merke (E1 + 43R-004592) → PNG for å teste Workers AI-avlesning.
const { chromium } = require('/Users/taj/klarpakke/node_modules/playwright');
const path = '/Users/taj/finnbilglass/tests/merke-004592.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 2 });
  await page.goto('file:///Users/taj/finnbilglass/tests/merke-test.html');
  await page.waitForTimeout(300);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 480, height: 480 } });
  await browser.close();
  console.log('OK', path);
})().catch((e) => { console.error(e); process.exit(1); });
