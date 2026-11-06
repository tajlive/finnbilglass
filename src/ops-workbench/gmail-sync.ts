import type { Env } from '../types';

interface GmailTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    mimeType?: string;
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string; size: number };
    parts?: Array<{ mimeType: string; body: { data?: string; size: number }; parts?: Array<any> }>;
  };
  internalDate: string;
}

interface GmailHistoryResponse {
  history: Array<{
    id: string;
    messages?: Array<{ id: string; threadId: string; labelIds: string[] }>;
    messagesAdded?: Array<{ message: GmailMessage }>;
    labelsAdded?: Array<{ message: GmailMessage; labelIds: string[] }>;
  }>;
  historyId: string;
}

interface GmailPushConfig {
  labelIds: string[];
  topicName: string;
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
].join(' ');

export async function getGmailTokens(env: Env): Promise<{ access_token: string; refresh_token: string } | null> {
  // Tokens stored in D1 or KV - for now read from environment
  const refreshToken = env.GMAIL_REFRESH_TOKEN;
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    console.error('Gmail token refresh failed:', await response.text());
    return null;
  }

  const data = await response.json() as GmailTokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: refreshToken,
  };
}

export async function gmailApiFetch(accessToken: string, path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export async function fetchGmailMessage(accessToken: string, messageId: string): Promise<GmailMessage | null> {
  const response = await gmailApiFetch(accessToken, `/users/me/messages/${messageId}?format=full`);
  if (!response.ok) return null;
  return response.json() as Promise<GmailMessage>;
}

export async function fetchGmailHistory(accessToken: string, startHistoryId: string): Promise<GmailHistoryResponse | null> {
  const response = await gmailApiFetch(accessToken, `/users/me/history?startHistoryId=${startHistoryId}&labelId=INBOX&labelId=SENT`);
  if (!response.ok) {
    if (response.status === 404) {
      // History expired - signal caller to do full sync
      return { history: [], historyId: '', expired: true } as any;
    }
    return null;
  }
  return response.json() as Promise<GmailHistoryResponse>;
}

export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string } | null> {
  const response = await gmailApiFetch(accessToken, '/users/me/profile');
  if (!response.ok) return null;
  return response.json() as Promise<{ emailAddress: string; historyId: string }>;
}

export function extractEmailHeaders(message: GmailMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of message.payload.headers) {
    headers[h.name.toLowerCase()] = h.value;
  }
  return headers;
}

export function extractEmailBody(message: GmailMessage): { text: string; html: string } {
  let text = '';
  let html = '';

  const decodePart = (part: { mimeType?: string; body: { data?: string }; parts?: Array<any> }): void => {
    if (!part.body.data) return;
    const decoded = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    if (part.mimeType === 'text/plain') text = decoded;
    else if (part.mimeType === 'text/html') html = decoded;
  };

  if (message.payload.body?.data) {
    const decoded = atob(message.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    if (message.payload.mimeType === 'text/plain') text = decoded;
    else if (message.payload.mimeType === 'text/html') html = decoded;
  }

  if (message.payload.parts) {
    for (const part of message.payload.parts) {
      decodePart(part);
      if (part.mimeType?.startsWith('multipart/') && 'parts' in part && Array.isArray(part.parts)) {
        for (const subPart of part.parts) decodePart(subPart);
      }
    }
  }

  return { text, html };
}

export function parseGmailAddress(header: string): { name: string; email: string } | null {
  const match = header.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].toLowerCase().trim() };
  const emailMatch = header.match(/<?([^<>@\s]+@[^<>@\s]+)>?/);
  if (emailMatch) return { name: '', email: emailMatch[1].toLowerCase().trim() };
  return null;
}

export function extractCaseIdFromSubject(subject: string): number | null {
  const matches = subject.match(/\[FBG-(\d+)\]|sak\s*#?\s*(\d+)/gi);
  if (!matches) return null;
  const ids = [...new Set(matches.map(m => Number(m.match(/\d+/)![0])))];
  return ids.length === 1 ? ids[0] : null;
}

export async function startGmailPushWatch(env: Env, accessToken: string, topicName: string): Promise<{ expiration: string } | null> {
  const config: GmailPushConfig = {
    labelIds: ['INBOX', 'SENT'],
    topicName,
  };
  const response = await gmailApiFetch(accessToken, '/users/me/watch', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ expiration: string }>;
}

export async function syncGmailSentFolder(env: Env, accessToken: string, startHistoryId?: string): Promise<{ messages: GmailMessage[]; newHistoryId: string } | null> {
  // Use history API for incremental sync
  if (startHistoryId) {
    const history = await fetchGmailHistory(accessToken, startHistoryId);
    if (!history) return null;

    // History expired - fall back to full sync
    if ((history as any).expired) {
      return syncGmailSentFolder(env, accessToken, undefined);
    }

    const messages: GmailMessage[] = [];
    for (const h of history.history) {
      if (h.messagesAdded) {
        for (const added of h.messagesAdded) {
          if (added.message.labelIds.includes('SENT')) {
            const full = await fetchGmailMessage(accessToken, added.message.id);
            if (full) messages.push(full);
          }
        }
      }
    }
    return { messages, newHistoryId: history.historyId };
  }

  // Initial full sync - fetch recent SENT messages
  const response = await gmailApiFetch(accessToken, '/users/me/messages?labelIds=SENT&maxResults=50');
  if (!response.ok) return null;
  const data = await response.json() as { messages: Array<{ id: string; threadId: string }>; resultSizeEstimate: number };

  const messages: GmailMessage[] = [];
  for (const m of data.messages || []) {
    const full = await fetchGmailMessage(accessToken, m.id);
    if (full) messages.push(full);
  }

  const profile = await getGmailProfile(accessToken);
  return { messages, newHistoryId: profile?.historyId || '' };
}

export async function syncGmailInbox(env: Env, accessToken: string, startHistoryId?: string): Promise<{ messages: GmailMessage[]; newHistoryId: string } | null> {
  if (startHistoryId) {
    const history = await fetchGmailHistory(accessToken, startHistoryId);
    if (!history) return null;

    // History expired - fall back to full sync
    if ((history as any).expired) {
      return syncGmailInbox(env, accessToken, undefined);
    }

    const messages: GmailMessage[] = [];
    for (const h of history.history) {
      if (h.messagesAdded) {
        for (const added of h.messagesAdded) {
          if (added.message.labelIds.includes('INBOX')) {
            const full = await fetchGmailMessage(accessToken, added.message.id);
            if (full) messages.push(full);
          }
        }
      }
    }
    return { messages, newHistoryId: history.historyId };
  }

  const response = await gmailApiFetch(accessToken, '/users/me/messages?labelIds=INBOX&maxResults=50');
  if (!response.ok) return null;
  const data = await response.json() as { messages: Array<{ id: string; threadId: string }>; resultSizeEstimate: number };

  const messages: GmailMessage[] = [];
  for (const m of data.messages || []) {
    const full = await fetchGmailMessage(accessToken, m.id);
    if (full) messages.push(full);
  }

  const profile = await getGmailProfile(accessToken);
  return { messages, newHistoryId: profile?.historyId || '' };
}
