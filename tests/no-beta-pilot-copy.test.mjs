import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const publicPages = ['public/404.html', 'public/index.html', 'public/betaling.html', 'public/bilglass-uten-forsikring.html', 'public/om-oss.html', 'public/personvern.html', 'public/vilkar.html'];
function visible(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi,'')
    .replace(/<style\b[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]*>/g,' ');
}
test('customer-facing pages have no beta, pilot, preview or testphase labels',()=>{
  for(const path of publicPages) {
    const v=visible(read(path));
    assert.doesNotMatch(v,/\b(?:beta|pilot|testfase|betaversjon|forhåndsvisning)\b/i,path);
  }
});
test('production-facing frontend CSS and JavaScript have no legacy beta or pilot identifiers',()=> {
  for (const path of ['public/styles.css', 'public/app.js']) {
    const content=read(path);
    assert.doesNotMatch(content, /\\bbeta(?:\\b|-)|\\bpilot(?:\\b|-)/i, path);
  }
});
test('manual quote safety language remains on the homepage and payment page',()=>{
  const home=read('public/index.html'),payment=read('public/betaling.html');
  assert.match(home,/Vi dobbeltsjekker alle glassvalg og priser før bestilling/);
  assert.match(home,/Pris på aktuelt tilbehør avklares i tilbudet/);
  assert.match(payment,/Først når du aksepterer tilbudet, oppretter vi ordren/);
  for(const method of ['vipps','klarna','visa','mastercard'])
    assert.match(home,new RegExp('/assets/betaling/'+method+'\\.svg'));
});
test('privacy disclosure retains real data handling constraints',()=>{
  const privacy=read('public/personvern.html');
  assert.match(privacy,/Søkelogger og tilbudssaker lagres i Cloudflare D1/);
  assert.match(privacy,/foreløpig ikke satt opp automatisk sletting/);
  assert.match(privacy,/gjennomgås og slettes manuelt/);
  assert.match(privacy,/spørsmål eller forespørsler om innsyn, retting eller sletting/);
});
test('internal ops label is customer-request oriented, without renaming data or API',()=>{
  const ops=read('src/ops-center-ui.ts');
  assert.match(ops,/Tilbudsforespørsler \(tilbud\/bekreftelse\)/);
  assert.doesNotMatch(ops,/Beta-henvendelser/);
});
