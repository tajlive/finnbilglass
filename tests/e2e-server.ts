/**
 * FinnBilGlass — Lokal test-server for E2E-tester (Fase 5.7)
 *
 * Starter en HTTP-server som tjener Worker-håndtererne og statiske filer.
 * Brukes av Playwright-tester for ekte Chrome-navigasjon.
 *
 * Kjøres som en del av e2e-testoppsettet, ikke selvstendig.
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
// Root directory er nåværende arbeidsmappe (finnbilglass)
const rootDir = process.cwd();

// Importer Worker-håndtereren
const workerModule = await import('../src/index.ts');
const workerFetch = workerModule.default.fetch;

// ── In-memory D1-mock for E2E-tester ──
// Lagrer auth-data (sesjoner, OTP, rate limits, brukere) i minnet
// slik at både API-kall og Chrome-navigasjon ser samme data.
class MemoryD1Database {
  private tables: Map<string, Map<string, any>> = new Map();

  private table(name: string): Map<string, any> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  prepare(sql: string) {
    const lower = sql.toLowerCase().trim();

    // INSERT OR REPLACE INTO auth_users ...
    const mInsertUsers = lower.match(/insert or replace into auth_users\s*\((.*)\)\s*values\s*\(\?.*\?\)/);
    if (mInsertUsers) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_users');
            const key = args[0]; // user_id
            t.set(key, {
              user_id: args[0], email: args[1], role: args[2], name: args[3],
              created_at: args[4], updated_at: args[5],
            });
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 }, results: [] }),
        batch: async () => [],
      };
    }

    // INSERT OR REPLACE INTO auth_sessions ...
    const mInsertSessions = lower.match(/insert or replace into auth_sessions\s*\((.*)\)\s*values\s*\(\?.*\?\)/);
    if (mInsertSessions) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_sessions');
            const key = args[0]; // session_id
            t.set(key, {
              session_id: args[0], user_id: args[1], email: args[2], role: args[3],
              name: args[4], created_at: args[5], expires_at: args[6], last_activity: args[7],
            });
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 }, results: [] }),
        batch: async () => [],
      };
    }

    // INSERT OR REPLACE INTO auth_otp_codes ...
    const mInsertOtp = lower.match(/insert or replace into auth_otp_codes\s*\((.*)\)\s*values\s*\(\?.*\?\)/);
    if (mInsertOtp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_otp_codes');
            const key = args[0]; // email
            t.set(key, {
              email: args[0], code: args[1], created_at: args[2], expires_at: args[3],
              used: args[4], attempts: args[5],
            });
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 }, results: [] }),
        batch: async () => [],
      };
    }

    // INSERT OR REPLACE INTO auth_rate_limits ...
    const mInsertRl = lower.match(/insert or replace into auth_rate_limits\s*\((.*)\)\s*values\s*\(\?.*\?\)/);
    if (mInsertRl) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_rate_limits');
            const key = args[0]; // identity
            t.set(key, { identity: args[0], count: args[1], window_start: args[2] });
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 }, results: [] }),
        batch: async () => [],
      };
    }

    // SELECT ... FROM auth_users WHERE email = ?
    const mSelectUsers = lower.match(/select\s+(.+?)\s+from\s+auth_users\s+where\s+email\s*=\s*\?/);
    if (mSelectUsers) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 }, results: [] }),
          first: async () => {
            const t = this.table('auth_users');
            return t.get(args[0]) ?? null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => {
          const t = this.table('auth_users');
          return t.get(args[0]) ?? null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        batch: async () => [],
      };
    }

    // SELECT ... FROM auth_sessions WHERE session_id = ?
    const mSelectSessions = lower.match(/select\s+(.+?)\s+from\s+auth_sessions\s+where\s+session_id\s*=\s*\?/);
    if (mSelectSessions) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 }, results: [] }),
          first: async () => {
            const t = this.table('auth_sessions');
            return t.get(args[0]) ?? null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => {
          const t = this.table('auth_sessions');
          return t.get(args[0]) ?? null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        batch: async () => [],
      };
    }

    // SELECT ... FROM auth_otp_codes WHERE email = ?
    const mSelectOtp = lower.match(/select\s+(.+?)\s+from\s+auth_otp_codes\s+where\s+email\s*=\s*\?/);
    if (mSelectOtp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 }, results: [] }),
          first: async () => {
            const t = this.table('auth_otp_codes');
            return t.get(args[0]) ?? null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => {
          const t = this.table('auth_otp_codes');
          return t.get(args[0]) ?? null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        batch: async () => [],
      };
    }

    // SELECT ... FROM auth_rate_limits WHERE identity = ?
    const mSelectRl = lower.match(/select\s+(.+?)\s+from\s+auth_rate_limits\s+where\s+identity\s*=\s*\?/);
    if (mSelectRl) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 }, results: [] }),
          first: async () => {
            const t = this.table('auth_rate_limits');
            return t.get(args[0]) ?? null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => {
          const t = this.table('auth_rate_limits');
          return t.get(args[0]) ?? null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        batch: async () => [],
      };
    }

    // DELETE FROM auth_sessions WHERE session_id = ?
    const mDelSession = lower.match(/delete\s+from\s+auth_sessions\s+where\s+session_id\s*=\s*\?/);
    if (mDelSession) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_sessions');
            t.delete(args[0]);
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          const t = this.table('auth_sessions');
          t.delete(args[0]);
          return { meta: { changes: 1 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_otp_codes WHERE email = ?
    const mDelOtp = lower.match(/delete\s+from\s+auth_otp_codes\s+where\s+email\s*=\s*\?/);
    if (mDelOtp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_otp_codes');
            t.delete(args[0]);
            return { meta: { changes: 1 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          const t = this.table('auth_otp_codes');
          t.delete(args[0]);
          return { meta: { changes: 1 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_sessions WHERE expires_at <= ?
    const mDelSessionExp = lower.match(/delete\s+from\s+auth_sessions\s+where\s+expires_at\s*<=\s*\?/);
    if (mDelSessionExp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_sessions');
            const now = args[0];
            for (const [k, v] of t.entries()) {
              if (v.expires_at <= now) t.delete(k);
            }
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          const t = this.table('auth_sessions');
          const now = args[0];
          for (const [k, v] of t.entries()) {
            if (v.expires_at <= now) t.delete(k);
          }
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_otp_codes WHERE expires_at <= ? AND used = 0
    const mDelOtpExp = lower.match(/delete\s+from\s+auth_otp_codes\s+where\s+expires_at\s*<=\s*\?\s+and\s+used\s*=\s*0/);
    if (mDelOtpExp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const t = this.table('auth_otp_codes');
            const now = args[0];
            for (const [k, v] of t.entries()) {
              if (v.expires_at <= now && v.used === 0) t.delete(k);
            }
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          const t = this.table('auth_otp_codes');
          const now = args[0];
          for (const [k, v] of t.entries()) {
            if (v.expires_at <= now && v.used === 0) t.delete(k);
          }
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_sessions (clear)
    const mDelAllSessions = lower.match(/delete\s+from\s+auth_sessions\s*$/);
    if (mDelAllSessions) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.table('auth_sessions').clear();
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          this.table('auth_sessions').clear();
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_otp_codes (clear)
    const mDelAllOtp = lower.match(/delete\s+from\s+auth_otp_codes\s*$/);
    if (mDelAllOtp) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.table('auth_otp_codes').clear();
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          this.table('auth_otp_codes').clear();
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_rate_limits (clear)
    const mDelAllRl = lower.match(/delete\s+from\s+auth_rate_limits\s*$/);
    if (mDelAllRl) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.table('auth_rate_limits').clear();
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          this.table('auth_rate_limits').clear();
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // DELETE FROM auth_users (clear)
    const mDelAllUsers = lower.match(/delete\s+from\s+auth_users\s*$/);
    if (mDelAllUsers) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.table('auth_users').clear();
            return { meta: { changes: 0 }, results: [] };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          this.table('auth_users').clear();
          return { meta: { changes: 0 }, results: [] };
        },
        batch: async () => [],
      };
    }

    // SELECT ... FROM auth_sessions (getAll)
    const mSelectAllSessions = lower.match(/select\s+(.+?)\s+from\s+auth_sessions\s*$/);
    if (mSelectAllSessions) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 }, results: [] }),
          first: async () => null,
          all: async () => ({ results: Array.from(this.table('auth_sessions').values()) }),
        }),
        first: async () => null,
        all: async () => ({ results: Array.from(this.table('auth_sessions').values()) }),
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        batch: async () => [],
      };
    }

    // Fallback for any other SQL
    return {
      bind: (...args: unknown[]) => ({
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 }, results: [] }),
      batch: async () => [],
    };
  }
}

// Minimal mock Env for testing
const env = {
  ENVIRONMENT: 'test',
  FINNBILGLASS_DB: {
    prepare: () => ({
      bind: (...args) => ({
        run: async () => ({ meta: { changes: 1 }, results: [] }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      batch: async () => [],
    }),
  },
  ASSETS: {
    fetch: async (request) => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      let filePath;

      // Map routes to static files
      if (pathname === '/' || pathname === '/index.html') {
        filePath = join(rootDir, 'public', 'index.html');
      } else if (pathname === '/innlogging.html') {
        filePath = join(rootDir, 'public', 'innlogging.html');
      } else if (pathname === '/min-side.html') {
        filePath = join(rootDir, 'public', 'min-side.html');
      } else if (pathname === '/admin-innlogging.html') {
        filePath = join(rootDir, 'public', 'admin-innlogging.html');
      } else if (pathname === '/admin-dashboard.html') {
        filePath = join(rootDir, 'public', 'admin-dashboard.html');
      } else if (pathname === '/404.html') {
        filePath = join(rootDir, 'public', '404.html');
      } else if (pathname.endsWith('.css') || pathname.endsWith('.js') || pathname.endsWith('.html')) {
        filePath = join(rootDir, 'public', pathname);
      }

      if (filePath) {
        try {
          const content = readFileSync(filePath);
          const ext = filePath.split('.').pop();
          const contentType = ext === 'html' ? 'text/html' : ext === 'css' ? 'text/css' : 'application/javascript';
          return new Response(content, {
            headers: { 'Content-Type': contentType },
          });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      }
      return new Response('Not found', { status: 404 });
    },
  },
  AI: undefined,
  OPPLAERING_BUCKET: undefined,
  SUPPORT_EVIDENCE_TOKEN: undefined,
  BREVO_API_KEY: undefined,
  SVV_API_KEY: undefined,
  FINNBILGLASS_LOCAL_AUTH: new MemoryD1Database(),
};

/**
 * Start test-server på angitt port.
 */
export function startTestServer(port = 8766) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const path = url.pathname;
      const method = req.method || 'GET';

      // CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie',
          'Access-Control-Allow-Credentials': 'true',
        });
        res.end();
        return;
      }

      // Auth-ruter
      if (path.startsWith('/api/auth/')) {
        try {
          const body = await readBody(req);
          const request = new Request(`http://localhost${path}`, {
            method,
            headers: { ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'connection')), 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          });
          const response = await workerFetch(request, env);
          const contentType = response.headers.get('content-type') || 'application/json';
          const bodyText = await response.text();
          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
            ...Object.fromEntries(response.headers.entries()),
          });
          res.end(bodyText);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // Admin-ruter
      if (path.startsWith('/api/admin/')) {
        try {
          const body = await readBody(req);
          const request = new Request(`http://localhost${path}`, {
            method,
            headers: { ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'connection')), 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          });
          const response = await workerFetch(request, env);
          const contentType = response.headers.get('content-type') || 'application/json';
          const bodyText = await response.text();
          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
            ...Object.fromEntries(response.headers.entries()),
          });
          res.end(bodyText);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
      }

      // Statiske filer
      try {
        const assetResponse = await env.ASSETS.fetch(new Request(`http://localhost${path}`));
        const body = await assetResponse.text();
        res.writeHead(assetResponse.status, {
          'Content-Type': assetResponse.headers.get('content-type') || 'text/html',
          ...Object.fromEntries(assetResponse.headers.entries()),
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404</h1>');
      }
    });

    server.listen(port, () => {
      resolve({ server, port, stop: () => new Promise((r) => server.close(r)) });
    });

    server.on('error', reject);
  });
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}
