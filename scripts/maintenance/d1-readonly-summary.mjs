/** Parse Wrangler stdout without ever exposing D1 row data or Time Travel bookmark. */
import { readFileSync } from 'node:fs';

function firstJsonValue(text) {
  // Wrangler prints progress lines ahead of its --json payload in some versions.
  // Locate a standalone JSON opening and parse exactly one balanced value.
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(\[|\{)/g)) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    const stack = [];
    let quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '[' || c === '{') stack.push(c);
      else if (c === ']' || c === '}') {
        const opening = stack.pop();
        if (opening !== (c === ']' ? '[' : '{')) break;
        if (!stack.length) {
          try { return JSON.parse(text.slice(start, i + 1)); }
          catch { break; }
        }
      }
    }
  }
  throw new Error('WRANGLER_JSON_NOT_FOUND');
}

const [path, mode] = process.argv.slice(2);
if (!path || !['schema', 'timetravel'].includes(mode)) throw new Error('MODE_REQUIRED');
const json = firstJsonValue(readFileSync(path, 'utf8'));
if (mode === 'timetravel') {
  if (typeof json !== 'object' || !json) throw new Error('TIME_TRAVEL_RESPONSE_INVALID');
  console.log('Staging Time Travel API responded; no bookmark printed');
} else {
  const batches = Array.isArray(json) ? json : [json];
  if (!batches.length || !Array.isArray(batches[0]?.results)) throw new Error('SCHEMA_RESPONSE_INVALID');
  const tables = new Set(batches[0].results.filter(x => x?.type === 'table').map(x => x.name));
  const expected = ['quote_payment_orders','kustom_payment_events','kustom_money_operations',
    'kustom_reconcile_attempts','auth_users','auth_sessions'];
  console.log('D1 schema batches: ' + batches.length);
  for (const t of expected) console.log(t + ': ' + (tables.has(t) ? 'PRESENT' : 'MISSING'));
  if (!tables.has('quote_payment_orders') || !tables.has('auth_users')) {
    throw new Error('STAGING_CORE_SCHEMA_NOT_READY');
  }
}
