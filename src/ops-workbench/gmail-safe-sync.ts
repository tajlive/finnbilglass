/** Gmail read-only import. Never sends mail or advances a cursor on incomplete work. */
import { gmailApiFetch } from './gmail-sync';

export interface GmailSafeMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }>; mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  internalDate?: string;
}
interface GmailProfile { emailAddress: string; historyId: string; }
interface GmailHistoryPage {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
}
interface GmailListPage { nextPageToken?: string; messages?: Array<{ id?: string }> }
export interface GmailBatch {
  messages: GmailSafeMessage[];
  historyId: string;
  mailboxAddress: string;
  mode: 'incremental' | 'full';
}
type Requester = (token: string, path: string) => Promise<Response>;
const MAX_PAGES = 25;
const MAX_MESSAGES = 500;

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('GMAIL_INVALID_' + field);
  return value;
}
async function getJson<T>(request: Requester, token: string, path: string): Promise<T> {
  const response = await request(token, path);
  if (!response.ok) throw new Error('GMAIL_HTTP_' + response.status);
  return await response.json() as T;
}
function pushId(ids: Set<string>, id: unknown) {
  if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)) ids.add(id);
  if (ids.size > MAX_MESSAGES) throw new Error('GMAIL_BATCH_LIMIT; cursor unchanged');
}
async function allPages(
  request: Requester, token: string, basePath: string,
  collect: (data: GmailListPage & GmailHistoryPage, ids: Set<string>) => void,
  ids: Set<string>,
): Promise<string | null> {
  let tokenPage: string | undefined;
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let n = 0; n < MAX_PAGES; n++) {
    const path = basePath + (tokenPage ? '&pageToken=' + encodeURIComponent(tokenPage) : '');
    const data = await getJson<GmailListPage & GmailHistoryPage>(request, token, path);
    collect(data, ids);
    if (data.historyId) cursor = requiredId(data.historyId, 'HISTORY');
    if (!data.nextPageToken) return cursor;
    if (seen.has(data.nextPageToken)) throw new Error('GMAIL_REPEATED_PAGE');
    seen.add(data.nextPageToken);
    tokenPage = data.nextPageToken;
  }
  throw new Error('GMAIL_PAGE_LIMIT; cursor unchanged');
}

/** Read every page; a missing message or API error rejects the entire batch. */
export async function loadGmailBatch(
  accessToken: string, startHistoryId: string | null,
  request: Requester = gmailApiFetch,
): Promise<GmailBatch> {
  const profile = await getJson<GmailProfile>(request, accessToken, '/users/me/profile');
  const mailboxAddress = String(profile.emailAddress || '').trim().toLowerCase();
  const profileHistoryId = requiredId(profile.historyId, 'PROFILE_HISTORY');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailboxAddress)) throw new Error('GMAIL_MAILBOX_UNKNOWN');
  const ids = new Set<string>();
  let mode: GmailBatch['mode'] = 'full';
  let cursor = profileHistoryId;
  if (startHistoryId) {
    const probe = await request(accessToken, '/users/me/history?startHistoryId=' + encodeURIComponent(requiredId(startHistoryId, 'CURSOR')) + '&historyTypes=messageAdded&maxResults=500');
    if (probe.status !== 404) {
      if (!probe.ok) throw new Error('GMAIL_HTTP_' + probe.status);
      // First page is processed exactly once, including its nextPageToken.
      const first = await probe.json() as GmailHistoryPage;
      mode = 'incremental';
      const collect = (d: GmailHistoryPage) => {
        for (const h of d.history || []) for (const row of h.messagesAdded || []) pushId(ids, row.message?.id);
        if (d.historyId) cursor = requiredId(d.historyId, 'HISTORY');
      };
      collect(first);
      let page = first.nextPageToken;
      const seen = new Set<string>();
      let count = 1;
      while (page) {
        if (count++ >= MAX_PAGES || seen.has(page)) throw new Error('GMAIL_PAGE_LIMIT; cursor unchanged');
        seen.add(page);
        const data = await getJson<GmailHistoryPage>(request, accessToken,
          '/users/me/history?startHistoryId=' + encodeURIComponent(startHistoryId)
          + '&historyTypes=messageAdded&maxResults=500&pageToken=' + encodeURIComponent(page));
        collect(data);
        page = data.nextPageToken;
      }
    }
  }
  if (mode === 'full') {
    // Capture a starting cursor BEFORE fetching pages, so concurrent updates are replayed next run.
    cursor = profileHistoryId;
    for (const label of ['INBOX', 'SENT']) {
      await allPages(
        request, accessToken, '/users/me/messages?labelIds=' + label + '&maxResults=500',
        (d, target) => { for (const item of d.messages || []) pushId(target, item.id); },
        ids,
      );
    }
  }
  const messages: GmailSafeMessage[] = [];
  for (const id of ids) {
    const message = await getJson<GmailSafeMessage>(request, accessToken,
      '/users/me/messages/' + encodeURIComponent(id) + '?format=full');
    if (message.id !== id) throw new Error('GMAIL_MESSAGE_ID_MISMATCH');
    if (message.labelIds?.includes('SENT') || message.labelIds?.includes('INBOX')) messages.push(message);
  }
  return { messages, historyId: cursor, mailboxAddress, mode };
}

/** Exact single address only: multi-recipient mail is queued for human review. */
export function singleAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidates = value.match(/[A-Z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const unique = [...new Set(candidates.map(e => e.toLowerCase()))];
  return unique.length === 1 ? unique[0] : null;
}
export function caseIdFromSubject(subject: string): number | null {
  const matches = [...subject.matchAll(/\[FBG-(\d+)\]|\bsak\s*#?\s*(\d+)\b/gi)];
  const unique = [...new Set(matches.map(m => Number(m[1] || m[2])))];
  return unique.length === 1 && Number.isSafeInteger(unique[0]) && unique[0] > 0 ? unique[0] : null;
}
export function gmailHeaders(message: GmailSafeMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of message.payload?.headers || []) {
    if (header.name && typeof header.value === 'string') out[header.name.toLowerCase()] = header.value.slice(0, 4000);
  }
  return out;
}
/** Email equality is mandatory even when subject and in-reply-to identify a case. */
export function confirmedCaseId(
  proposedId: number | null, customerAddress: string | null,
  caseRow: { id: number; kontakt: string } | null,
): number | null {
  return proposedId !== null && caseRow?.id === proposedId &&
    customerAddress !== null && singleAddress(caseRow.kontakt) === customerAddress ? proposedId : null;
}
/** Persist every item before committing the cursor, with no partial-success acknowledgement. */
export async function consumeGmailBatch(
  batch: GmailBatch,
  persist: (message: GmailSafeMessage, mailboxAddress: string) => Promise<void>,
  commit: (historyId: string) => Promise<void>,
): Promise<number> {
  for (const message of batch.messages) await persist(message, batch.mailboxAddress);
  await commit(batch.historyId);
  return batch.messages.length;
}
