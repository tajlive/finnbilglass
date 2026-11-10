import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGmailBatch, consumeGmailBatch, caseIdFromSubject,
  confirmedCaseId, singleAddress,
} from '../src/ops-workbench/gmail-safe-sync.ts';

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
const msg = (id, labelIds = ['SENT']) => ({ id, labelIds, payload: { headers: [] } });

test('History: exhausts every page, fetches each message once, advances to last historyId', async () => {
  const paths = [];
  const request = async (_token, path) => {
    paths.push(path);
    if (path === '/users/me/profile') return reply({ emailAddress: 'support@finnbilglass.no', historyId: '104' });
    if (path.includes('history?') && !path.includes('pageToken=')) return reply({
      historyId: '102', nextPageToken: 'next',
      history: [{ messagesAdded: [{ message: { id: 'msg1' } }, { message: { id: 'msg2' } }] }],
    });
    if (path.includes('pageToken=next')) return reply({
      historyId: '103', history: [{ messagesAdded: [{ message: { id: 'msg2' } }, { message: { id: 'msg3' } }] }],
    });
    if (path.includes('/msg1?')) return reply(msg('msg1', ['INBOX']));
    if (path.includes('/msg2?')) return reply(msg('msg2'));
    if (path.includes('/msg3?')) return reply(msg('msg3'));
    throw new Error('Unexpected API path ' + path);
  };
  const batch = await loadGmailBatch('synthetic', '100', request);
  assert.deepEqual(batch.messages.map(m => m.id), ['msg1', 'msg2', 'msg3']);
  assert.equal(batch.historyId, '103');
  assert.equal(batch.mode, 'incremental');
  assert.equal(paths.filter(p => p.includes('/msg2?')).length, 1);
  assert.equal(paths.filter(p => p.includes('history?')).length, 2);
});

test('Stale cursor: full resync follows every INBOX and SENT page and retains initial profile cursor', async () => {
  const request = async (_token, path) => {
    if (path === '/users/me/profile') return reply({ emailAddress: 'support@finnbilglass.no', historyId: '900' });
    if (path.includes('/history?')) return reply({ error: 'expired' }, 404);
    if (path === '/users/me/messages?labelIds=INBOX&maxResults=500') return reply({ messages: [{ id: 'msg1' }], nextPageToken: 'page2' });
    if (path.includes('labelIds=INBOX') && path.includes('pageToken=page2')) return reply({ messages: [{ id: 'msg2' }] });
    if (path.includes('labelIds=SENT')) return reply({ messages: [{ id: 'msg2' }, { id: 'msg3' }] });
    if (path.includes('/msg1?')) return reply(msg('msg1', ['INBOX']));
    if (path.includes('/msg2?')) return reply(msg('msg2', ['SENT']));
    if (path.includes('/msg3?')) return reply(msg('msg3', ['SENT']));
    throw new Error('Unexpected API path ' + path);
  };
  const batch = await loadGmailBatch('synthetic', '100', request);
  assert.equal(batch.mode, 'full');
  assert.equal(batch.historyId, '900');
  assert.deepEqual(batch.messages.map(x => x.id), ['msg1', 'msg2', 'msg3']);
});

test('Failure injection: cursor remains unchanged when a page or message fetch fails', async () => {
  const profile = () => reply({ emailAddress: 'support@finnbilglass.no', historyId: '800' });
  const missingPage = async (_t, path) => {
    if (path === '/users/me/profile') return profile();
    if (path.includes('/history?') && !path.includes('pageToken=')) return reply({ historyId: '801', nextPageToken: 'x', history: [] });
    if (path.includes('pageToken=x')) return reply({ error: 'broken' }, 500);
    throw new Error(path);
  };
  await assert.rejects(() => loadGmailBatch('synthetic', '700', missingPage), /GMAIL_HTTP_500/);
  const missingMessage = async (_t, path) => {
    if (path === '/users/me/profile') return profile();
    if (path.includes('/history?')) return reply({ historyId: '801', history: [{ messagesAdded: [{ message: { id: 'msg1' } }] }] });
    return reply({ error: 'not found' }, 404);
  };
  await assert.rejects(() => loadGmailBatch('synthetic', '700', missingMessage), /GMAIL_HTTP_404/);
});

test('Durability: persistence failure prevents checkpoint even after earlier items succeeded', async () => {
  const batch = { messages: [msg('a'), msg('b')], historyId: '202', mailboxAddress: 'support@finnbilglass.no', mode: 'incremental' };
  const saved = [];
  let committed = false;
  await assert.rejects(
    consumeGmailBatch(batch, async item => {
      saved.push(item.id);
      if (item.id === 'b') throw new Error('disk failed');
    }, async () => { committed = true; }),
    /disk failed/,
  );
  assert.deepEqual(saved, ['a', 'b']);
  assert.equal(committed, false);
  let cursor = '200';
  await consumeGmailBatch(batch, async () => {}, async c => { cursor = c; });
  assert.equal(cursor, '202');
});

test('Case matching: subject alone never authorizes a cross-customer case', () => {
  assert.equal(caseIdFromSubject('[FBG-31] Hei'), 31);
  assert.equal(caseIdFromSubject('Sak #31 og [FBG-32]'), null);
  assert.equal(caseIdFromSubject('Ingen referanse'), null);
  const row = { id: 31, kontakt: '92867502 · kunde@example.com' };
  assert.equal(confirmedCaseId(31, 'kunde@example.com', row), 31);
  assert.equal(confirmedCaseId(31, 'annen@example.com', row), null);
  assert.equal(confirmedCaseId(32, 'kunde@example.com', row), null);
  assert.equal(singleAddress('Alice <kunde@example.com>, Bob <annen@example.com>'), null);
  assert.equal(singleAddress('92867502 · KUNDE@example.com'), 'kunde@example.com');
});
