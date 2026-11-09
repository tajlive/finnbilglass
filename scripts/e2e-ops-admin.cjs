// E2E av Operations Center 2026 i ekte nettleser.
// Token settes i sessionStorage (samme sted som UI-et bruker) — aldri logget.
const { chromium } = require('playwright');
const BASE = process.env.FB_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const TOKEN = process.env.FB_OPS_TOKEN || '';

(async () => {
  if (!TOKEN) { console.log(JSON.stringify({ feil: 'FB_OPS_TOKEN mangler' })); process.exit(1); }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const jsFeil = [];
  p.on('pageerror', (e) => jsFeil.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) jsFeil.push(m.text().slice(0, 100)); });

  await p.goto(BASE + '/ops', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => sessionStorage.setItem('fbg_ops_token', t), TOKEN);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const ut = {};
  ut.kpiAntall = await p.locator('.kpi').count();
  ut.kpiVerdier = await p.locator('.kpi .value').allTextContents();
  ut.badge = (await p.locator('#innboks-badge').textContent().catch(() => '')).trim();
  ut.raderDashboard = await p.locator('#siste-tabell tbody tr').count();
  await p.screenshot({ path: '/tmp/ops-dashboard.png', fullPage: false });

  // Innboks
  await p.click('.nav-item[data-view="innboks"]');
  await p.waitForTimeout(1200);
  ut.raderInnboks = await p.locator('#innboks-tabell tbody tr').count();
  await p.screenshot({ path: '/tmp/ops-innboks.png' });

  // Åpne første sak
  const rad = p.locator('#innboks-tabell tbody tr').first();
  if (await rad.count()) {
    await rad.click();
    await p.waitForTimeout(2000);
    ut.sakApnet = await p.locator('#sak-innhold .card').count() > 0;
    ut.harTidslinje = await p.locator('.timeline li').count() > 0;
    ut.harStatusKnapp = await p.locator('#lagre-status').count() > 0;
    ut.harSvarFelt = await p.locator('#svar-tekst').count() > 0;
    await p.screenshot({ path: '/tmp/ops-sak.png' });
  }

  // Drift
  await p.click('.nav-item[data-view="drift"]');
  await p.waitForTimeout(1800);
  ut.driftRader = await p.locator('#drift-detalj tbody tr').count();

  // Mobil
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('.nav-item[data-view="dashboard"]');
  await p.waitForTimeout(1200);
  ut.mobilUtenOverflyt = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  await p.screenshot({ path: '/tmp/ops-mobil.png', fullPage: false });

  ut.jsFeil = jsFeil;
  console.log(JSON.stringify(ut, null, 1));
  await b.close();
})();
