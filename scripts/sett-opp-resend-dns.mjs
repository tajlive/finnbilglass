// Setter opp Resend-domenet for finnbilglass.no: DNS-poster + verifisering.
//
// Kjøres:  CLOUDFLARE_DNS_TOKEN=<token med Zone:DNS:Edit> RESEND_API_KEY=<nøkkel> \
//          node scripts/sett-opp-resend-dns.mjs
//
// Begge nøklene kan også ligge i BWS (CLOUDFLARE_DNS_TOKEN / RESEND_API_KEY);
// scriptet leser BWS først og faller tilbake til miljøvariabler.
//
// Idempotent: poster som finnes hoppes over. Rører aldri eksisterende SPF/MX på
// rotdomenet — alle fire postene er additive (dkim, send-subdomene, rsend-CNAME).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SONE = 'finnbilglass.no';

const POSTER = [
  { type: 'TXT', name: `resend._domainkey.${SONE}`, content: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCnRxKHq8mNyJbFia1Od2TS8hCvM5ySULv3a8fA4hIOBt4xewXe1XL0c9gj3jykGkw8B8ZVnY0flR0Ku5tmHti2IJbycFumjY8cqTw8JfEH27VTEV9sMBUodfO3mGnt/SjbLirnXXWRojSr4qBWVH0Y4MpPs4ry/sQiSwxUrXTA5QIDAQAB', ttl: 1 },
  { type: 'MX', name: `send.${SONE}`, content: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10, ttl: 1 },
  { type: 'TXT', name: `send.${SONE}`, content: 'v=spf1 include:amazonses.com ~all', ttl: 1 },
  { type: 'CNAME', name: `rsend.${SONE}`, content: 'send.forge.rmta.net', proxied: false, ttl: 1 },
];

function bwsVerdi(nokkel) {
  try {
    const liste = JSON.parse(execFileSync('bws', ['secret', 'list'], { encoding: 'utf8', maxBuffer: 8e6 }));
    const arr = Array.isArray(liste) ? liste : (liste.secrets || liste.data || []);
    const treff = arr.find((s) => s.key === nokkel);
    if (!treff) return '';
    const rå = execFileSync('bws', ['secret', 'get', treff.id], { encoding: 'utf8', maxBuffer: 8e6 });
    return JSON.parse(rå).value || '';
  } catch {
    return '';
  }
}

const cfToken = process.env.CLOUDFLARE_DNS_TOKEN || bwsVerdi('CLOUDFLARE_DNS_TOKEN');
const resendKey = process.env.RESEND_API_KEY || bwsVerdi('RESEND_API_KEY');
if (!cfToken) { console.log('MANGER: CLOUDFLARE_DNS_TOKEN (Zone:DNS:Edit)'); process.exit(1); }

const hdrFil = join(mkdtempSync(join(tmpdir(), 'cfh-')), 'h.txt');
function medHoder(nokkel, args) {
  writeFileSync(hdrFil, nokkel + '\n', { mode: 0o600 });
  const ut = execFileSync('curl', ['-sS', '--max-time', '45', '-H', '@' + hdrFil, ...args], { encoding: 'utf8', maxBuffer: 8e6 });
  return JSON.parse(ut);
}
const cf = (path, metode = 'GET', body) => medHoder(
  'Authorization: Bearer ' + cfToken,
  ['-X', metode, 'https://api.cloudflare.com/client/v4' + path, ...(body ? ['-H', 'content-type: application/json', '-d', JSON.stringify(body)] : [])],
);

try {
  const soner = cf(`/zones?name=${SONE}`);
  const sone = (soner.result || [])[0];
  if (!sone) throw new Error('fant ikke sone ' + SONE);
  console.log('sone:', sone.id, SONE);

  const finnes = new Set((cf(`/zones/${sone.id}/dns_records?per_page=200`).result || [])
    .map((r) => r.name.toLowerCase() + ':' + r.type));

  for (const p of POSTER) {
    const nokkel = p.name.toLowerCase() + ':' + p.type;
    if (finnes.has(nokkel)) { console.log('finnes  ', p.type, p.name); continue; }
    const svar = cf(`/zones/${sone.id}/dns_records`, 'POST', p);
    console.log(svar.success ? 'opprettet' : 'FEIL     ', p.type, p.name,
      svar.success ? svar.result.id : JSON.stringify(svar.errors));
  }

  if (!resendKey) { console.log('\nHopper over Resend-verifisering: RESEND_API_KEY mangler.'); process.exit(0); }

  const resend = (path, metode = 'GET') => medHoder(
    'Authorization: Bearer ' + resendKey,
    ['-X', metode, 'https://api.resend.com' + path, ...(metode === 'POST' ? ['-H', 'content-type: application/json', '-d', '{}'] : [])],
  );

  // Finn domene-id hos Resend (ikke hardkodet — id-er kan endres ved ny oppsett).
  const domener = resend('/domains');
  const domene = (domener.data || []).find((d) => d.name === SONE);
  if (!domene) throw new Error('finnbilglass.no er ikke lagt til i Resend');
  console.log('resend-domene:', domene.id, '| status:', domene.status);

  console.log('\nber om verifisering hos Resend …');
  const start = resend('/domains/' + domene.id + '/verify', 'POST');
  console.log('verify-svar:', JSON.stringify(start).slice(0, 160));

  for (let i = 0; i < 40; i++) {
    execFileSync('sleep', ['15']);
    const d = resend('/domains/' + domene.id);
    const status = d.status || d.message;
    console.log(`[${(i + 1) * 15}s] status: ${status}`);
    if (status === 'verified') { console.log('\nRESEND-DOMENET ER VERIFISERT'); break; }
    if (i === 39) console.log('\nFortsatt ikke verifisert — sjekk DNS-postene i Cloudflare.');
  }
} finally {
  try { rmSync(hdrFil, { force: true }); } catch {}
}
