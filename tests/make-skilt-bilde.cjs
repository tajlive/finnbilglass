// Genererer tests/skilt-su18018.png — syntetisk norsk kjennemerke (SU18018).
// Bruk: node tests/make-skilt-bilde.cjs
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 220 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(__dirname, 'skilt-test.html'));
  await page.waitForTimeout(300);
  const plate = await page.locator('.plate').boundingBox();
  await page.screenshot({ path: path.resolve(__dirname, 'skilt-su18018.png'), clip: { x: 0, y: plate.y, width: 640, height: plate.height } });
  await browser.close();
  console.log('OK: tests/skilt-su18018.png');
})().catch((e) => { console.error(e); process.exit(1); });
