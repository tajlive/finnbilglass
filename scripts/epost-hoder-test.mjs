// Verifiserer e-posthodene på mottakskvitteringen (List-Unsubscribe / List-Help / Reply-To).
//
// Bakgrunn: Brevo legger automatisk på `List-Unsubscribe` på ALL transaksjonspost
// (deres egen FAQ bekrefter det), og Gmail viser det som «Meld deg av». Brevo har
// ingen API-bryter; dokumentert vei er å be Brevo support bytte til `List-Help`
// for mottakerutløst transaksjonspost. Dette scriptet er beviset før/etter.
//
// Kjøres:  node scripts/epost-hoder-test.mjs [staging-URL]
// Lager en midlertidig postkasse hos mail.tm, sender en reell henvendelse på
// staging med den adressen og skriver ut de relevante hodene.
const API = 'https://api.mail.tm';
const BASE = process.argv[2] || 'https://finnbilglass-frontrute-staging.tomarnejensen.workers.dev';
// Merk denne saken som en test i staging /ops, uten å slå opp en ekte bil.
const REGNR = 'ZZ00000';

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function curl(args) {
  return execFileSync('curl', ['-sS', '--max-time', '30', ...args], { encoding: 'utf8', maxBuffer: 20e6 });
}
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

const domene = j(curl([`${API}/domains`]))['hydra:member'][0].domain;
const adresse = `fbg-hode-${randomBytes(4).toString('hex')}@${domene}`;
const passord = 'Test-' + randomBytes(6).toString('hex');
const konto = j(curl(['-X', 'POST', `${API}/accounts`, '-H', 'content-type: application/json',
  '-d', JSON.stringify({ address: adresse, password: passord })]));
if (!konto?.id) { console.log('Kunne ikke opprette testpostkasse'); process.exit(1); }
console.log('testpostkasse:', adresse);

const token = j(curl(['-X', 'POST', `${API}/token`, '-H', 'content-type: application/json',
  '-d', JSON.stringify({ address: adresse, password: passord })]))?.token;
const auth = ['-H', `Authorization: Bearer ${token}`];

const svar = curl(['-X', 'POST', `${BASE}/api/inquiry`, '-H', 'content-type: application/json',
  '-d', JSON.stringify({ regnr: REGNR, navn: 'Hodetest Nordisk klarhet', kontakt: adresse, melding: 'Test av e-posthoder' })]);
const innsending = j(svar);
if (!innsending?.ok) { console.log('HENVENDELSE BLE IKKE REGISTRERT:', svar.slice(0, 200)); process.exit(4); }
console.log('testhenvendelse:', innsending.inquiryId, '| registreringsnummer:', REGNR);

let melding = null;
for (let i = 0; i < 24 && !melding; i++) {
  execFileSync('sleep', ['5']);
  const liste = j(curl([`${API}/messages`, ...auth]))?.['hydra:member'] || [];
  melding = liste.find((m) => /mottatt forespørselen/i.test(m.subject || '')) || null;
}
if (!melding) { console.log('INGEN KVITTERING MOTTATT'); process.exit(2); }
console.log('mottatt:', melding.subject, '| fra:', melding.from?.address, '|', melding.createdAt);

// mail.tm svarer {"data": "<rå MIME>"} — ikke ren MIME.
const kilde = j(curl([`${API}/sources/${melding.id}`, ...auth]));
const raa = typeof kilde?.data === 'string' ? kilde.data : '';
if (!raa) { console.log('Kunne ikke lese rå kilde'); process.exit(3); }
const hoder = raa.split(/\r?\n\r?\n/)[0] || '';

const relevante = hoder.split(/\r?\n/)
  .filter((l) => /^(list-|from:|reply-to:|sender:|subject:|return-path:|x-mailin|feedback-id|authentication-results|dkim-signature)/i.test(l.trim()));
console.log('\n--- HODER ---');
for (const l of relevante) console.log(l.trim().slice(0, 320));

const har = (navn) => new RegExp(`^${navn}:`, 'im').test(hoder);
console.log('\nList-Unsubscribe:', har('List-Unsubscribe') ? 'FINNES (gir «Meld deg av» i Gmail)' : 'finnes ikke');
console.log('List-Help       :', har('List-Help') ? 'FINNES' : 'finnes ikke');
console.log('Reply-To        :', (hoder.match(/^Reply-To:.*$/im) || ['(mangler)'])[0].slice(0, 160));
console.log('\nInnhold (første 600 tegn av body):');
const kropp = (raa.split(/\r?\n\r?\n/).slice(1).join('\n\n') || '').replace(/\s+/g, ' ');
console.log(kropp.slice(0, 600));
