// E2E av kundereisen i ekte nettleser: innlogging med OTP → Min side.
// Koden fanges fra API-responsen (kun mulig utenfor produksjon).
const { chromium } = require('playwright');

const BASE = process.env.FB_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const EPOST = process.env.FB_EPOST || 'kunde-a@test.no';

(async () => {
  const nettleser = await chromium.launch();
  const side = await nettleser.newPage();
  const feil = [];
  side.on('pageerror', (e) => feil.push('pageerror: ' + e.message));
  side.on('console', (m) => { if (m.type() === 'error') feil.push('console: ' + m.text()); });

  let kode = null;
  side.on('response', async (r) => {
    if (r.url().endsWith('/api/auth/otp/send') && r.status() === 200) {
      try { kode = (await r.json()).code || null; } catch {}
    }
  });

  const resultat = {};

  // 1. Forsiden skal ha synlig inngang til Min side
  await side.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const lenke = side.locator('header a', { hasText: 'Min side' });
  resultat.forside_min_side_lenke = await lenke.count() > 0;

  // 2. Klikk den → havner på innlogging (via /min-side-redirect)
  await lenke.first().click();
  await side.waitForLoadState('domcontentloaded');
  resultat.omdirigert_til_innlogging = side.url().includes('/innlogging');

  // 3. Send kode
  await side.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await side.fill('#email', EPOST);
  // Sikre at siden registrerer utfyllingen (React-frie felt kan trenge input-event)
  await side.evaluate(() => {
    const el = document.querySelector('#email');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await side.waitForFunction(() => !document.querySelector('#send-otp-btn').disabled, { timeout: 10000 }).catch(() => {});
  await side.click('#send-otp-btn');
  await side.waitForSelector('#otp-step', { state: 'visible', timeout: 15000 });
  await side.waitForTimeout(1200);
  resultat.kode_mottatt = !!kode;

  // 4. Tast koden
  if (kode) {
    const siffer = kode.split('');
    const inputs = side.locator('.otp-input');
    for (let i = 0; i < siffer.length; i++) await inputs.nth(i).fill(siffer[i]);
    await side.click('#verify-otp-btn');
    await side.waitForURL(/min-side/, { timeout: 15000 });
    await side.waitForTimeout(2500);
    resultat.innlogget = side.url().includes('/min-side');
    resultat.navn_vist = (await side.locator('#user-name').textContent().catch(() => '')) || '';
    resultat.sakskort = await side.locator('.car-card').count();
    // 5. Åpne saksdetaljer
    const knapp = side.locator('[data-sak]').first();
    if (await knapp.count()) {
      await knapp.click();
      await side.waitForTimeout(1200);
      resultat.detaljer_vist = await side.locator('#sak-detaljer .car-card').count() > 0;
      resultat.historikk_vist = (await side.locator('#sak-detaljer li').count()) > 0;
    }
    // 6. Logg ut
    await side.click('#logout-btn');
    await side.waitForTimeout(2000);
    resultat.logget_ut = !side.url().includes('/min-side') || (await side.locator('#user-name').count()) === 0;
  }

  await side.screenshot({ path: '/tmp/fbg-min-side-e2e.png', fullPage: true });
  resultat.js_feil = feil;
  console.log(JSON.stringify(resultat, null, 1));
  await nettleser.close();
})();
