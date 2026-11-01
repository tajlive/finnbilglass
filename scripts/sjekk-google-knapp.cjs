// Sjekker sosial-innlogging-knappene på /innlogging i ekte nettleser.
// Knappene er skjult i markup og vises kun når serveren melder dem som aktive.
const { chromium } = require('playwright');
const BASE = process.env.FB_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const feil = [];
  p.on('pageerror', (e) => feil.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') feil.push('console: ' + m.text()); });

  await p.goto(BASE + '/innlogging', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);

  const knapper = [];
  for (const prov of ['google', 'microsoft', 'facebook']) {
    const el = p.locator(`.sosial-knapp[data-provider="${prov}"]`);
    knapper.push({ provider: prov, antall: await el.count(), synlig: await el.isVisible().catch(() => false) });
  }
  const otpSynlig = await p.locator('#send-otp-btn').isVisible().catch(() => false);

  await p.screenshot({ path: '/tmp/fbg-innlogging-sosial.png' });
  console.log(JSON.stringify({ knapper, otpSynlig, jsFeil: feil }, null, 1));
  await b.close();
})();
