// Sjekker at topplenken bytter fra «Logg inn» til «Min side» etter innlogging.
const { chromium } = require('playwright');
const BASE = process.env.FB_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const EPOST = process.env.FB_EPOST || 'kunde-a@test.no';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  let kode = null;
  p.on('response', async (r) => {
    if (r.url().endsWith('/api/auth/otp/send') && r.status() === 200) {
      try { kode = (await r.json()).code || null; } catch {}
    }
  });
  const ut = {};

  // Før innlogging
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  ut.foer_tekst = (await p.locator('#topp-konto').textContent()).trim();
  ut.foer_href = await p.locator('#topp-konto').getAttribute('href');

  // Logg inn via OTP
  await p.goto(BASE + '/innlogging', { waitUntil: 'domcontentloaded' });
  await p.fill('#email', EPOST);
  await p.evaluate(() => {
    const el = document.querySelector('#email');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForFunction(() => !document.querySelector('#send-otp-btn').disabled, { timeout: 10000 }).catch(() => {});
  await p.click('#send-otp-btn');
  await p.waitForSelector('#otp-step', { state: 'visible', timeout: 15000 });
  await p.waitForTimeout(1200);
  if (kode) {
    const inputs = p.locator('.otp-input');
    for (let i = 0; i < kode.length; i++) await inputs.nth(i).fill(kode[i]);
    await p.click('#verify-otp-btn');
    await p.waitForURL(/min-side/, { timeout: 15000 });
    ut.innlogget = true;

    // Etter innlogging
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
    ut.etter_tekst = (await p.locator('#topp-konto').textContent()).trim();
    ut.etter_href = await p.locator('#topp-konto').getAttribute('href');
    ut.google_knapp_synlig = await p.goto(BASE + '/innlogging').then(() => p.waitForTimeout(2500)).then(() => p.locator('#google-blokk').isVisible());
  } else {
    ut.innlogget = false;
  }
  console.log(JSON.stringify(ut, null, 1));
  await b.close();
})();
