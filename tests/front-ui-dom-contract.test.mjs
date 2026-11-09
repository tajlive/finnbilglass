// Regression guard for cross-branch frontend merges: JS must not bind to missing DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);

test('all static app.js DOM ID references exist exactly once on public homepage',()=>{
  const used = new Set([
    ...[...js.matchAll(/\$\(['"]([^"']+)['"]\)/g)].map(m=>m[1]),
    ...[...js.matchAll(/document\.getElementById\(['"]([^"']+)['"]\)/g)].map(m=>m[1]),
  ]);
  const missing = [...used].filter(id=>!ids.includes(id));
  assert.deepEqual(missing,[], 'missing static DOM IDs used by client JS');
  const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
  assert.deepEqual(duplicates,[], 'duplicate HTML ids break querySelector and click binding');
});

test('dynamic glass controls and offer feedback required by current app.js are mounted',()=>{
  for(const name of ['glassvalg','glassvalg-status','btn-glass-hjelp','btn-glass-back',
    'glass-sti','resultat-sporsmaal','btn-resultat-hjelp',
    'resultat-oppsummering','inquiry-oppsummering','inquiry-leveringssted',
    'inquiry-bekreftet-tekst']){
    assert.match(html,new RegExp('id="'+name+'"'),name+' missing');
  }
  assert.doesNotMatch(html,/id="btn-glass-search"/,'legacy inert search button must not remain');
  assert.match(html,/data-public-api-key=/,'approved public payment method display is retained');
  assert.match(html,/Riktig bilglass\.<br><span>En pris du forstår\./,'approved main homepage hero retained');
});
