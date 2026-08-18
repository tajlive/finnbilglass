/**
 * C7.6 — Market Intelligence Layer-tester: ROI-sortering, finn=signal-aldri-sannhet, kjøpsanbefaling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const OUT = new URL('../scripts/out/c76-market-intelligence.json', import.meta.url);

test('C7.6-1: kjøring produserer ROI-prioritet (sortert synkende, positive verdier)', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c76-market-intelligence.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  const rep = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.ok(rep.roiPriority.length >= 10, 'for få familier i ROI-listen');
  const rois = rep.roiPriority.map((r) => r.roiScore);
  assert.deepEqual(rois, [...rois].sort((a, b) => b - a), 'ikke sortert synkende');
  for (const r of rep.roiPriority.slice(0, 5)) {
    assert.ok(r.marketAds > 0 && r.roiScore > 0);
    assert.ok(r.applikasjonsGapPct >= 0 && r.applikasjonsGapPct <= 100);
  }
});

test('C7.6-2: TecDoc-kjøpsanbefaling finnes og baseres på ROI (aldri blindt)', () => {
  const rep = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.ok(rep.tecdocBuyRecommendation.length > 0, 'ingen kjøpsanbefaling');
  for (const b of rep.tecdocBuyRecommendation) {
    assert.ok(b.roiScore >= 50, 'anbefaling uten ROI-terskel');
    assert.ok(b.why.includes('annonser') && b.why.includes('gap'));
  }
});

test('C7.6-3: prinsipp — finn.no er markedsignal, aldri sannhet (ingen EXACT-claims i data)', () => {
  const rep = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.ok(rep.meta.prinsipp.includes('aldri sannhet'), 'prinsipp mangler');
  // data-radene må ikke inneholde EXACT-claims (kun meta-teksten nevner regelen)
  for (const r of rep.roiPriority) {
    const v = JSON.stringify(r);
    assert.ok(!v.includes('EXACT'), `familie-rad lover EXACT: ${r.familie}`);
    assert.ok(!v.includes('fasit'), `familie-rad merket som fasit: ${r.familie}`);
  }
});
