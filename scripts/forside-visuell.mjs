// Visuell verifisering av forsiden: 390 (mobil), 768 (nettbrett), 1440 (desktop).
// Sjekker horisontal overflyt, at hero-teksten er synlig og at header/CTA ikke
// overlapper. Skriver skjermbilder til .hermes/forside-visuell/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8811';
const UT = process.env.UT || '.hermes/forside-visuell';
mkdirSync(UT, { recursive: true });

const visninger = [
  { navn: 'mobil-390', bredde: 390, hoyde: 844, mobil: true },
  { navn: 'nettbrett-768', bredde: 768, hoyde: 1024, mobil: false },
  { navn: 'desktop-1440', bredde: 1440, hoyde: 900, mobil: false },
];

const nettleser = await chromium.launch();
let feil = 0;

for (const v of visninger) {
  const ctx = await nettleser.newContext({
    viewport: { width: v.bredde, height: v.hoyde },
    deviceScaleFactor: 2,
    isMobile: v.mobil,
    hasTouch: v.mobil,
  });
  const side = await ctx.newPage();
  const svar = await side.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const status = svar?.status();

  const rapport = await side.evaluate(() => {
    const tekst = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const h1 = document.querySelector('h1')?.innerText.replace(/\s+/g, ' ').trim() || '';
    const header = document.querySelector('header.top');
    const loggInn = document.querySelector('a[href="/logg-inn"]');
    const regnr = document.querySelector('#input-regnr');
    const knapp = document.querySelector('#form-regnr button[type="submit"]');
    const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
    return {
      h1,
      harHero: tekst.includes('Riktig bilglass. En pris du forstår.'),
      gammel: /Bilglass til riktig pris|Kjenner du Tom Arne/.test(tekst),
      scrollBredde: document.documentElement.scrollWidth,
      klientBredde: document.documentElement.clientWidth,
      header: r(header), loggInn: r(loggInn), regnr: r(regnr), knapp: r(knapp),
    };
  });

  const overflyt = rapport.scrollBredde - rapport.klientBredde;
  const feilHer = [];
  if (status !== 200) feilHer.push(`HTTP ${status}`);
  if (!rapport.harHero) feilHer.push('hero-tekst mangler');
  if (rapport.gammel) feilHer.push('gammel forside');
  if (overflyt > 1) feilHer.push(`horisontal overflyt ${overflyt}px`);
  if (!rapport.loggInn) feilHer.push('Logg inn-lenke mangler');
  if (!rapport.regnr) feilHer.push('regnr-felt mangler');
  // Knappen skal ikke ligge utenfor viewport eller oppå regnr-feltet.
  if (rapport.knapp && (rapport.knapp.right > v.bredde + 1 || rapport.knapp.left < -1)) {
    feilHer.push('CTA utenfor viewport');
  }
  if (rapport.knapp && rapport.regnr && rapport.knapp.top < rapport.regnr.bottom - 2 && rapport.knapp.left < rapport.regnr.right) {
    feilHer.push('CTA overlapper regnr-felt');
  }

  await side.screenshot({ path: join(UT, `${v.navn}.png`), fullPage: true });
  feil += feilHer.length;
  console.log(`${v.navn}: HTTP ${status} | scroll ${rapport.scrollBredde}/${rapport.klientBredde} | h1="${rapport.h1}" | ${feilHer.length ? 'FEIL: ' + feilHer.join('; ') : 'OK'}`);
  await ctx.close();
}

await nettleser.close();
console.log(feil === 0 ? 'VISUELL: OK' : `VISUELL: ${feil} feil`);
process.exit(feil === 0 ? 0 : 1);
