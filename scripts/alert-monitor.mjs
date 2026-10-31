#!/usr/bin/env node
/**
 * alert-monitor.mjs — P0 sanntidsvarsling (Spor G).
 *
 * Sjekker produksjon for: Worker 5xx (/health + resolver), invitasjonsstatus
 * (avslag/forbruk) og henvendelser uten kunde-kobling (idempotens/tilgangsavvik).
 * Skrivebeskyttet — sender aldri PII, invitasjonskoder, innloggingslenker
 * eller session-tokens i varslene (kun aggregerte tall/status).
 *
 * Exit 0 = alt grønt, 1 = funn. Kjøres fra cron; varselkanal = cron-leveranse
 * + ev. webhook via ALERT_WEBHOOK_URL.
 *
 * Bruk: node scripts/alert-monitor.mjs [--base https://finnbilglass.no]
 */
import { execSync } from 'node:child_process';

const BASE = process.env.FBG_BASE || 'https://finnbilglass.no';
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || '';

async function main() {
  const funn = [];

  // 1. /health (5xx = Worker-feil)
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.status >= 500) funn.push(`/health ${r.status}`);
  } catch (e) {
    funn.push(`/health utilgjengelig: ${e.message}`);
  }

  // 2. Resolver-røyk (PINPOINT-ruten skal ikke 5xx på gyldig input)
  try {
    const r = await fetch(`${BASE}/api/regnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: 'SU18018' }),
    });
    if (r.status >= 500) funn.push(`/api/regnr 5xx: ${r.status}`);
  } catch (e) {
    funn.push(`/api/regnr utilgjengelig: ${e.message}`);
  }

  // 3. D1-anomalier (skrivebeskyttet via wrangler)
  try {
    const d1 = (cmd) => {
      const out = execSync(`npx wrangler d1 execute finnbilglass-db --remote --command "${cmd}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return JSON.parse(out);
    };
    const inv = d1("SELECT status, COUNT(*) AS n FROM pilot_invitations GROUP BY status");
    const rader = inv?.[0]?.results ?? [];
    const statuser = Object.fromEntries(rader.map((r) => [r.status, r.n]));
    if ((statuser.unused ?? 0) + (statuser.used ?? 0) + (statuser.revoked ?? 0) > 20) {
      funn.push(`Invitasjoner over 20 totalt (${statuser.unused ?? 0} ubrukt)`);
    }
    const orphans = d1("SELECT COUNT(*) AS n FROM beta_inquiries WHERE customer_id IS NULL AND created_at > " + (Date.now() - 3600e3));
    const n = orphans?.[0]?.results?.[0]?.n ?? 0;
    if (n > 0) funn.push(`${n} henvendelser uten kunde-kobling siste time`);
  } catch (e) {
    funn.push(`D1-sjekk feilet: ${e.message}`);
  }

  console.log('Alert-monitor —', new Date().toISOString());
  if (!funn.length) {
    console.log('ALT GRØNT');
  } else {
    funn.forEach((f) => console.log(`[FUNN] ${f}`));
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'FinnBilglass-alarm:\n' + funn.join('\n') }) });
      } catch { /* webhook best-effort */ }
    }
  }
  process.exit(funn.length ? 1 : 0);
}

main();
