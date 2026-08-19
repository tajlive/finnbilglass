// Automatisk full betatest — finnbilglass.no (staging/prod).
// Hele kundereisen per bil: regnr → SVV → bekreft → glassvalg → utstyrs-spørsmål
// → resultat (pris) → henvendelsesskjema. Verifiserer Beta1-funn P1 (resolver-
// drevne spørsmål: UI-spørsmål == API sporsmaal) og P2 (ingen duplisert merke).
//
// Bruk:   node scripts/betatest-e2e.mjs                 (prod)
//         FBG_BASE=https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev node scripts/betatest-e2e.mjs
//         FBG_SEND_INQUIRY=1 ...                        (send én test-henvendelse; kun staging)
// Exit:   0 = alt grønt · 1 = betatest-funn (UI-avvik) · 2 = teknisk krasj
import { createRequire } from 'module';
const require = createRequire('/Users/taj/klarpakke/');
const { chromium } = require('playwright');

const BASE = process.env.FBG_BASE || 'https://finnbilglass.no';
const SEND_INQUIRY = process.env.FBG_SEND_INQUIRY === '1';
const UT = new URL('../scripts/out/', import.meta.url).pathname;

// Regnr hentet fra SVV-korpuset (verifisert 2026-08-15/19).
const BILER = [
  { navn: 'transporter', regnr: 'CV80776',  svar: ['Vet ikke', 'Vet ikke'] },
  { navn: 'bmw-320d',    regnr: 'XD84921',  svar: ['Vet ikke', 'Vet ikke', 'Vet ikke', 'Vet ikke'] },
  { navn: 'leaf',        regnr: 'EL21939',  svar: ['Vet ikke', 'Vet ikke'] },
  { navn: 't5-2005',     regnr: 'SU18018',  svar: ['Vet ikke', 'Vet ikke', 'Vet ikke', 'Vet ikke'] },
];

const funn = [];
function funnPush(level, msg) { funn.push({ level, msg }); }

async function apiRegnr(regnr) {
  const r = await fetch(`${BASE}/api/regnr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regnr }),
  });
  if (!r.ok) return { http: r.status };
  return await r.json();
}

async function kjorBil(browser, b) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const navn = `${b.navn} (${b.regnr})`;
  try {
    // Forventninger fra API (samme kilde frontenden bruker).
    const api = await apiRegnr(b.regnr);
    const forventetSpm = (api.resolver && Array.isArray(api.resolver.sporsmaal)) ? api.resolver.sporsmaal : null;
    if (!api.ok || !api.bil) { funnPush('FEIL', `${navn}: /api/regnr svarte ikke ok (http=${api.http || '?'})`); return; }

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.fill('#input-regnr', b.regnr);
    await page.click('#form-regnr button[type=submit]');
    // Flyt (Tom 2026-08-17/18): ingen bekreft-skjerm — direkte til glassvalg.
    await page.waitForSelector('#screen-glass:not(.hidden)', { timeout: 15000 });
    const bilnavn = (await page.textContent('#glass-bilnavn') || '').trim();
    if (!/transporter|320|leaf|transp/i.test(bilnavn) && !/2016|2014|2013|2005/.test(bilnavn)) {
      funnPush('ADVARSEL', `${navn}: glassvalg-skjerm uventet innhold: «${bilnavn}»`);
    }
    console.log(`  bil: ${bilnavn}`);

    // Velg frontrute (forhåndsvalgt hvis .aktiv finnes).
    const aktiv = await page.isVisible('.glassopt.aktiv');
    await page.locator(aktiv ? '.glassopt.aktiv' : '.glassopt[data-type="front"]').click({ force: true });

    // P1: antall UI-spørsmål skal være nøyaktig resolverens sporsmaal.
    let uiAntall = 0;
    const spmSynlig = await page.isVisible('#screen-spm');
    if (spmSynlig) {
      const teller = (await page.textContent('#spm-teller') || '').trim(); // «1/2»
      uiAntall = parseInt((teller.split('/')[1] || '0'), 10);
    }
    if (forventetSpm) {
      if (!spmSynlig && forventetSpm.length === 0) {
        console.log(`  P1 ✓ PINPOINT/ingen skillende spørsmål → direkte resultat`);
      } else if (spmSynlig && uiAntall === forventetSpm.length) {
        console.log(`  P1 ✓ ${uiAntall} spørsmål == resolver.sporsmaal (${forventetSpm.join(', ')})`);
      } else {
        funnPush('P1', `${navn}: UI viser ${spmSynlig ? uiAntall : 0} spørsmål, resolver sier ${forventetSpm.length} (${forventetSpm.join(', ')}). Doktrinebrudd!`);
      }
    }

    // Svar på spørsmålene («Vet ikke» = sikker sti), stopp ved resultat.
    for (let i = 0; i < 5 && await page.isVisible('#screen-spm'); i++) {
      const tittel = (await page.textContent('#spm-tittel') || '').trim();
      const svar = (b.svar && b.svar[i]) || 'Vet ikke';
      if (svar === 'Vet ikke') await page.click('#btn-vetikke');
      else await page.locator('#spm-svar button.sek').filter({ hasText: svar }).first().click();
      console.log(`  spm ${i + 1}: ${tittel} → ${svar}`);
      try { await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 3000 }); break; }
      catch { /* neste spørsmål */ }
    }
    await page.waitForSelector('#screen-resultat:not(.hidden)', { timeout: 20000 });

    // Resultat: navn, pris.
    const kortnavn = (await page.textContent('#resultat-kort .name') || '').trim();
    const pris = (await page.textContent('#resultat-pris') || '').trim();
    console.log(`  resultat: «${kortnavn}» — ${pris}`);

    // P2: ingen duplisert merke («NISSAN NISSAN LEAF»).
    const merke = (api.bil.merke || '').trim().toUpperCase();
    const modell = (api.bil.modell || '').trim().toUpperCase();
    const upperNavn = kortnavn.toUpperCase();
    const merkene = merke.split(/\s+/).filter((x) => x.length > 2);
    let duplisert = false;
    if (modell.startsWith(merkene[0] || '_____')) {
      duplisert = merkene.some((m) => (upperNavn.match(new RegExp(m, 'g')) || []).length > 1);
    }
    if (duplisert) funnPush('P2', `${navn}: duplisert merke i resultatkort: «${kortnavn}»`);
    else console.log('  P2 ✓ ingen duplisert merke');

    if (!pris || pris === '…' || pris.includes('undefined')) {
      funnPush('FEIL', `${navn}: pris mangler/uventet: «${pris}»`);
    }

    // Henvendelsesskjema: åpner + validerer (sender kun ved FBG_SEND_INQUIRY=1).
    await page.click('#btn-inquiry');
    await page.waitForSelector('#inquiry-form:not(.hidden)', { timeout: 5000 });
    const regnrFelt = (await page.inputValue('#inquiry-regnr')) || '';
    if (!regnrFelt.replace(/\s/g, '')) funnPush('FEIL', `${navn}: inquiry-regnr ikke forhåndsutfylt`);
    await page.fill('#inquiry-navn', 'X');
    await page.click('#btn-inquiry-send');
    await page.waitForSelector('#inquiry-feil:not(.hidden)', { timeout: 5000 });
    const feil = (await page.textContent('#inquiry-feil') || '').trim();
    if (!/navn/i.test(feil)) funnPush('ADVARSEL', `${navn}: validering ga uventet feil: «${feil}»`);
    else console.log(`  inquiry ✓ validering: «${feil}»`);
    if (SEND_INQUIRY) {
      await page.fill('#inquiry-navn', 'Betatest automatisk');
      await page.fill('#inquiry-kontakt', 'test@finnbilglass.no');
      await page.click('#btn-inquiry-send');
      await page.waitForSelector('#inquiry-bekreftet:not(.hidden)', { timeout: 8000 });
      console.log('  inquiry ✓ sendt (test-henvendelse)');
    } else {
      await page.click('#btn-inquiry'); // lukk uten å sende
    }

    await page.screenshot({ path: `${UT}betatest-${b.navn}-resultat.png` });
  } catch (e) {
    funnPush('FEIL', `${navn}: krasj: ${e.message}`);
  } finally {
    await page.close();
  }
}

async function ukjentRegnr(browser) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
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
  require('fs').mkdirSync(UT, { recursive: true });
  require('fs').writeFileSync(`${UT}betatest.json`, JSON.stringify(rapport, null, 2));

  console.log(`\n=== SAMMENDRAG ===`);
  if (!funn.length) { console.log('ALT GRØNT — ingen funn'); process.exit(0); }
  const alvor = funn.filter((f) => f.level !== 'ADVARSEL').length;
  funn.forEach((f) => console.log(`[${f.level}] ${f.msg}`));
  process.exit(alvor ? 1 : 0);
})().catch((e) => { console.error('BETATEST KRASJ:', e); process.exit(2); });
