import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, legacyStatus, validReviewReason } from '../src/support-evidence-workflow.js';

test('manual support workflow permits only approved forward transitions', () => {
  assert.equal(canTransition('NEW', 'UNDER_REVIEW'), true);
  assert.equal(canTransition('UNDER_REVIEW', 'CONFIRMED'), true);
  assert.equal(canTransition('CONFIRMED', 'UNDER_REVIEW'), false);
  assert.equal(canTransition('REJECTED', 'UNDER_REVIEW'), false);
});

test('review reason is concise and limited to three sentences', () => {
  assert.equal(validReviewReason('Bildet av speilområdet er uklart. Be kunden sende nytt bilde.'), true);
  assert.equal(validReviewReason('En. To. Tre. Fire.'), false);
});

test('legacy statuses are displayed without mutating older cases', () => {
  assert.equal(legacyStatus('REVIEWING'), 'UNDER_REVIEW');
  assert.equal(legacyStatus('NEEDS_MORE_DATA'), 'NEEDS_CUSTOMER_INFO');
});
