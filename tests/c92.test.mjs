/**
 * C9.2 — Conversation Intelligence Integration-tester.
 * AI-agenten stiller spørsmål i Question Value-rekkefølge (eliminering × kostnad × svarbarhet),
 * OE-ID øverst når kandidater har OE (Evidence Priority 1), aldri «velg mellom 15 frontruter».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FitmentSession } from '../src/conversation-v1/session.js';
import * as T from '../src/conversation-v1/tools.js';

function makeSession(overrides = {}) {
  const s = new FitmentSession('test-' + Math.random().toString(36).slice(2), { channel: 'WEB_CHAT' });
  Object.assign(s, overrides);
  return s;
}

test('C9.2-1: spørsmålet med høyest Question Value stilles FØRST (kamera > coated ved lik eliminering)', () => {
  const s = makeSession({
    candidateSet: [
      { varenr: 'a', eurokode: 'a', features: ['coated', 'camera'] },
      { varenr: 'b', eurokode: 'b', features: ['coated', 'camera'] },
      { varenr: 'c', eurokode: 'c', features: [] },
      { varenr: 'd', eurokode: 'd', features: [] },
    ],
  });
  const q = T.getNextQuestion(s);
  assert.ok(q, 'spørsmål må stilles');
  // kamera: 2×1.0×0.95 = 1.9 > coated: 2×0.6×0.4 = 0.48
  assert.equal(q.questionId, 'fitment-camera');
  assert.match(q.customerFriendlyMeaning, /kamera/);
});

test('C9.2-2: OE-ID stilles FØRST når kandidater har OE (Evidence Priority 1)', () => {
  const s = makeSession({
    candidateSet: [
      { varenr: 'x1', eurokode: 'x1', features: ['rainSensor'], glavista: { oes: ['7H0845101H'], features: [] } },
      { varenr: 'x2', eurokode: 'x2', features: [], glavista: { oes: ['7H0845101F'], features: [] } },
    ],
  });
  const q = T.getNextQuestion(s);
  assert.ok(q, 'spørsmål må stilles');
  assert.equal(q.questionId, 'fitment-OE');
  assert.match(q.customerFriendlyMeaning, /OE-nummer/);
});

test('C9.2-3: OE-ID stilles SIST når ingen kandidat har OE (foto/merking som siste utvei)', () => {
  const s = makeSession({
    candidateSet: [
      { varenr: 'y1', eurokode: 'y1', features: ['rainSensor'] },
      { varenr: 'y2', eurokode: 'y2', features: [] },
    ],
  });
  const q = T.getNextQuestion(s);
  assert.ok(q, 'spørsmål må stilles');
  assert.equal(q.questionId, 'fitment-rainSensor');
});

test('C9.2-4: samtale gir «trenger bare én opplysning»-flyt for flerkandidatgrupper (aldri velg-mellom-liste)', () => {
  const s = makeSession({
    candidateSet: [
      { varenr: 'z1', eurokode: 'z1', features: ['camera', 'antenna'] },
      { varenr: 'z2', eurokode: 'z2', features: ['camera'] },
      { varenr: 'z3', eurokode: 'z3', features: [] },
    ],
  });
  const q = T.getNextQuestion(s);
  assert.ok(q);
  assert.equal(q.questionId, 'fitment-camera'); // camera skiller 2, antenna skiller 1
  assert.equal(s.lastQuestion, q);
  // Kun ÉTT spørsmål returneres om gangen — aldri «velg mellom N alternativer»
  assert.ok(!('alternatives' in q));
});
