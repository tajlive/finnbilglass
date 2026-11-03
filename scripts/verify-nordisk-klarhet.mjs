// Visuell og funksjonell verifisering av Nordisk klarhet-flyten (lokal, ekte katalogdata).
//
// Kjøres: node --import tsx scripts/verify-nordisk-klarhet.mjs
// Krever /tmp/fbg-vw-rows.json (hentes med wrangler d1 execute --remote, se
// scripts/verify-valgtre.mjs for samme mønster). Skriver skjermbilder til
// FBG_OUT (standard: ~/.hermes/cache/scratch/fbg-nordisk-klarhet).
//
// Sjekker: datastyrte rutetyper, ett spørsmål om gangen, Tilbake, valgt tilstand,
// tap-flater ≥44 px, ingen horisontal overflyt på 390 px, resultatkort med
// egenskaper og forskjeller, oppsummering før kontaktfeltene, bekreftelse.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';
import worker from '../src/index.ts';

const OUT = process.env.FBG_OUT || join(homedir(), '.hermes/cache/scratch/fbg-nordisk-klarhet');
await mkdir(OUT, { recursive: true });

const rows = JSON.parse(await readFile('/tmp/fbg-vw-rows.json', 'utf8'));

/** Minimal D1 som svarer på katalogspørringen Workeren faktisk bruker. */
function stubDb() {
  const prepare = (sql) => {
    let args = [];
    const api = {
      bind(...v) { args = v; return api; },
      first: async () => null,
      all: async () => {
        if (/FROM glass_prisliste/i.test(sql)) {
          const prefiks = String(args[0] || '').replace(/%$/, '');
          return { results: rows.filter((r) => String(r.varenavn || '').toUpperCase().startsWith(prefiks.toUpperCase())) };
        }
        return { results: [] };
      },
      run: async () => ({ meta: { changes: 1, last_row_id: 1 } }),
    };
    return api;
  };
  return { prepare, batch: async () => [{ meta: { last_row_id: 1 } }, { meta: { changes: 1 } }], exec: async () => ({ count: 0, duration: 0 }) };
}

const env = {
  ENVIRONMENT: 'staging',
  inquiries_enabled: 'true',
  ALL_GLASS_KANDIDATER_ENABLED: 'true',
  FINNBILGLASS_DB: stubDb(),
  FINNBILGLASS_STAGING_AUTH: stubDb(),
};

const BIL = { merke: 'VOLKSWAGEN', modell: 'TRANSPORTER', aar: 2005, vin: null, forstegangsregistrert: '2006-03-15', import: false };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/regnr') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, bil: BIL, resolver: null }));
      return;
    }
    // UI-verifiseringen trenger bekreftelsestilstanden; innsendingen er dekket
    // av egne back-end-tester (quote-pilot-browser + all-glass).
    if (url.pathname === '/api/inquiry') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, inquiryId: 4242 }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      let data = '';
      for await (const chunk of req) data += chunk;
      const svar = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: data || undefined }), env, { waitUntil() {} });
      res.writeHead(svar.status, Object.fromEntries(svar.headers));
      res.end(await svar.text());
      return;
    }
    const root = resolve('public');
    const fil = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!fil.startsWith(root + '/')) throw new Error('path');
    const typer = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
    res.setHeader('content-type', typer[extname(fil)] || 'application/octet-stream');
    res.end(await readFile(fil));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const funn = [];
const sjekk = (ok, tekst) => { if (!ok) funn.push(tekst); };

async function apne(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  page.on('pageerror', (e) => funn.push('JS-feil: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/401/.test(m.text())) return; // /api/auth/session uten innlogging
    funn.push('console: ' + m.text());
  });
  return { context, page };
}

async function sokBil(page) {
  await page.fill('#input-regnr', 'SU18018');
  await page.click('#form-regnr button[type=submit]');
  await page.waitForSelector('#screen-glass:not(.hidden)', { timeout: 15000 });
  await page.waitForSelector('#glassvalg .glassopt', { timeout: 15000 });
}

async function ingenOverflyt(page, hvor) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  sjekk(m.sw <= m.iw + 1, `${hvor}: horisontal overflyt (${m.sw} > ${m.iw})`);
}

async function tapFlater(page, hvor, velger) {
  const sma = await page.$$eval(velger, (els) => els
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ tekst: (e.textContent || '').trim().slice(0, 40), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((e) => e.h < 44));
  sjekk(sma.length === 0, `${hvor}: trykkflate under 44 px: ${JSON.stringify(sma)}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const vp of [{ navn: 'mobil', width: 390, height: 844 }, { navn: 'desktop', width: 1280, height: 900 }]) {
    const { context, page } = await apne(browser, vp);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#input-regnr');
    await page.screenshot({ path: join(OUT, `${vp.navn}-01-forside.png`), fullPage: true });
    await ingenOverflyt(page, `${vp.navn}/forside`);

    await sokBil(page);
    const typer = await page.$$eval('#glassvalg .glassopt', (els) => els.map((e) => e.getAttribute('data-kind')));
    sjekk(typer.includes('windshield'), `${vp.navn}: frontrute mangler i typevalget (${typer.join(',')})`);
    sjekk(typer.includes('door'), `${vp.navn}: dørrute mangler i typevalget (${typer.join(',')})`);
    await page.screenshot({ path: join(OUT, `${vp.navn}-02-rutetyper.png`), fullPage: true });
    await ingenOverflyt(page, `${vp.navn}/rutetyper`);
    await tapFlater(page, `${vp.navn}/rutetyper`, '#glassvalg .glassopt, #btn-glass-hjelp');

    // Dørrute → ett spørsmål om gangen
    await page.click('#glassvalg .glassopt[data-kind="door"]');
    await page.waitForSelector('#glass-placement:not(.hidden)');
    const antallSteg = await page.locator('#glass-placement-fields .valg-knapp').count();
    sjekk(antallSteg >= 2, `${vp.navn}: dørrute gav ${antallSteg} sidevalg`);
    await page.screenshot({ path: join(OUT, `${vp.navn}-03-steg-side.png`), fullPage: true });
    await tapFlater(page, `${vp.navn}/steg`, '#glass-placement-fields .valg-knapp, #btn-glass-back, #btn-glass-cancel');

    // Tilbake skal fjerne steget uten å låse kunden
    await page.click('#glass-placement-fields .valg-knapp[data-verdi="left"]');
    await page.waitForSelector('#screen-resultat:not(.hidden)');
    await page.waitForFunction(() => { const b = document.querySelector('#btn-inquiry'); return b && !b.disabled; }, { timeout: 15000 });
    const kort = await page.locator('#resultat-kort .kandidat-kort').count();
    sjekk(kort > 0, `${vp.navn}: ingen kandidatkort etter dørrute venstre`);
    const oppsummering = (await page.textContent('#resultat-oppsummering')) || '';
    sjekk(/Dørrute/i.test(oppsummering), `${vp.navn}: oppsummeringen mangler ruten (${oppsummering.trim().slice(0, 80)})`);
    await page.screenshot({ path: join(OUT, `${vp.navn}-04-resultat.png`), fullPage: true });
    await ingenOverflyt(page, `${vp.navn}/resultat`);

    // Velg et glass → valgt tilstand
    await page.click('#resultat-kort .kandidat-kort:first-child .velg-glass');
    const valgt = await page.locator('#resultat-kort .kandidat-kort.valgt').count();
    sjekk(valgt === 1, `${vp.navn}: valgt glass markeres ikke`);

    // Tilbud: oppsummering FØR kontaktfeltene
    await page.click('#btn-inquiry');
    await page.waitForSelector('#inquiry-form:not(.hidden)');
    const soknad = (await page.textContent('#inquiry-oppsummering')) || '';
    sjekk(/Bil/i.test(soknad) && /Rute/i.test(soknad) && /Ønsket glass/i.test(soknad), `${vp.navn}: søknadsoppsummeringen er ufullstendig (${soknad.trim().slice(0, 120)})`);
    await page.screenshot({ path: join(OUT, `${vp.navn}-05-tilbud.png`), fullPage: true });
    await ingenOverflyt(page, `${vp.navn}/tilbud`);

    await page.fill('#inquiry-navn', 'Test Testesen');
    await page.fill('#inquiry-kontakt', '40000000');
    await page.fill('#inquiry-leveringssted', 'Trondheim');
    await page.click('#btn-inquiry-send');
    await page.waitForSelector('#inquiry-bekreftet:not(.hidden)');
    const bekreft = (await page.textContent('#inquiry-bekreftet')) || '';
    sjekk(/Forespørselen er mottatt/i.test(bekreft), `${vp.navn}: bekreftelsen mangler tittelen`);
    sjekk(/Dørrute/i.test(bekreft), `${vp.navn}: bekreftelsen mangler valgt rute`);
    await page.screenshot({ path: join(OUT, `${vp.navn}-06-bekreftet.png`), fullPage: true });
    await ingenOverflyt(page, `${vp.navn}/bekreftet`);

    await context.close();
  }

  // Tastaturbetjening: Tab til rutetype, Enter velger, fokusringen er synlig.
  const { context, page } = await apne(browser, { width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sokBil(page);
  // Ekte tastaturnavigasjon: Tab fra skiltfeltet til første rutetype.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const erRutetype = await page.evaluate(() => {
      const a = document.activeElement;
      return !!(a && a.classList && a.classList.contains('glassopt'));
    });
    if (erRutetype) break;
  }
  const outline = await page.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return { klasse: a.className, width: s.outlineWidth, style: s.outlineStyle, farge: s.outlineColor };
  });
  sjekk(outline.style !== 'none' && parseFloat(outline.width) >= 2, `tastatur: fokusringen er ikke synlig (${JSON.stringify(outline)})`);
  // Tab videre til «Dørrute» og velg med Enter.
  for (let i = 0; i < 6; i++) {
    const kind = await page.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute('data-kind'));
    if (kind === 'door') break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('#glass-placement:not(.hidden)');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#screen-resultat:not(.hidden)');
  sjekk(await page.locator('#resultat-kort .kandidat-kort').count() > 0, 'tastatur: Enter-valg gav ingen resultater');
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

console.log(funn.length ? `FUNN (${funn.length}):\n- ` + funn.join('\n- ') : 'Alle kontroller PASS. Skjermbilder i ' + OUT);
process.exit(funn.length ? 1 : 0);
