#!/usr/bin/env node
// Sette opp CF-zone finnbilglass.no: importer Domeneshop-poster + custom domains.
// Kilde for poster: dig mot Domeneshop NS (2026-08-13) — full sone, inkl. MX (som
// manglet i Toms paste av Domeneshop-panelet).
// Sikkerhet: token leses fra klarpakke/.env.local, aldri printet.
import fs from 'node:fs';

const ACCOUNT = '80d5b1d56a3e907150ba7348b6182894';
const ZONE_NAME = 'finnbilglass.no';

function readEnvLocal(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const env = readEnvLocal('/Users/taj/klarpakke/.env.local');
const TOKEN = env.CLOUDFLARE_API_TOKEN;

async function cf(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`CF API-feil (${method} ${path}): ${JSON.stringify(json.errors).slice(0, 400)}`);
  }
  return json.result;
}

// 1. Zone-ID
const zones = await cf(`/zones?name=${ZONE_NAME}`);
const zone = zones.find((z) => z.name === ZONE_NAME);
if (!zone) throw new Error(`Zone ${ZONE_NAME} ikke funnet`);
console.log(`Zone: ${zone.name} (${zone.id}, status ${zone.status})`);

// 2. DNS-poster (Domeneshop → CF). Apex-A (parkering) og www-A SKIPPES —
//    apex/www skal gå til Worker/Pages. Mail + autoglass + service-poster beholdes.
const poster = [
  { type: 'MX', name: ZONE_NAME, priority: 10, content: 'mx.domeneshop.no' },
  { type: 'TXT', name: ZONE_NAME, content: 'v=spf1 include:_spf.domeneshop.no ~all' },
  { type: 'CNAME', name: 'autoconfig', content: 'autoconfig.domeneshop.no' },
  { type: 'CNAME', name: 'autoglass', content: 'autoglass-frontend.pages.dev' },
  { type: 'SRV', name: '_autodiscover._tcp', data: { priority: 0, weight: 0, port: 443, target: 'autoconfig.domeneshop.no' } },
  { type: 'SRV', name: '_caldavs._tcp', data: { priority: 0, weight: 0, port: 443, target: 'caldav.domeneshop.no' } },
  { type: 'TXT', name: '_caldavs._tcp', content: 'path=/' },
  { type: 'SRV', name: '_carddavs._tcp', data: { priority: 0, weight: 0, port: 443, target: 'carddav.domeneshop.no' } },
  { type: 'TXT', name: '_carddavs._tcp', content: 'path=/' },
  { type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@domeneshop.no' },
];

for (const p of poster) {
  try {
    const r = await cf(`/zones/${zone.id}/dns_records`, 'POST', { ...p, proxied: false });
    console.log(`  ✓ ${p.type.padEnd(5)} ${p.name.padEnd(22)} → ${JSON.stringify(p.data ?? p.content).slice(0, 60)} (${r.id.slice(0, 8)})`);
  } catch (e) {
    if (String(e).includes('81057')) console.log(`  ~ ${p.type} ${p.name}: finnes allerede`);
    else console.log(`  ✗ ${p.type} ${p.name}: ${e}`);
  }
}

// 3. Worker custom domains: apex + www + api → finnbilglass-frontrute
for (const hostname of [ZONE_NAME, `www.${ZONE_NAME}`, `api.${ZONE_NAME}`]) {
  try {
    await cf(`/accounts/${ACCOUNT}/workers/domains`, 'POST', {
      zone_id: zone.id,
      hostname,
      service: 'finnbilglass-frontrute',
      environment: 'production',
    });
    console.log(`  ✓ custom domain ${hostname} → finnbilglass-frontrute`);
  } catch (e) {
    console.log(`  ~ ${hostname}: ${String(e).slice(0, 120)}`);
  }
}
