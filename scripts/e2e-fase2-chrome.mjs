// Fase 2 — Chrome E2E av HELE kundereisen på STAGING, for alle glasstyper.
//
// Kjører ekte Google Chrome (kanal 'chrome'), mobil 393×852 og desktop 1280×900.
// Per glasstype: regnr → SVV → glassvalg → plassering → kandidater/håndtering
// → tilbudsskjema. Fanger JS-feil, nettverkskall mot /api/glass/kandidater og
// lagrer skjermbilder.
//
// Skriver ALDRI en reell kundehenvendelse: skjemavalideringen testes med tomme
// felt, og «Send forespørsel» klikkes aldri på et gyldig skjema.
//
// Bruk: FBG_BASE=https://<staging> node scripts/e2e-fase2-chrome.mjs
// Exit: 0 = alle kontroller PASS, 1 = funn, 2 = teknisk krasj.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire('/Users/taj/klarpakke/');
  ({ chromium } = require('playwright'));
}

const BASE = process.env.FBG_BASE || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
const UT = process.env.FBG_OUT || '/Users/taj/.hermes/cache/scratch/fbg-fase2/e2e';
const REGNR = process.env.FBG_REGNR || 'SU18018';
mkdirSync(UT, { recursive: true });

const funn = [];
const resultater = [];
const noter = (niva, tekst) => funn.push({ niva, tekst });

// Plasseringsvalg per glasstype — «Vet ikke» der det er lovlig.
const TYPER = [
  { type: 'front', navn: 'Frontrute', felt: null },
  { type: 'door', navn: 'Dørrute', felt: { side: 'left', door: 'front' } },
  { type: 'side', navn: 'Siderute', felt: { side: 'right', section: 'rear_quarter', mounting: 'body' } },
  { type: 'ventil', navn: 'Ventilrute', felt: { side: 'left', ventil: 'front' } },
  { type: 'rear', navn: 'Bakrute', felt: { layout: 'single' } },
  { type: 'roof', navn: 'Takglass', felt: { system: 'fixed', panel: 'whole' } },
  { type: 'unknown', navn: 'Vet ikke', felt: null },
];

async function apneStartside(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#input-regnr', { timeout: 20000 });
}

async function sokBil(page, regnr) {
  await page.fill('#input-regnr', regnr);
  await page.click('#form-regnr button[type=submit]');
  await page.waitForSelector('#screen-glass:not(.hidden)', { timeout: 20000 });
  return (await page.textContent('#glass-bilnavn') || '').trim();
}

for (const viewport of [{ navn: 'mobil', width: 393, height: 852 }, { navn: 'desktop', width: 1280, height: 900 }]) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });

  for (const t of TYPER) {
    const page = await context.newPage();
    const jsFeil = [];
    const apiKall = [];
    page.on('pageerror', (e) => jsFeil.push(String(e.message || e)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // /api/auth/session uten innlogget kunde svarer 401 — det er forventet
      // oppførsel (og selve svaret logges som nettverksfeil av Chrome).
      if (/401/.test(m.text()) && !/api\/glass|api\/frontrute/.test(m.text())) return;
      jsFeil.push('console: ' + m.text());
    });
    page.on('response', async (r) => {
      if (r.url().includes('/api/')) apiKall.push({ url: r.url(), status: r.status() });
    });

    const rad = { viewport: viewport.navn, type: t.navn, bil: '', status: 'PASS', h2: '', kandidater: 0, api: [], skjermbilde: '' };
    try {
      await apneStartside(page);
      rad.bil = await sokBil(page, REGNR);

      await page.click(`.glassopt[data-type="${t.type}"]`, { force: true });

      // Vent på selve API-svaret, ikke bare på at skjermen er synlig: skjermen
      // vises («Søker etter glass…») FØR kallet er ferdig, og alt som leses i
      // mellomtiden ville vært tom tilstand.
      const svarVent = page.waitForResponse((r) => /\/api\/(glass\/kandidater|frontrute)/.test(r.url()), { timeout: 30000 }).catch(() => null);

      if (t.felt) {
        await page.waitForSelector('#glass-placement:not(.hidden)', { timeout: 10000 });
        for (const [navn, verdi] of Object.entries(t.felt)) {
          await page.selectOption(`#glass-placement-fields select[name="${navn}"]`, verdi);
        }
        await page.click('#btn-glass-search');
      }

      await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 20000 });
      const svar = await svarVent;
      if (!svar) noter('FEIL', `${t.navn}/${viewport.navn}: frontend kalte ikke API-et`);
      // svaret må være ferdig rendret: «Be om pristilbud» aktiveres i renderGlassResultat
      await page.waitForFunction(() => {
        const knapp = document.querySelector('#btn-inquiry');
        return knapp && !knapp.disabled;
      }, { timeout: 25000 }).catch(() => noter('ADVARSEL', `${t.navn}/${viewport.navn}: tilbudsknappen ble aldri aktiv`));

      rad.h2 = (await page.textContent('#screen-resultat h2') || '').trim();
      rad.status = (await page.textContent('#resultat-status') || '').trim();
      rad.kandidater = await page.locator('#resultat-kort .kandidat-kort').count();
      rad.tilbudsKnapp = await page.isEnabled('#btn-inquiry');
      rad.skjermbilde = `${UT}/${viewport.navn}-${t.type}.png`;
      await page.screenshot({ path: rad.skjermbilde, fullPage: true });

      // Ingen rå intern diagnostikk i kundeflaten
      const kortTekst = await page.textContent('#screen-resultat');
      for (const forbudt of ['CLASS_D_CATALOGUE_CANDIDATE', 'GT_AUTO_PRISLISTE', 'matchReason', 'undefined', 'NaN']) {
        if ((kortTekst || '').includes(forbudt)) noter('FEIL', `${t.navn}/${viewport.navn}: «${forbudt}» vises til kunden`);
      }

      // Horisontal overflyt (mobil)
      if (viewport.navn === 'mobil') {
        const overflyt = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflyt > 2) noter('FEIL', `${t.navn}/mobil: horisontal overflyt ${overflyt}px`);
      }

      // Tilbudsskjema: skal åpne, og validere (uten å sende)
      if (rad.tilbudsKnapp) {
        await page.click('#btn-inquiry');
        const skjemaSynlig = await page.isVisible('#inquiry-form');
        if (!skjemaSynlig) noter('FEIL', `${t.navn}/${viewport.navn}: tilbudsskjemaet åpnet ikke`);
        else {
          await page.fill('#inquiry-navn', '');
          await page.click('#btn-inquiry-send');
          await page.waitForTimeout(600);
          const feil = (await page.textContent('#inquiry-feil') || '').trim();
          const sendt = await page.isVisible('#inquiry-bekreftet') && !(await page.textContent('#inquiry-bekreftet') || '').includes('hidden');
          if (sendt) noter('FEIL', `${t.navn}/${viewport.navn}: tomt skjema ble SENDT (skal avvises)`);
          if (!feil) noter('ADVARSEL', `${t.navn}/${viewport.navn}: ingen valideringsfeil ved tomt skjema`);
          rad.validering = feil.slice(0, 80);
        }
      } else {
        noter('FEIL', `${t.navn}/${viewport.navn}: «Be om pristilbud» er deaktivert`);
      }

      const kandidatApi = apiKall.filter((k) => /\/api\/(glass\/kandidater|frontrute)/.test(k.url));
      rad.api = kandidatApi.map((k) => k.status);
      if (!kandidatApi.length) {
        noter('FEIL', `${t.navn}/${viewport.navn}: frontend kalte ikke kandidat-API-et`);
      }
      for (const kall of kandidatApi) if (kall.status >= 400) noter('FEIL', `${t.navn}/${viewport.navn}: API svarte ${kall.status}`);

      if (jsFeil.length) {
        rad.status = 'JS-FEIL';
        noter('FEIL', `${t.navn}/${viewport.navn}: JS-feil: ${jsFeil.slice(0, 2).join(' | ')}`);
      }
    } catch (e) {
      rad.status = 'KRASJ';
      noter('FEIL', `${t.navn}/${viewport.navn}: ${String(e.message || e).split('\n')[0]}`);
      try { await page.screenshot({ path: `${UT}/feil-${viewport.navn}-${t.type}.png`, fullPage: true }); } catch { /* ignore */ }
    } finally {
      resultater.push(rad);
      console.log(`${viewport.navn.padEnd(8)} ${t.navn.padEnd(10)} h2="${rad.h2}" kandidater=${rad.kandidater} api=[${(rad.api || []).join(',')}] ${rad.status}`);
      await page.close();
    }
  }
  await browser.close();
}

// Regresjon: frontrutesøket (via /api/frontrute) må fortsatt virke.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  try {
    await apneStartside(page);
    const bil = await sokBil(page, REGNR);
    await page.click('.glassopt[data-type="front"]', { force: true });
    await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 20000 });
    await page.waitForTimeout(2500);
    const kort = (await page.textContent('#resultat-kort') || '').trim();
    const h2 = (await page.textContent('#screen-resultat h2') || '').trim();
    const pris = await page.locator('#resultat-kort .pris, #resultat-kort strong').count();
    // VERIFY (flere varianter) skal gi kontrollspørsmål — kun de som faktisk skiller.
    const sporsmaal = await page.locator('#screen-resultat .sporsmaal').count();
    console.log(`\nFRONTRUTE-REGRESJON: bil="${bil}" h2="${h2}" kortlengde=${kort.length} pris/kort-elementer=${pris} sporsmaal=${sporsmaal}`);
    if (!kort.length) noter('FEIL', 'frontrute: resultatkortet er tomt (regresjon)');
    if (/flere mulige frontruter/i.test(h2) && sporsmaal === 0) {
      noter('ADVARSEL', 'frontrute: VERIFY uten kontrollspørsmål (kandidatene vises, men utstyret avklares ikke)');
    }
    if (/flere mulige frontruter/i.test(h2)) noter('INFO', `frontrute: ${sporsmaal} kontrollspørsmål vist`);
    await page.screenshot({ path: `${UT}/frontrute-regresjon.png`, fullPage: true });
  } catch (e) {
    noter('FEIL', 'frontrute-regresjon: ' + String(e.message || e).split('\n')[0]);
  } finally {
    await browser.close();
  }
}

const rapport = { base: BASE, regnr: REGNR, tid: new Date().toISOString(), resultater, funn };
writeFileSync(`${UT}/e2e-rapport.json`, JSON.stringify(rapport, null, 2));

const feil = funn.filter((f) => f.niva === 'FEIL');
console.log(`\nOPPSUMMERING: ${resultater.length} brukerreiser, ${feil.length} FEIL, ${funn.length - feil.length} advarsler`);
for (const f of funn) console.log(`  [${f.niva}] ${f.tekst}`);
process.exit(feil.length ? 1 : 0);
