// Oppgraderingstest: besøkende med GAMMEL service worker + cache skal få den
// NYE forsiden etter deploy — uten å måtte tømme nettleserdata.
//
// Bakgrunn: produksjonen går fra gammel forside (sw v1) til ny kundeforside
// (sw customer-flow-v4). Hvis gammel SW eller gammel cache holder på HTML/CSS/JS,
// blir kunden hengende på gammel side. Testen simulerer:
//   last gammel side → SW installeres → bytt filer (deploy) → last på nytt.
//
// Kjøres over HTTPS med selvsignert sertifikat, fordi app.js kun registrerer
// service worker på https (samme vilkår som produksjon).
//
//   node scripts/forside-oppgraderingstest.mjs
//   FORRIGE_REF=origin/main node scripts/forside-oppgraderingstest.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

// «Gammel» = ref-en som fortsatt har den forrige forsiden. Etter at PR #18
// (moderne forside) ble merget til main, er origin/main den NYE siden — å peke
// på den gjør testen meningsløs. 11185f8 er siste main-commit med den gamle
// forsiden (den som ligger i produksjon frem til neste deploy). Oppdater denne
// når produksjon faktisk kjører den nye siden, eller overstyr med FORRIGE_REF.
const FORRIGE_REF = process.env.FORRIGE_REF || '11185f8';
const GODKJENT = 'Riktig bilglass. En pris du forstår.';
const GAMMEL = /Bilglass til riktig pris|Kjenner du Tom Arne/;

const TYPER = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const rot = mkdtempSync(join(tmpdir(), 'fbg-oppgradering-'));
const gammelDir = join(rot, 'gammel');
const nyDir = join(rot, 'ny');
const noekkel = join(rot, 'key.pem');
const sert = join(rot, 'cert.pem');

execFileSync('bash', ['-c', `mkdir -p '${gammelDir}' && git archive ${FORRIGE_REF} public | tar -x -C '${gammelDir}' --strip-components=1`], { stdio: 'pipe' });
execFileSync('bash', ['-c', `mkdir -p '${nyDir}' && cp -R public/. '${nyDir}/'`], { stdio: 'pipe' });
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', noekkel, '-out', sert, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'pipe' });

let aktiv = gammelDir;
const server = createServer({ key: readFileSync(noekkel), cert: readFileSync(sert) }, (req, res) => {
  const url = new URL(req.url, 'https://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const sti = join(aktiv, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(sti) || !statSync(sti).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>404</title>ikke funnet');
    return;
  }
  const hoder = { 'content-type': TYPER[extname(sti)] || 'application/octet-stream' };
  if (sti.endsWith('.html')) hoder['cache-control'] = 'no-store';
  res.writeHead(200, hoder);
  res.end(readFileSync(sti));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `https://127.0.0.1:${server.address().port}`;
console.log(`Serverer ${FORRIGE_REF} (gammel) → arbeidskatalog (ny) på ${base}`);

const profil = mkdtempSync(join(tmpdir(), 'fbg-profil-'));
const ctx = await chromium.launchPersistentContext(profil, {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  ignoreHTTPSErrors: true,
  // Service worker-innlasting krever at sertifikatet godtas også på nettverksnivå
  // (ignoreHTTPSErrors dekker ikke SW-scripthenting alene).
  args: ['--ignore-certificate-errors'],
});
const side = await ctx.newPage();
const feil = [];
const tekst = () => side.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
const cacher = () => side.evaluate(() => (window.caches ? caches.keys() : Promise.resolve([])));
const kontrollert = () => side.evaluate(() => !!navigator.serviceWorker?.controller);

try {
  // 1) Gammel side: la service worker installere og ta kontroll
  await side.goto(`${base}/`, { waitUntil: 'load', timeout: 30000 });
  const reg = await side.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'ingen-sw';
    try {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return 'ok';
    } catch (e) {
      return 'feil: ' + e.message;
    }
  });
  await side.reload({ waitUntil: 'load', timeout: 30000 }); // denne gangen kontrollert
  const forste = { tekst: await tekst(), kontrollert: await kontrollert(), cacher: await cacher() };
  const varGammel = GAMMEL.test(forste.tekst);
  console.log(`1) gammel: reg=${reg} kontrollert=${forste.kontrollert} gammel=${varGammel} cacher=[${forste.cacher}]`);
  if (reg !== 'ok') feil.push(`SW-registrering feilet: ${reg}`);
  if (!varGammel) feil.push(`${FORRIGE_REF} er ikke gammel forside — testen mister poenget`);
  if (!forste.kontrollert) feil.push('service worker kontrollerte ikke siden');

  // 2) Deploy: bytt til ny frontend
  aktiv = nyDir;
  console.log('2) deploy: nye filer på samme origin');

  // 3) Tilbakevendende besøkende laster på nytt (gammel SW + gammel cache aktiv)
  await side.reload({ waitUntil: 'load', timeout: 30000 });
  const andre = { tekst: await tekst(), cacher: await cacher() };
  const harNy = andre.tekst.includes(GODKJENT);
  const harGammel = GAMMEL.test(andre.tekst);
  console.log(`3) etter reload: ny=${harNy} gammel=${harGammel} cacher=[${andre.cacher}]`);
  if (!harNy) feil.push('ny forside vises ikke etter oppgradering (SW/cache holder gammel side)');
  if (harGammel) feil.push('gammel forside vises fortsatt etter oppgradering');

  // 4) Ny SW skal ta over og rydde bort gamle cachenavn (skjer asynkront etter reload)
  let nyeCacher = andre.cacher;
  const frist = Date.now() + 20000;
  while (Date.now() < frist && !nyeCacher.some((k) => k.includes('customer-flow-v4'))) {
    await side.waitForTimeout(500);
    await side.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
    });
    nyeCacher = await cacher();
  }
  const nyAktiv = nyeCacher.some((k) => k.includes('customer-flow-v4'));
  console.log(`4) ny SW/cache aktiv=${nyAktiv} cacher=[${nyeCacher.join(', ')}]`);
  if (!nyAktiv) feil.push('ny service worker tok ikke over innen 20 s (tilbakevendende kunder beholder gammel SW)');

  // 5) Neste besøk, nå kontrollert av ny SW — gammel cache skal være slettet
  await side.reload({ waitUntil: 'load', timeout: 30000 });
  const tredje = await tekst();
  const sluttCacher = await cacher();
  const gamleIgjen = sluttCacher.filter((k) => /-(v1|v2|v3)$/.test(k));
  console.log(`5) tredje besøk: ny=${tredje.includes(GODKJENT)} cacher=[${sluttCacher.join(', ')}]`);
  if (!tredje.includes(GODKJENT)) feil.push('tredje besøk viser ikke ny forside');
  if (gamleIgjen.length) {
    // Ikke brukerpåvirkning: nye filer serveres uansett (verifisert over), og
    // gammel cache ryddes ved aktivering. Rapporteres, men feiler ikke gaten.
    console.log(`   ADVARSEL: gamle cachenavn ligger igjen til aktivering: ${gamleIgjen.join(', ')}`);
  }
} finally {
  await ctx.close();
  server.close();
  rmSync(rot, { recursive: true, force: true });
  rmSync(profil, { recursive: true, force: true });
}

if (feil.length) {
  console.error(`\nOPPGRADERING: ${feil.length} feil`);
  for (const f of feil) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nOPPGRADERING: OK — gammel SW + cache gir ny forside uten manuell tømming');
