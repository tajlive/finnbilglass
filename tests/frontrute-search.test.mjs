/**
 * Frontrutesøk — regresjonstester for de to feilene som gjorde at kunde-søket
 * returnerte feil biler (eller ingen):
 *
 *   1. discovery.ts la merkenavnet inn i OR-gruppa, slik at modell og år ble
 *      filtrende no-ops: «TOYOTA C-HR 2018» → COROLLA 97-01, RAV-4 03-05,
 *      HI ACE 96. Feil biler med tilsynelatende gyldig pris.
 *   2. /api/regnr ignorerte lookupOnly og skrev regnr_logg/sok_logg på rene
 *      identifikasjonskall (INC-2026-10-31).
 *
 * Testene bruker en falsk D1 som fanger SQL og parametre, slik at de ser på
 * faktisk spørring — ikke bare på returverdien.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverFrontRute } from '../src/discovery.ts';
import { skalLoggeSok } from '../src/sok-logg-policy.ts';

/** Falsk D1: registrerer hver spørring, svarer med forhåndsdefinerte rader. */
function falskDb(svarFor) {
  const kall = [];
  return {
    kall,
    prepare(sql) {
      const kallObjekt = { sql, params: [] };
      kall.push(kallObjekt);
      const lagKjor = (params) => ({
        all: async () => ({ results: svarFor(sql, params) }),
        first: async () => svarFor(sql, params)[0] ?? null,
        run: async () => ({ success: true }),
      });
      return {
        bind(...params) {
          kallObjekt.params = params;
          return lagKjor(params);
        },
        ...lagKjor([]),
      };
    },
  };
}

const GT_RADER = [
  { model: 'C-HR CROSSOVER', frontrute_eurocode: '8421AGAA' },
  { model: 'C-HR CROSSOVER', frontrute_eurocode: '8421ASGH' },
];
const PRIS_RADER = [
  {
    varenr: '8421AGAA',
    varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-',
    pris: 13290,
    eurokode: '8421AGAACHMVZ',
    rad_type: 'glass',
  },
];

test('GT-treff: returnerer fasit-koder og navnet trenger ikke inneholde FRONTRUTE', async () => {
  const db = falskDb((sql) => {
    if (sql.includes('FROM ground_truth')) return GT_RADER;
    if (sql.includes('FROM glass_prisliste')) return PRIS_RADER;
    return [];
  });
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  assert.equal(res.kilde, 'ground_truth');
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0].varenr, '8421AGAA');
  assert.equal(res.candidates[0].pris, 13290);
  // Ingen tekstsøk skal ha kjørt når GT svarte.
  // Ingen FRONTRUTE-tekstsøk skal ha kjørt når GT svarte (prefiksfasen er OK).
  assert.equal(db.kall.some((k) => k.sql.includes("LIKE '%FRONTRUTE%'")), false);
});

test('GT-spørringen binder EXAKT år — feil generasjon skal ikke slippe gjennom', async () => {
  const db = falskDb((sql) => (sql.includes('FROM ground_truth') ? GT_RADER : []));
  await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  const gt = db.kall.find((k) => k.sql.includes('FROM ground_truth'));
  assert.ok(gt.sql.includes('year = ?'), 'GT-spørringen må filtrere på år');
  assert.ok(gt.params.includes(2018), 'året må være bundet som parameter');
});

test('tekstfallback: merkenavnet legges IKKE i OR-gruppa (regresjon for C-HR-feilen)', async () => {
  const db = falskDb((sql) => {
    if (sql.includes('FROM ground_truth')) return [];
    if (sql.includes('FROM glass_prisliste')) return [];
    return [];
  });
  await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  const tekst = db.kall.find((k) => k.sql.includes('varenavn LIKE'));
  assert.ok(tekst, 'fallback-spørringen må ha kjørt');
  // Merket skal bare brukes i AND-delen — aldri som eget OR-alternativ.
  const merkeParametre = tekst.params.filter((p) => p === '%TOYOTA%');
  assert.equal(merkeParametre.length, 1, `merket bandet ${merkeParametre.length} ganger — OR-gruppa lekker`);
  assert.ok(tekst.params.includes('%C-HR%'), 'modell skal være bundet');
  assert.ok(tekst.params.includes('%2018%'), 'år skal være bundet');
});

test('ingen dekning: tom liste, ingen oppdiktet kandidat', async () => {
  const db = falskDb(() => []);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'ZASTAVA', '101', 1985);
  assert.deepEqual(res.candidates, []);
  assert.equal(res.totalAvailable, 0);
  assert.equal(res.hasMore, false);
});

test('paginering: 20 per side og cursor peker på neste blokk', async () => {
  const mange = Array.from({ length: 25 }, (_, i) => ({
    varenr: `KODE${i}`,
    varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-',
    pris: 1000 + i,
    eurokode: `8421AGAA${i}`,
    rad_type: 'glass',
  }));
  const db = falskDb((sql) => (sql.includes('FROM ground_truth') ? GT_RADER : mange));
  const side1 = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  assert.equal(side1.candidates.length, 20);
  assert.equal(side1.totalAvailable, 25);
  assert.equal(side1.hasMore, true);
  assert.equal(side1.nextCursor, '20');
  const side2 = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018, '20');
  assert.equal(side2.candidates.length, 5);
  assert.equal(side2.hasMore, false);
});

test('lookupOnly slår av logging — fail-safe ellers', () => {
  assert.equal(skalLoggeSok({ regnr: 'AB12345', lookupOnly: true }), false);
  assert.equal(skalLoggeSok({ regnr: 'AB12345' }), true);
  assert.equal(skalLoggeSok({ regnr: 'AB12345', lookupOnly: false }), true);
  assert.equal(skalLoggeSok({ regnr: 'AB12345', lookupOnly: 'true' }), true);
  assert.equal(skalLoggeSok(null), true);
  assert.equal(skalLoggeSok(undefined), true);
  assert.equal(skalLoggeSok('tull'), true);
});

// ── HUD-regelen (Tom, fagregel 17) ────────────────────────────────────────
// HUD er et projeksjonsbilde fra dashbordet og kan ikke leses av glasset.
// Regresjonen: attributter.hud ble satt = eg.includes('oppvarmet'), så en
// frontrute med varmetråder ble presentert som «med head-up-display».
test('HUD utledes ALDRI fra varmetråder — de er separate attributter', async () => {
  const { resolveFrontrute } = await import('../src/vin-resolver.ts');
  const db = falskDb((sql) => {
    if (sql.includes('FROM vin_glass_overrides')) return [];
    if (sql.includes('FROM ground_truth'))
      return [{ model: 'C-HR CROSSOVER', frontrute_eurocode: '8421ASGH', confidence: 0.8 }];
    if (sql.includes('FROM glass_prisliste'))
      return [{ varenr: '8421ASGH', varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-', pris: 2830, eurokode: '8421ASGHB' }];
    if (sql.includes('FROM glass_catalog')) return [{ camera: null, adas: null }];
    if (sql.includes('FROM ktype_registry')) return [];
    return [];
  });
  const res = await resolveFrontrute({ FINNBILGLASS_DB: db }, { merke: 'TOYOTA', modell: 'C-HR', aar: 2018 });
  assert.ok(res.kandidater?.length, 'skal ha minst én kandidat');
  const k = res.kandidater[0];
  assert.equal(k.attributter.hud, null, 'hud skal være ukjent — aldri avledet av glasset');
  assert.equal(typeof k.attributter.oppvarmet, 'boolean', 'oppvarmet skal være satt fra eurokoden');
});

test('kildekontroll: hud settes ikke fra oppvarmet', () => {
  const src = readFileSync(new URL('../src/vin-resolver.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /attributter\.hud\s*=\s*eg\.includes\('oppvarmet'\)/);
  assert.match(src, /attributter\.oppvarmet\s*=\s*eg\.includes\('oppvarmet'\)/);
});

// ── Fase A2: negativtester mot ekte SQL-semantikk ─────────────────────────
// Mini-D1 som faktisk anvender LIKE-filterne, slik at testene beviser at feil
// modell/rutetype ikke kan returneres — ikke bare at SQL-strengen ser riktig ut.
function miniDb(gt, pris) {
  const kall = [];
  const like = (verdi, monster) =>
    new RegExp('^' + String(monster).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(
      String(verdi ?? ''),
    );
  return {
    kall,
    prepare(sql) {
      const k = { sql, params: [] };
      kall.push(k);
      const kor = (params) => {
        if (sql.includes('FROM ground_truth')) {
          const merke = params[0];
          const aar = params.find((x) => typeof x === 'number');
          return gt.filter((r) => r.make === merke && (aar == null || r.year === aar));
        }
        if (!sql.includes('FROM glass_prisliste')) return [];
        if (sql.includes('varenr IN')) {
          const koder = params.filter((x) => typeof x === 'string' && !x.endsWith('%'));
          return pris.filter((r) => koder.includes(r.varenr) || koder.includes(r.eurokode));
        }
        if (sql.includes('eurokode LIKE')) {
          const prefikser = params.filter((x) => typeof x === 'string' && x.endsWith('%') && !x.startsWith('%'));
          const navn = params.filter((x) => typeof x === 'string' && x.startsWith('%'));
          return pris.filter(
            (r) =>
              prefikser.some((pre) => String(r.eurokode ?? '').startsWith(pre.slice(0, -1))) &&
              navn.some((n) => like(r.varenavn, n)),
          );
        }
        const navnParams = params.filter((x) => typeof x === 'string' && x.startsWith('%'));
        const merke = navnParams[0];
        const rest = navnParams.slice(1);
        return pris.filter(
          (r) => like(r.varenavn, merke) && (rest.length === 0 || rest.some((n) => like(r.varenavn, n))),
        );
      };
      const lag = (params) => ({
        all: async () => ({ results: kor(params) }),
        first: async () => kor(params)[0] ?? null,
        run: async () => ({ success: true }),
      });
      return { bind(...params) { k.params = params; return lag(params); }, ...lag([]) };
    },
  };
}

const GT_CHR = [
  { make: 'TOYOTA', model: 'C-HR CROSSOVER', year: 2018, frontrute_eurocode: '8421AGAA', confidence: 0.8 },
];
const PRIS = [
  { varenr: '8421AGAA', varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-', kommentar: '', pris: 13290, eurokode: '8421AGAACHMVZ' },
  { varenr: '2122GN', varenavn: 'TOYOTA COROLLA 97-01 FRONTRUTE', kommentar: '', pris: 3990, eurokode: '2122GN' },
  { varenr: '2572GN', varenavn: 'TOYOTA RAV-4 03-05 FRONTRUTE GN', kommentar: '', pris: 3990, eurokode: '2572GN' },
  { varenr: '2005C', varenavn: 'TOYOTA HI ACE 96- FRONTRUTE', kommentar: '', pris: 3990, eurokode: '2005C' },
  { varenr: 'DØR1', varenavn: 'TOYOTA C-HR DØRRUTE FREMME', kommentar: '', pris: 1500, eurokode: '8421DØR1' },
  { varenr: 'VENT1', varenavn: 'TOYOTA C-HR VENTILRUTE FRAMME', kommentar: '', pris: 900, eurokode: '8421VENT1' },
  { varenr: 'TORP1', varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-', kommentar: 'TORPEDOVEGG FRONTRUTE', pris: 230, eurokode: '8421TORP1' },
];

test('negativ: C-HR-søk returnerer aldri COROLLA, RAV-4 eller HI ACE', async () => {
  const db = miniDb([], PRIS); // ingen GT → tekstfallback
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  const navn = res.candidates.map((c) => c.varenavn).join(' | ');
  assert.doesNotMatch(navn, /COROLLA|RAV-4|HI ACE/i);
});

test('negativ: feil årsmodell gir ingen GT-treff', async () => {
  const db = miniDb(GT_CHR, PRIS);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2005);
  assert.equal(res.candidates.length, 0, 'GT-rad for 2018 skal ikke brukes på 2005');
});

test('negativ: umulig årsmodell avvises uten spørring', async () => {
  const db = miniDb(GT_CHR, PRIS);
  for (const aar of [1500, 2060]) {
    const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', aar);
    assert.equal(res.candidates.length, 0, `år ${aar} skal ikke gi treff`);
  }
});

test('negativ: dørrute, ventilrute og torpedovegg vises aldri som frontrute', async () => {
  const db = miniDb([], PRIS);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  for (const c of res.candidates) {
    assert.doesNotMatch(c.varenavn, /DØRRUTE|VENTILRUTE/i);
    assert.notEqual(c.varenr, 'TORP1', 'torpedovegg skal i karantene');
  }
});

test('negativ: manglende GT gir tomt eller ærlig fallback — aldri oppdiktet treff', async () => {
  const db = miniDb([], []);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'ZASTAVA', '101', 1985);
  assert.deepEqual(res.candidates, []);
  assert.equal(res.totalAvailable, 0);
});

test('prefiks-match krever modelltoken (delt eurokode-prefiks er ikke nok)', async () => {
  // GT peker på 8421ZZ (finnes ikke eksakt), men en annen bil har 8421ZZZ...
  const gt = [{ make: 'TOYOTA', model: 'C-HR CROSSOVER', year: 2018, frontrute_eurocode: '8421ZZ', confidence: 0.8 }];
  const pris = [
    { varenr: 'X1', varenavn: 'TOYOTA LAND CRUISER FRONTRUTE', kommentar: '', pris: 9000, eurokode: '8421ZZTOP' },
  ];
  const db = miniDb(gt, pris);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  assert.equal(res.candidates.length, 0, 'prefiks uten modelltreff skal ikke gi kandidat');
});

test('lignende modellnavn blandes ikke (C-HR vs C-HR CROSSOVER er samme, COROLLA er ikke)', async () => {
  const gt = [{ make: 'TOYOTA', model: 'C-HR CROSSOVER', year: 2018, frontrute_eurocode: '8421AGAA', confidence: 0.8 }];
  const db = miniDb(gt, PRIS);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  assert.ok(res.candidates.length >= 1);
  assert.equal(res.candidates.every((c) => /C-HR/i.test(c.varenavn)), true);
});

test('pris-karantene: kit-priset glass skjules for prisen, men kandidaten beholdes', async () => {
  const { prisKaranteneGrunn } = await import('../src/glass-karantene.ts');
  assert.ok(prisKaranteneGrunn('10X I KIT'));
  assert.ok(prisKaranteneGrunn('+++6 STYKKER I KIT'));
  assert.equal(prisKaranteneGrunn('## NB MÅ HA 2741PYKIT'), null, 'merknad på ekte frontrute skal ikke rammes');
  assert.equal(prisKaranteneGrunn('MAX 30%'), null);

  const gt = [{ make: 'TOYOTA', model: 'C-HR CROSSOVER', year: 2018, frontrute_eurocode: 'KITKODE', confidence: 0.8 }];
  const pris = [{ varenr: 'KITKODE', varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-', kommentar: '10X I KIT', pris: 915, eurokode: 'KITKODE' }];
  const db = miniDb(gt, pris);
  const res = await discoverFrontRute({ FINNBILGLASS_DB: db }, 'TOYOTA', 'C-HR', 2018);
  assert.equal(res.candidates.length, 1, 'kandidaten skal beholdes');
  assert.equal(res.candidates[0].pris, null, 'kit-pris skal ikke vises som listepris');
});
