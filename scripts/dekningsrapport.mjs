/**
 * dekningsrapport.mjs — Oppgave 5: metrikkrapport for godkjenningsdekning.
 *
 * Lokal-modus (default): kjører på repoets test-/fasitdata (fasit-live,
 * fitment-challenge) — ingen eksterne API-kall.
 *   --d1: henter i tillegg ekte saker (beta_inquiries + case_sku_decisions)
 *         fra D1 via wrangler (eksisterende integrasjon, ikke ny API) og
 *         viser ukentlig fordeling.
 *
 * Metrikker: andel approved uten manuell behandling, andel
 * needs_verification, andel avslått, og hvilke modeller/attributter som
 * oftest forårsaker needs_verification.
 *
 * Bruk: node scripts/dekningsrapport.mjs [--d1]
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const { approvalPolicy } = await import(join(ROOT, 'src/approval/policy.ts'));

// ── Lokale data ──
const fasitLive = JSON.parse(readFileSync(join(DATA, 'fasit-live.json'), 'utf8'));
const challenge = JSON.parse(readFileSync(join(DATA, 'fitment-challenge.json'), 'utf8'));
const fasiter = fasitLive.fasiter ?? [];

function analyseFasit() {
  const saker = fasiter.map((f) => {
    const koder = f.gyldigeKoder ?? [];
    const kandidater = koder.map((k) => ({
      sku: `EUROCODE:${k}`, varenr: null, supplier: 'EUROCODE', supplierPartNumbers: [],
      oemPartNumbers: [], eurocodes: [k], vehicleRules: [], attributes: {
        windshield: true, hud: null, cameraBracket: null, rainLightSensor: null,
        heating: null, acoustic: null, antenna: null, tint: null,
      }, evidence: [], status: 'verified',
    }));
    // Fasit = verifisert regel (AUTHORITATIVE). Entydig kode = auto-godkjennbar.
    const vurdering = approvalPolicy(kandidater, true, []);
    return { bil: f.bil ?? `${f.merke} ${f.modell}`, modell: `${f.merke} ${f.modell ?? ''}`.trim(), aar: f.aar, antallKoder: koder.length, status: vurdering.status };
  });
  const approved = saker.filter((s) => s.status === 'approved');
  const nv = saker.filter((s) => s.status === 'needs_verification');
  // Modeller som oftest forårsaker needs_verification (2+ koder = variantusikkerhet)
  const modellTeller = new Map();
  for (const s of nv) modellTeller.set(s.modell, (modellTeller.get(s.modell) ?? 0) + 1);
  const toppModeller = [...modellTeller.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { total: saker.length, approved: approved.length, needsVerification: nv.length, avslaatt: 0, toppModeller };
}

function analyseChallenge() {
  const cases = challenge.cases ?? [];
  const sensorKamera = cases.filter((c) => /sensor|kamera|hud/i.test(`${c.kategori ?? ''} ${c.beskrivelse ?? ''}`));
  const variantfeller = cases.filter((c) => /variant|felle/i.test(`${c.kategori ?? ''} ${c.beskrivelse ?? ''}`));
  return { total: cases.length, sensorKamera: sensorKamera.length, variantfeller: variantfeller.length };
}

// ── D1 (valgfritt): ekte saker per uke — via CF D1 REST API (stabilt;
//    wrangler-i-child-prosess feiler i bakgrunnskontekst) ──
async function hentD1Saker() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acct) return { feil: 'CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID mangler — kjør lokalt (uten --d1) for repo-data.' };
  try {
    const { default: fetch } = await import('node:fetch').catch(() => ({ default: globalThis.fetch }));
    const list = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database?name=finnbilglass-db`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const uuid = list?.result?.[0]?.uuid;
    if (!uuid) return { feil: 'finnbilglass-db ikke funnet på kontoen.' };
    const query = async (sql) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${uuid}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      }).then((res) => res.json());
      if (!r.success) throw new Error(r.errors?.[0]?.message ?? 'query feilet');
      return r.result?.[0]?.results ?? [];
    };
    const inq = await query('SELECT id, status, created_at FROM beta_inquiries ORDER BY created_at');
    let beslutninger = [];
    try {
      beslutninger = await query('SELECT case_id, decision_type, created_at FROM case_sku_decisions');
    } catch { /* migrasjon 0022 ikke deployet ennå — beslutningsdelen blir 0 */ }
    const avslaatt = beslutninger.filter((b) => b.decision_type === 'reject').length;
    const uker = new Map();
    for (const i of inq) {
      const d = new Date(i.created_at);
      const uke = isoUke(d);
      if (!uker.has(uke)) uker.set(uke, { total: 0, approved: 0, needsVerification: 0, avslaatt: 0 });
      const u = uker.get(uke);
      u.total++;
      if (i.status === 'CONFIRMED') u.approved++;
      else if (i.status === 'REJECTED' || i.status === 'CLOSED') u.avslaatt++;
      else u.needsVerification++;
    }
    // Beslutnings-basert avslag-telling per uke (uavhengig av status-opprydding)
    for (const b of beslutninger) {
      const d = new Date(b.created_at);
      const uke = isoUke(d);
      if (!uker.has(uke)) uker.set(uke, { total: 0, approved: 0, needsVerification: 0, avslaatt: 0 });
      if (b.decision_type === 'reject') uker.get(uke).avslaatt++;
      if (b.decision_type === 'approve_sku' || b.decision_type === 'choose_alternative_sku') uker.get(uke).approved++;
    }
    return [...uker.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([uke, v]) => ({ uke, ...v }));
  } catch (e) {
    return { feil: `D1 utilgjengelig (${e.message.slice(0, 120)}). Kjør med CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID satt.` };
  }
}

function isoUke(d) {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const uke = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-U${String(uke).padStart(2, '0')}`;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)} %` : '—');

(async () => {
  const fasit = analyseFasit();
  const chal = analyseChallenge();
  console.log('\n=== DEKNINGSRAPPORT — godkjenningsflyt ===');
  console.log(`Dato: ${new Date().toISOString().slice(0, 10)} · Kilder: fasit-live (${fasitLive.kilde ?? '?'}) + fitment-challenge\n`);

  console.log(`Fasit-saker (verifisert grunnlag): ${fasit.total}`);
  console.log(`  ✅ approved uten manuell behandling: ${fasit.approved} (${pct(fasit.approved, fasit.total)}) — entydig kode + verifisert regel`);
  console.log(`  ⚠️ needs_verification:                ${fasit.needsVerification} (${pct(fasit.needsVerification, fasit.total)}) — 2+ gyldige koder (variantusikkerhet)`);
  console.log(`  ❌ avslått:                           ${fasit.avslaatt} (${pct(fasit.avslaatt, fasit.total)}) — ingen WRONG_GLASS-data i fasit-settet`);

  console.log(`\nTopp modeller som forårsaker needs_verification (2+ koder):`);
  if (!fasit.toppModeller.length) console.log('  (ingen)');
  for (const [modell, n] of fasit.toppModeller) console.log(`  ${n}× ${modell}`);

  console.log(`\nChallenge-caser: ${chal.total} (${chal.sensorKamera} sensor/kamera/HUD, ${chal.variantfeller} variantfeller)`);
  console.log('  → sensor/kamera/HUD + variantfeller krever bevisinnhenting før approved (doktrine).');

  if (process.argv.includes('--d1')) {
    const uker = await hentD1Saker();
    if (uker.feil) { console.log(`\n${uker.feil}`); process.exit(0); }
    console.log('\n=== Ukentlig fordeling (D1, beta_inquiries + beslutninger) ===');
    console.log('Uke        total  approved  needs_verification  avslått');
    for (const u of uker) {
      console.log(`${u.uke.padEnd(10)} ${String(u.total).padStart(5)}  ${String(u.approved).padStart(8)}  ${String(u.needsVerification).padStart(17)}  ${String(u.avslaatt).padStart(7)}`);
    }
  }
})();
