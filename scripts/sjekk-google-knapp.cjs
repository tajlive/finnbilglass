const { chromium } = require('playwright');
const BASE = process.env.FB_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const logger = [];
  p.on('console', (m) => logger.push(m.type() + ': ' + m.text()));
  p.on('pageerror', (e) => logger.push('pageerror: ' + e.message));
  const svar = {};
  p.on('response', async (r) => {
    if (r.url().includes('/api/auth/google')) {
      svar[r.url().split('/').pop()] = r.status();
      try { svar['body_' + r.url().split('/').pop()] = (await r.text()).slice(0, 120); } catch {}
    }
  });
  await p.goto(BASE + '/innlogging', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  const blokk = await p.locator('#google-blokk').isVisible();
  const gsiIframe = await p.locator('#gsi-knapp iframe').count();
  const gsiDiv = await p.locator('#gsi-knapp div[role="button"]').count();
  await p.screenshot({ path: '/tmp/fbg-google-innlogging.png' });
  console.log(JSON.stringify({ blokkSynlig: blokk, gsiIframe, gsiKnapp: gsiDiv, svar, logger: logger.filter(l => /google|gsi|origin|client/i.test(l)) }, null, 1));
  await b.close();
})();
