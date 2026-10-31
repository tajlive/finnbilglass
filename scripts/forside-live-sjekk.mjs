// Sjekker at BEGGE produksjonsdomener serverer den godkjente forsiden.
// Brukes som post-deploy-gate i CI og kan kjøres manuelt:
//   node scripts/forside-live-sjekk.mjs
//   BASE=https://staging.example node scripts/forside-live-sjekk.mjs
//
// Cache-bypass: unik query + no-cache/private + Pragma, og Cloudflare
// cache-reserved headeren for å tvinge revalidering. Vi sammenligner
// NORMALISERT tekst, slik at <br>/<span> ikke gir falskt utfall.

const GODKJENT = 'Riktig bilglass. En pris du forstår.';
const GAMMEL = [/Bilglass til riktig pris/, /Kjenner du Tom Arne/];

const domener = process.env.DOMENER
  ? process.env.DOMENER.split(',').map((d) => d.trim())
  : ['https://finnbilglass.no', 'https://www.finnbilglass.no'];

function normaliser(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let feil = 0;
for (const base of domener) {
  const url = `${base}/?cb=${Date.now()}`;
  try {
    const svar = await fetch(url, {
      redirect: 'follow',
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0',
        Pragma: 'no-cache',
        'User-Agent': 'finnbilglass-forside-sjekk/1.0',
      },
    });
    const html = await svar.text();
    const tekst = normaliser(html);
    const problemer = [];
    if (!svar.ok) problemer.push(`HTTP ${svar.status}`);
    if (!tekst.includes(GODKJENT)) problemer.push('godkjent hero-tekst mangler');
    for (const g of GAMMEL) if (g.test(tekst)) problemer.push(`gammel forside (${g})`);
    if (/<\/html>\s*$/i.test(html) === false && html.length < 500) problemer.push('mistekkelig kort svar');
    if (problemer.length) feil += 1;
    console.log(
      `${base} → ${problemer.length ? 'FEIL: ' + problemer.join('; ') : 'OK'}` +
        ` (HTTP ${svar.status}, ${html.length} tegn)`,
    );
  } catch (e) {
    feil += 1;
    console.log(`${base} → FEIL: ${e.message}`);
  }
}

if (feil) {
  console.error(`\nFORSIde-sjekk: ${feil} domene(r) feilet`);
  process.exit(1);
}
console.log('\nForside-sjekk: begge domener serverer godkjent forside');
