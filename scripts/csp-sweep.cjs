// Røyktest av alle offentlige sider etter CSP-innstramming.
// Rapporterer JS-feil og CSP-brudd som nettleseren selv oppdager.
const { chromium } = require('playwright');
const BASE = process.env.FB_BASE || 'https://finnbilglass.no';

(async () => {
  const b = await chromium.launch();
  const sider = ['/', '/innlogging', '/min-side', '/om-oss', '/personvern', '/bilglass-uten-forsikring', '/finnes-ikke-404'];
  const ut = [];
  for (const sti of sider) {
    const p = await b.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) feil.push(m.text().slice(0, 120)); });
    let status = 0;
    try {
      const r = await p.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 25000 });
      status = r ? r.status() : 0;
    } catch (e) { feil.push('navigasjon: ' + e.message.slice(0, 80)); }
    await p.waitForTimeout(1200);
    ut.push({ sti, status, feil });
    await p.close();
  }
  console.log(JSON.stringify(ut, null, 1));
  await b.close();
})();
