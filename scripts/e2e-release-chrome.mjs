// Release-E2E (staging) — hele kundereisen for alle glasstyper, ekte Google Chrome.
//
// Verifiserer INNHOLD OG STATUS, ikke bare HTTP 200:
//   • kandidater vises som rader med varenr + plassering når API-et gir treff
//   • null treff gir «Vi kontrollerer ruten manuelt» + MANUAL_REVIEW-tekst,
//     og «Be om pristilbud» virker (ingen blindvei)
//   • eurokode, pris og intern klassifisering vises ALDRI i kundeflaten
//   • ingen JavaScript-feil, ingen horisontal overflyt på mobil
//   • frontrutesøket (egen resolver) er uendret
//
// Skriver ALDRI en reell henvendelse: skjemavalideringen testes med tomme felt.
//
// Bruk: FBG_BASE=https://<staging> node scripts/e2e-release-chrome.mjs
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
const UT = process.env.FBG_OUT || '/Users/taj/.hermes/cache/scratch/fbg-fase2/e2e-release';
const REGNR = process.env.FBG_REGNR || 'SU18018';
mkdirSync(UT, { recursive: true });

const funn = [];
const resultater = [];
const noter = (niva, tekst) => funn.push({ niva, tekst });

// selection-formatet er produksjonens (glass-selection-contract.ts): ventil bruker «placement».
// Plasseringsvalgene bygges fra bilens data. `onske` er hvilke svar E2E-en
// foretrekker når steget faktisk tilbys; ellers velges første alternativ.
const TYPER = [
  { type: 'front', navn: 'Frontrute', onske: [], forventKandidater: 'frontrute' },
  { type: 'door', navn: 'Dørrute', onske: ['front', 'left', 'estate'], forventKandidater: true },
  { type: 'side', navn: 'Siderute', onske: ['right', 'estate'], forventKandidater: true },
  { type: 'ventil', navn: 'Ventilrute', onske: ['front', 'left', 'estate'], forventKandidater: null },
  { type: 'rear', navn: 'Bakrute', onske: ['estate'], forventKandidater: true },
  { type: 'roof', navn: 'Takglass', onske: [], forventKandidater: null },
  { type: 'unknown', navn: 'Trenger hjelp', onske: [], forventKandidater: true },
];

async function apneStartside(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#input-regnr', { timeout: 20000 });
}

// Går gjennom de datastyrte stegene. Hvert steg er én trykkflate per gyldig
// alternativ — ingen rullegardin, ingen kombinasjon uten katalogstøtte.
async function velgPlassering(page, onske) {
  for (let i = 0; i < 4; i++) {
    const steg = page.locator('#glass-placement:not(.hidden) .valg-knapp');
    if (!(await steg.count())) return;
    const verdier = await steg.evaluateAll((els) => els.map((e) => e.getAttribute('data-verdi')));
    const valg = verdier.find((v) => onske.includes(v)) || verdier[0];
    await page.click(`#glass-placement-fields .valg-knapp[data-verdi="${valg}"]`);
    await page.waitForTimeout(150);
  }
}

async function sokBil(page, regnr) {
  await page.fill('#input-regnr', regnr);
  await page.click('#form-regnr button[type=submit]');
  await page.waitForSelector('#screen-glass:not(.hidden)', { timeout: 20000 });
  return (await page.textContent('#glass-bilnavn') || '').trim();
}

/** Én full reise for én bil: regnr → glasstype → resultat → tilbudsskjema. */
async function reis(context, bil, regnr, t, viewport, oker) {
  const page = await context.newPage();
  const jsFeil = [];
  const apiSvar = [];
  page.on('pageerror', (e) => jsFeil.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 401 på /api/auth/session er forventet for en ikke-innlogget kunde.
    if (/401/.test(m.text()) && !/api\/(glass|frontrute|inquiry)/.test(m.text())) return;
    jsFeil.push('console: ' + m.text());
  });
  page.on('response', (r) => { if (r.url().includes('/api/')) apiSvar.push({ url: r.url(), status: r.status() }); });

  const rad = { bil, viewport: viewport.navn, type: t.navn, status: 'PASS', h2: '', tekst: '', kandidater: 0, api: [], skjermbilde: '' };
  try {
    await apneStartside(page);
    rad.bilnavn = await sokBil(page, regnr);

    const svarVent = page.waitForResponse((r) => /\/api\/(glass\/kandidater|frontrute)/.test(r.url()), { timeout: 30000 }).catch(() => null);
    if (t.type === 'unknown') {
      // «Jeg finner ikke ruten min» er en egen inngang, ikke et katalogsøk.
      await page.click('#btn-glass-hjelp');
    } else {
      await page.click(`.glassopt[data-type="${t.type}"]`, { force: true });
      await velgPlassering(page, t.onske || []);
    }
    await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 20000 });
    const svar = await svarVent;
    if (!svar) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: frontend kalte ikke API-et`);
    // Resultatet er ferdig rendret når tilbudsknappen er aktiv.
    await page.waitForFunction(() => { const b = document.querySelector('#btn-inquiry'); return b && !b.disabled; }, { timeout: 25000 })
      .catch(() => noter('ADVARSEL', `${bil}/${t.navn}/${viewport.navn}: tilbudsknappen ble aldri aktiv`));

    rad.h2 = (await page.textContent('#screen-resultat h2') || '').trim();
    rad.tekst = (await page.textContent('#resultat-status') || '').trim();
    rad.kandidater = await page.locator('#resultat-kort .kandidat-kort[data-varenr]').count();
    rad.skjermbilde = `${UT}/${viewport.navn}-${bil}-${t.type}${t.navn.includes('ukjent') ? '-ukjent' : ''}.png`;
    await page.screenshot({ path: rad.skjermbilde, fullPage: true });

    // ── Innholdskontroller (ikke bare HTTP 200) ──────────────────────────────
    const hele = (await page.textContent('#screen-resultat') || '');
    for (const forbudt of ['CLASS_D_CATALOGUE_CANDIDATE', 'GT_AUTO_PRISLISTE', 'matchReason', 'undefined', 'NaN', 'listepris']) {
      if (hele.includes(forbudt)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: «${forbudt}» vises til kunden`);
    }
    // Eurokode er leverandørdata: 4 siffer + posisjonsbokstav + suffiks (f.eks. 8579AGSGYAVZ1B).
    if (/\b\d{4}[ABLR][A-Z0-9]{3,}\b/.test(hele)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: eurokode-lignende streng i kundeflaten`);

    // Frontrute har egen visning (/api/frontrute) — den telles ikke som kandidatrader her.
    if (t.type === 'front') {
      if (!/frontrute/i.test(rad.h2)) noter('FEIL', `${bil}/front/${viewport.navn}: uventet h2 «${rad.h2}»`);
      if (!(await page.textContent('#resultat-kort') || '').trim()) noter('FEIL', `${bil}/front/${viewport.navn}: tomt resultatkort`);
    }
    // Bare Transporter 2005 har katalogdekning for de øvrige klassene; Caddy mangler
    // familie i katalogen og SKAL gi MANUAL_REVIEW (dekning, ikke feil).
    if (t.type !== 'front' && bil === 'transporter' && t.forventKandidater === true && rad.kandidater === 0) {
      noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: forventet kandidatrader, fikk 0 (h2="${rad.h2}")`);
    }
    if (rad.kandidater > 0) {
      if (!/mulige glass/i.test(rad.h2)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: kandidater vist, men h2="${rad.h2}"`);
      const kort = (await page.textContent('#resultat-kort') || '');
      if (!/krever kontroll/i.test(kort)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: mangler «krever kontroll»-merking`);
    }
    if (rad.kandidater === 0 && t.type !== 'front') {
      if (!/kontrollerer ruten manuelt/i.test(rad.h2)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: null treff ga h2="${rad.h2}" (skal være MANUAL_REVIEW)`);
      if (!rad.tekst) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: MANUAL_REVIEW uten kundetekst`);
      if (/ingen glass finnes/i.test(hele)) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: kunden får «ingen glass finnes»`);
    }

    if (viewport.navn === 'mobil') {
      const overflyt = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflyt > 2) noter('FEIL', `${bil}/${t.navn}/mobil: horisontal overflyt ${overflyt}px`);
    }

    // Tilbudsreisen: alltid mulig, også ved null treff. Sendes ALDRI.
    if (!(await page.isEnabled('#btn-inquiry'))) {
      noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: «Be om pristilbud» er deaktivert`);
    } else {
      await page.click('#btn-inquiry');
      if (!(await page.isVisible('#inquiry-form'))) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: tilbudsskjemaet åpnet ikke`);
      else {
        if (await page.isVisible('#inquiry-bekreftet') && (await page.textContent('#inquiry-bekreftet') || '').length > 3) {
          noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: skjema ble sendt uten utfylling`);
        }
        await page.fill('#inquiry-navn', '');
        await page.click('#btn-inquiry-send');
        await page.waitForTimeout(500);
        const validering = (await page.textContent('#inquiry-feil') || '').trim();
        if (!validering) noter('ADVARSEL', `${bil}/${t.navn}/${viewport.navn}: ingen valideringsfeil ved tomt skjema`);
        rad.validering = validering.slice(0, 60);
        if (/bekreftet|sendt/i.test((await page.textContent('#inquiry-bekreftet') || ''))) {
          noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: ufullstendig skjema ble akseptert`);
        }
      }
    }

    const api = apiSvar.filter((k) => /\/api\/(glass\/kandidater|frontrute|inquiry)/.test(k.url));
    rad.api = api.map((k) => k.status);
    for (const kall of api) if (kall.status >= 400 && !kall.url.includes('/inquiry')) noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: ${kall.url.split('/api/')[1]} → ${kall.status}`);
    if (jsFeil.length) {
      rad.status = 'JS-FEIL';
      noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: JS-feil: ${jsFeil.slice(0, 2).join(' | ')}`);
    }
  } catch (e) {
    rad.status = 'KRASJ';
    noter('FEIL', `${bil}/${t.navn}/${viewport.navn}: ${String(e.message || e).split('\n')[0]}`);
    try { await page.screenshot({ path: `${UT}/feil-${viewport.navn}-${bil}-${t.type}.png`, fullPage: true }); } catch { /* ignore */ }
  } finally {
    resultater.push(rad);
    console.log(`${bil} ${viewport.navn.padEnd(8)} ${t.navn.padEnd(10)} h2="${rad.h2.slice(0, 40)}" kandidater=${rad.kandidater} api=[${(rad.api || []).join(',')}] ${rad.status}`);
    await page.close();
  }
}

// To biler: Transporter 2005 (katalogdekning) og Caddy 2017 (ingen familie = null treff).
const BILER = [
  { navn: 'transporter', regnr: REGNR },
  { navn: 'caddy', regnr: 'JD79487' },
];

for (const viewport of [{ navn: 'mobil', width: 393, height: 852 }, { navn: 'desktop', width: 1280, height: 900 }]) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  for (const bil of BILER) {
    for (const t of TYPER) {
      if (bil.navn === 'caddy' && viewport.navn === 'desktop' && t.type !== 'door' && t.type !== 'front') continue; // hold kjøretiden nede
      await reis(context, bil.navn, bil.regnr, t, viewport);
    }
  }
  await browser.close();
}

// Frontrute-regresjon: egen resolver, kontrollspørsmål, pris.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  try {
    await apneStartside(page);
    const bilnavn = await sokBil(page, REGNR);
    await page.click('.glassopt[data-type="front"]', { force: true });
    await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 20000 });
    await page.waitForFunction(() => { const b = document.querySelector('#btn-inquiry'); return b && !b.disabled; }, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const h2 = (await page.textContent('#screen-resultat h2') || '').trim();
    const kort = (await page.textContent('#resultat-kort') || '').trim();
    const sporsmaal = await page.locator('#screen-resultat .sporsmaal').count();
    const prisElementer = await page.locator('#resultat-kort .pris, #resultat-kort strong').count();
    console.log(`\nFRONTRUTE-REGRESJON: bil="${bilnavn}" h2="${h2}" kort=${kort.length} tegn sporsmaal=${sporsmaal} pris-elementer=${prisElementer}`);
    if (!kort.length) noter('FEIL', 'frontrute: resultatkortet er tomt (regresjon)');
    if (!/frontrute/i.test(h2)) noter('FEIL', `frontrute: uventet h2 «${h2}»`);
    if (sporsmaal === 0) noter('ADVARSEL', 'frontrute: VERIFY uten kontrollspørsmål');
    await page.screenshot({ path: `${UT}/frontrute-regresjon.png`, fullPage: true });
  } catch (e) {
    noter('FEIL', 'frontrute-regresjon: ' + String(e.message || e).split('\n')[0]);
  } finally {
    await browser.close();
  }
}

writeFileSync(`${UT}/e2e-rapport.json`, JSON.stringify({ base: BASE, tid: new Date().toISOString(), resultater, funn }, null, 2));
const feil = funn.filter((f) => f.niva === 'FEIL');
console.log(`\nOPPSUMMERING: ${resultater.length} brukerreiser · ${feil.length} FEIL · ${funn.length - feil.length} advarsler`);
for (const f of funn) console.log(`  [${f.niva}] ${f.tekst}`);
process.exit(feil.length ? 1 : 0);
