// Automatisk full betatest — finnbilglass.no (staging/prod).
// Nåværende tilbudsflyt: regnr → SVV → dokumenterte kandidatvarianter
// → manuell godkjenning av glass og pris → forespørsel. Ingen automatisk ordre.
// Dette er en LIVE kundereisetest, ikke en fasittest for kandidat-resolveren.
// Bruk kun FBG_SEND_INQUIRY=1 mot staging; normal smoke sender ingenting.
// Exit: 0 = grønt · 1 = funn · 2 = teknisk krasj
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire('/Users/taj/klarpakke/'); // lokal dev (script ligger i finnbilglass-repoet)
  ({ chromium } = require('playwright'));
}

const BASE = process.env.FBG_BASE || 'https://finnbilglass.no';
const SEND_INQUIRY = process.env.FBG_SEND_INQUIRY === '1';
const UT = process.env.FBG_OUT || new URL('../scripts/out/', import.meta.url).pathname;

// Regnr hentet fra SVV-korpuset (verifisert 2026-08-15/19).
const BILER = [
  { navn: 'transporter', regnr: 'CV80776',  svar: ['Vet ikke', 'Vet ikke'] },
  { navn: 'bmw-320d',    regnr: 'XD84921',  svar: ['Vet ikke', 'Vet ikke', 'Vet ikke', 'Vet ikke'] },
  { navn: 'leaf',        regnr: 'EL21939',  svar: ['Vet ikke', 'Vet ikke'] },
  { navn: 't5-2005',     regnr: 'SU18018',  svar: ['Vet ikke', 'Vet ikke', 'Vet ikke', 'Vet ikke'] },
];

const funn = [];
let stagingInquirySent = false;
function funnPush(level, msg) { funn.push({ level, msg }); }

async function apiRegnr(regnr) {
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr, lookupOnly: true }),
  });
  if (!r.ok) return { http: r.status };
  return await r.json();
}

async function kjorBil(browser, b) {
  const navn = `${b.navn} (${b.regnr})`;
  // Samme kundereise testes i mobil og desktop, uten ordre eller innsending.
  for (const viewport of [{ width: 393, height: 852 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    // E2E på produksjonsdomene er uten skriveeffekter: /api/regnr bruker
    // lookupOnly, og testnettleseren blokkerer opplærings-/hendelseslogg.
    await page.route('**/api/opplaering', route => route.fulfill({ status: 204, body: '' }));
    const kontekst = `${navn} ${viewport.width}px`;
    try {
      const api = await apiRegnr(b.regnr);
      if (!api.ok || !api.bil) {
        funnPush('FEIL', `${kontekst}: /api/regnr svarte ikke ok (http=${api.http || '?'})`);
        continue;
      }
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.fill('#input-regnr', b.regnr);
      await page.click('#form-regnr button[type=submit]');
      await page.waitForSelector('#screen-glass:not(.hidden)', { timeout: 15000 });
      const bilnavn = (await page.textContent('#glass-bilnavn') || '').trim();
      if (!bilnavn) funnPush('FEIL', `${kontekst}: bilnavn mangler`);
      console.log(`  ${viewport.width}px bil: ${bilnavn}`);

      await page.locator('.glassopt[data-type="front"]').click();
      await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 15000 });
      // The current candidate flow renders possible windshields and may show an
      // estimated price; it must NEVER claim compatibility or final prices.
      // Wait for the resolver to finish before checking results or quote fields.
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-inquiry');
        return btn && !btn.disabled;
      }, { timeout: 18000 });
      const kort = (await page.textContent('#resultat-kort') || '').trim();
      const status = (await page.textContent('#resultat-status') || '').trim();
      const oppsummering = (await page.textContent('#resultat-oppsummering') || '').trim();
      const info = [kort, status, oppsummering].join(' ');
      const regnr = (await page.textContent('#resultat-regnr') || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (!/frontrute/i.test(info)) funnPush('FEIL', `${kontekst}: frontrutevalg mangler i resultatet`);
      if (!/kontroll|dobbeltsjekk|bekreft|manuell/i.test(info)) {
        funnPush('FEIL', `${kontekst}: manuell kontroll og tilbudsverifisering mangler`);
      }
      if (/vi fikk ikke hentet|teknisk feil|prøv igjen om litt/i.test(status)) {
        funnPush('FEIL', `${kontekst}: søket feilet og falt tilbake til teknisk feilmelding`);
      }
      if (/garantert riktig|bekreftet kompatibel|100 % sikkert/i.test(info)) {
        funnPush('FEIL', `${kontekst}: ubekreftet glass fremstår som sikkert`);
      }
      if (!regnr.includes(b.regnr)) funnPush('FEIL', `${kontekst}: registreringsnummer mangler i resultatet`);
      if (await page.isVisible('#screen-spm')) {
        funnPush('FEIL', `${kontekst}: gamle utstyrsspørsmål vises i tilbudsflyten`);
      }
      if (/kr/i.test(kort) && !/estimert|bekreft|kontroll/i.test(info)) {
        funnPush('FEIL', `${kontekst}: pris vises uten estimat eller manuell godkjenning`);
      }
      await page.click('#btn-inquiry');
      await page.waitForSelector('#inquiry-form:not(.hidden)', { timeout: 5000 });
      const fyltRegnr = (await page.inputValue('#inquiry-regnr') || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const glass = (await page.textContent('#inquiry-glass-summary') || '').trim();
      if (fyltRegnr !== b.regnr) funnPush('FEIL', `${kontekst}: feil forhåndsutfylt regnr`);
      if (!/frontrute/i.test(glass)) funnPush('FEIL', `${kontekst}: valgt glasstype mangler i skjema`);

      await page.fill('#inquiry-navn', 'X');
      // Test kun klientsidevalidering. Ingen melding sendes i ordinær smoke.
      await page.click('#btn-inquiry-send');
      await page.waitForSelector('#inquiry-feil:not(.hidden)', { timeout: 5000 });
      const feil = (await page.textContent('#inquiry-feil') || '').trim();
      if (!/navn/i.test(feil)) funnPush('FEIL', `${kontekst}: ugyldig navn ble ikke avvist: ${feil}`);
      if (SEND_INQUIRY && !stagingInquirySent) {
        if (!/staging/i.test(BASE) || /^(https?:\/\/)?(www\.)?finnbilglass\.no\/?$/i.test(BASE)) {
          throw new Error('FBG_SEND_INQUIRY=1 er kun tillatt mot staging');
        }
        await page.fill('#inquiry-navn', 'Automatisk stagingtest');
        await page.fill('#inquiry-kontakt', '90000000');
        await page.click('#btn-inquiry-send');
        await page.waitForSelector('#inquiry-bekreftet:not(.hidden)', { timeout: 8000 });
        stagingInquirySent = true;
        console.log('  syntetisk stagingforespørsel sendt');
      }
      await page.screenshot({ path: `${UT}betatest-${b.navn}-${viewport.width}-resultat.png` });
    } catch (e) {
      funnPush('FEIL', `${kontekst}: krasj: ${e.message}`);
    } finally {
      await page.close();
    }
  }
}

async function ukjentRegnr(browser) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/api/opplaering', route => route.fulfill({ status: 204, body: '' }));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.fill('#input-regnr', 'ZZ99999');
    await page.click('#form-regnr button[type=submit]');
    await page.waitForSelector('#sok-feil:not(.hidden), #start-feil:not(.hidden)', { timeout: 15000 });
    const tekst = (await page.textContent('body') || '').replace(/\s+/g, ' ').slice(0, 200);
    if (!/ZZ ?99999|ikke fant|ring|e-?post|40 ?40 ?82 ?41/i.test(tekst)) {
      funnPush('ADVARSEL', `ukjent-regnr: uventet feilvisning: «${tekst}»`);
    } else console.log('  ukjent-regnr ✓ ærlig handoff med kontaktinfo');
  } catch (e) {
    funnPush('FEIL', `ukjent-regnr: krasj: ${e.message}`);
  } finally {
    await page.close();
  }
}

(async () => {
  console.log(`\n=== BETATEST ${BASE} — ${new Date().toISOString()} ===`);
  const browser = await chromium.launch();
  for (const b of BILER) {
    console.log(`\n--- ${b.navn} (${b.regnr}) ---`);
    await kjorBil(browser, b);
  }
  console.log(`\n--- ukjent regnr ---`);
  await ukjentRegnr(browser);
  await browser.close();

  const rapport = { base: BASE, tid: new Date().toISOString(), funn };
  mkdirSync(UT, { recursive: true });
  writeFileSync(`${UT}betatest.json`, JSON.stringify(rapport, null, 2));

  console.log(`\n=== SAMMENDRAG ===`);
  if (!funn.length) { console.log('ALT GRØNT — ingen funn'); process.exit(0); }
  const alvor = funn.filter((f) => f.level !== 'ADVARSEL').length;
  funn.forEach((f) => console.log(`[${f.level}] ${f.msg}`));
  process.exit(alvor ? 1 : 0);
})().catch((e) => { console.error('BETATEST KRASJ:', e); process.exit(2); });
