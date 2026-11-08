/**
 * RAV4-normalisering — modellnavn med og uten skilletegn.
 *
 * Bakgrunn (Fase 3): `/api/frontrute` ga FALLBACK for `TOYOTA RAV4 2018` mens
 * `RAV 4` og `RAV-4` ga PINPOINT med `3202GNCE` (6 990 kr). GT-matchingen er
 * ordbasert, og «RAV4» gir ett token mens GT-raden «RAV-4» gir `RAV` + `4`.
 *
 * Testene låser begge sider: navnet skal matche uansett skilletegn, OG
 * normaliseringen skal ikke kunne slå sammen to modeller som heter noe ulikt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gtRadMatch, modellNokkel } from '../src/vin-resolver.ts';

const AAR = [2018];

test('RAV4 matcher GT-raden RAV-4 (skilletegn skal ikke avgjøre)', () => {
  for (const sok of ['RAV4', 'RAV 4', 'RAV-4', 'rav4']) {
    assert.equal(gtRadMatch('RAV-4', 'TOYOTA', sok, AAR), true, `«${sok}» skal matche GT «RAV-4»`);
  }
});

test('nøkkelen er lik uansett skilletegn, og tomme navn gir tom nøkkel', () => {
  assert.equal(modellNokkel('RAV-4'), modellNokkel('RAV4'));
  assert.equal(modellNokkel('RAV 4'), modellNokkel('rav4'));
  assert.equal(modellNokkel('3-SERIE'), modellNokkel('3 SERIE'));
  assert.equal(modellNokkel(''), '');
});

test('normaliseringen slår ikke sammen modeller som faktisk heter noe ulikt', () => {
  // Ulike biler: samme merke, forskjellig navn — skal IKKE matche.
  const ulike = [
    ['RAV-4', 'RAV4 PHV'],
    ['RAV-4', 'RAV4 PLUG-IN'],
    ['MODEL 3', 'MODEL Y'],
    ['GOLF', 'GOLF SPORTSVAN'],
    ['PASSAT', 'PASSAT CC'],
    ['3 SERIE', '5 SERIE'],
  ];
  for (const [gtRad, sok] of ulike) {
    assert.equal(gtRadMatch(gtRad, 'TOYOTA', sok, AAR), false, `«${sok}» skal ikke matche GT «${gtRad}»`);
  }
});

test('andre skilletegns-varianter virker også (BMW/Mercedes/Tesla-formater)', () => {
  assert.equal(gtRadMatch('3 SERIE', 'BMW', '3-SERIE', [2014]), true);
  assert.equal(gtRadMatch('C-CLASSE', 'MERCEDES', 'C CLASSE', [2012]), true);
  assert.equal(gtRadMatch('MODEL 3', 'TESLA', 'MODEL3', [2022]), true);
});

test('eksakt navn og ord-treff er uendret (ingen regresjon på det som virket)', () => {
  assert.equal(gtRadMatch('TRANSPORTER', 'VW', 'TRANSPORTER', [2005]), true);
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'COROLLA', AAR), false);
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV4', [] /* uten år */), true, 'navnematch er uavhengig av år');
});
