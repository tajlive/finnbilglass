const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('https://finnbilglass.no/', { waitUntil: 'networkidle' });
  const lenke = p.locator('a[href="/min-side"]');
  const antall = await lenke.count();
  const info = [];
  for (let i = 0; i < antall; i++) {
    const el = lenke.nth(i);
    const boks = await el.boundingBox();
    const synlig = await el.isVisible();
    info.push({ tekst: (await el.textContent()).trim(), synlig, boks });
  }
  await p.screenshot({ path: '/tmp/fbg-forside-prod.png', fullPage: false });
  // mobil
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('https://finnbilglass.no/', { waitUntil: 'networkidle' });
  await m.screenshot({ path: '/tmp/fbg-forside-mobil.png', fullPage: false });
  console.log(JSON.stringify({ antall, info }, null, 1));
  await b.close();
})();
