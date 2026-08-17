/** Frontrute-matcher — kjernen i Finnbilglass.
 *  Kjede: bil {merke, modell, aar, profil} → D1-kandidater (katalogkode-utvidelse)
 *         → eurokode-dekoder + årstall → score → riktig glass.
 *  Verifisert: SU18018 (VW T5 2003, sensor+antenne, ikke coated) → 2525GYA 9 980 kr.
 */
import { dekodeEurokode, katalogKode } from './eurokode-dekoder';
import { parseAar, matcherAar, type AarIntervall } from './aar-parser';

export interface BilProfil {
  coated?: boolean;
  sensor?: boolean;
  antenne?: boolean;
  sensorgel?: boolean;
  innkapslet?: boolean;
  solar?: boolean;
  fargetone?: string;
}

export interface BilInput {
  merke: string;
  modell?: string;
  aar?: number | null;
  vin?: string | null;
  nokkelord?: string[];
  profil?: BilProfil;
}

export interface Kandidat {
  varenr: string;
  varenavn: string | null;
  kommentar: string | null;
  pris: number | null;
  eurokode: string | null;
}

interface Vurdert {
  vare: Kandidat;
  score: number;
  feil: string[];
  dek: ReturnType<typeof dekodeEurokode>;
  aar: AarIntervall | null;
}

// --- varenavn → ekstra attributter (Autoglass sine forkortelser) ---
function navnAttributter(varenavn: string | null, kommentar: string | null): Set<string> {
  const s = `${varenavn ?? ''} ${kommentar ?? ''}`.toUpperCase();
  const att = new Set<string>();
  if (/COATED|COATING|CSGY/.test(s)) att.add('coated');
  if (/INNK|INNKAPSLET/.test(s)) att.add('innkapslet');
  if (/ANT|ANTENNE/.test(s)) att.add('antenne');
  if (/SENSOR/.test(s)) att.add('sensor');
  if (/S1C|SENSORTAPE|SENSORGEL|NB S1|HUSK S1/.test(s)) att.add('sensorgel');
  if (/SOLAR/.test(s)) att.add('solar');
  if (/OPPVARMET|EL-|ELEKTRISK/.test(s)) att.add('oppvarmet');
  if (/MAX ?5\d%/.test(s)) att.add('sotet-5x');
  return att;
}

function scoreKandidat(vare: Kandidat, profil: BilProfil, bilAar: number | null | undefined): Vurdert {
  const dek = dekodeEurokode(vare.eurokode);
  const att = navnAttributter(vare.varenavn, vare.kommentar);
  let score = 0;
  const feil: string[] = [];

  // Årstall-avstand (straff for åpne intervall som "2003-" når bilen er 2016)
  let aar: AarIntervall | null = null;
  if (bilAar != null) {
    aar = parseAar(vare.varenavn);
    if (aar && isFinite(aar.start)) {
      const avstand = Math.abs(bilAar - aar.start);
      score -= Math.min(avstand / 5, 6);
      if (avstand > 8) feil.push(`årsmodell: bil ${bilAar}, vare starter ${aar.start}`);
    }
  }

  const har = (a: string) => att.has(a) || dek.egenskaper.includes(a);
  const kryss = (navn: keyof BilProfil, kandidatHar: boolean) => {
    if (profil[navn] === undefined) return; // ukjent → ikke straff
    if (profil[navn] === true && kandidatHar) score += 3;
    else if (profil[navn] === false && !kandidatHar) score += 2;
    else { score -= 4; feil.push(`${navn}: bil ${profil[navn]}, vare ${kandidatHar}`); }
  };
  kryss('coated', har('coated'));
  kryss('sensor', har('sensor'));
  kryss('antenne', har('antenne'));
  kryss('sensorgel', har('sensorgel'));
  kryss('innkapslet', har('innkapslet'));
  kryss('solar', har('solar'));

  if (profil.fargetone && dek.fargetone) {
    if (dek.fargetone.includes(profil.fargetone)) score += 2;
    else { score -= 2; feil.push(`fargetone: bil ${profil.fargetone}, vare ${dek.fargetone}`); }
  }

  return { vare, score, feil, dek, aar };
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// Ordbasert treff med forkortelses-toleranse:
//  - Eksakt ord-treff (f.eks. "YARIS", "V70", "T5").
//  - Prefiks-treff for ord ≥4 tegn: "TRANSPORTER" ↔ "TRANSP", "CARAVELLE" ↔ "CARAV".
//    (Autoglass-katalogen forkorter: "VW TRANSP+CARAVELLE T5 2003-".)
//  - Korte tokens (1-3 tegn) krever EKSAKT ord-treff — "CLA" matcher dermed
//    IKKE "S-CLASS"/"ACCLAIM"/"CLASS" (prefiksen kan ikke gjelde korte tokens).
export function ordTreff(tekst: string, tok: string): boolean {
  const ord = (tekst ?? '').toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter(Boolean);
  const T = tok.toUpperCase();
  if (!T) return false;
  return ord.some((o) => {
    if (o === T) return true;
    return T.length >= 4 && o.length >= 4 && (o.startsWith(T) || T.startsWith(o));
  });
}

/** Seed-LIKE: bruker forkortet prefiks (5 tegn) av hvert søkeord for å treffe
 *  katalogforkortelser som "TRANSP" for "TRANSPORTER" (LIKE '%TRANS%' treffer begge).
 *  Presisjonen håndteres i ordTreff (steg 3). */
export function likePrefiks(tok: string): string {
  const t = tok.toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, ' ').trim();
  const ord = t.split(/\s+/);
  return ord.length >= 1 && ord[0].length >= 5 ? ord[0].slice(0, 5) : t;
}

/** Modell-tokens med hygiene:
 *  - Fjern duplikat merke-token («NISSAN NISSAN LEAF» → «NISSAN LEAF»).
 *  - BMW M-prefiks-alias («M550D» → «550D» — katalogen skriver uten M). */
export function modelTokensAv(modell: string, merke: string): string[] {
  const merkeNorm = merke.toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g, '');
  let tokens = modell.toUpperCase().split(/[^A-ZÆØÅ0-9]+/).filter((t) => t.length >= 2);
  if (tokens.length > 1 && tokens[0] === merkeNorm) tokens = tokens.slice(1);
  // M-prefiks-alias: «M550D» → «550D» (SVV skriver M, katalogen uten).
  // Tillater drivverk-suffiks («M550D XDRIVE» → token «M550D» → alias «550D»).
  const alias = tokens.filter((t) => /^M\d{3,}[A-ZÆØÅ]*$/.test(t)).map((t) => t.slice(1));
  if (alias.length) tokens = [...tokens, ...alias];
  return tokens;
}

/** Prisregel (Tom 2026-08-13, intern): listepris × 0,60 → rund NED til nærmeste tier. */
const TIERS = [3990, 5490, 6990, 8490];
export function tierPris(listepris: number | null): number | null {
  if (listepris == null || listepris <= 0) return null;
  const rabattert = listepris * 0.6;
  const tier = TIERS.filter((t) => t <= rabattert).pop();
  return tier ?? null; // under laveste tier → "Spesial" (null)
}

/** Hovedmatcher: bil → sortert kandidatliste + anbefaling. */
export async function matchFrontrute(env: { FINNBILGLASS_DB: D1Database }, bil: BilInput) {
  const primaer = bil.nokkelord ?? [bil.merke];
  // Seed-ord: modell-ord (≥2 tegn) + evt. årstall. LIKE bruker forkortet prefiks for å
  // treffe katalogforkortelser ("TRANSP" for "TRANSPORTER"); presisjon i ordTreff (steg 3).
  const seedOrd: string[] = [];
  if (bil.modell) seedOrd.push(...modelTokensAv(bil.modell, bil.merke));
  if (bil.aar) seedOrd.push(String(bil.aar));

  // Steg 1: seed via varenavn (parametrisert)
  const frontGlob = "(varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%'" +
    " OR eurokode GLOB '[0-9][0-9][0-9]A*'" +
    " OR eurokode GLOB '[0-9][0-9][0-9][0-9]A*'" +
    " OR eurokode GLOB '[0-9][0-9][0-9][0-9][0-9]A*')";
  const likePrim = primaer.map(() => 'varenavn LIKE ?').join(' AND ');
  const likeSek = seedOrd.map(() => 'varenavn LIKE ?').join(' OR ');
  const primParams = primaer.map((k) => `%${k.toUpperCase()}%`);
  const sekParams = seedOrd.map((k) => `%${likePrefiks(k)}%`);

  const seedSql = `SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
    FROM glass_prisliste
    WHERE rad_type='glass' AND ${frontGlob} AND ${likePrim} AND (${likeSek})
    ORDER BY pris`;
  const seed = await env.FINNBILGLASS_DB.prepare(seedSql)
    .bind(...primParams, ...sekParams)
    .all<Kandidat>();

  // Steg 2: katalogkode-utvidelse (Toms regel)
  const koder = new Set<string>();
  for (const r of seed.results ?? []) {
    const k = katalogKode(r.eurokode);
    if (k) koder.add(k);
  }
  let alle: Kandidat[] = [...(seed.results ?? [])];
  // Chunket i biter à 40: D1/SQLite krasjer med >100 OR-ledd
  // («Expression tree is too large (maximum depth 100)»).
  const koderArr = [...koder];
  for (let i = 0; i < koderArr.length; i += 40) {
    const batch = koderArr.slice(i, i + 40);
    const globs = batch.map(() => 'eurokode LIKE ?').join(' OR ');
    const params = batch.map((k) => `${k}%`);
    const ekstra = await env.FINNBILGLASS_DB.prepare(
      `SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
       FROM glass_prisliste WHERE rad_type='glass' AND (${globs})`
    ).bind(...params).all<Kandidat>();
    alle = [...alle, ...(ekstra.results ?? [])];
  }

  // Steg 3: dedupe + kollisjonsvalidering.
  //    Merke + modell-tokens (≥2 tegn) må matche ordbasert (med forkortelses-toleranse).
  //    Rene tall-tokens (2-3 siffer = motorstørrelse, f.eks. "200" i "CLA 200 D") droppes
  //    når modellen har andre tokens — "200" ville ellers matchet "MERCEDES 200-280E".
  //    Modeller som KUN er tall ("308", "5008") beholdes.
  //    Årstall alene er IKKE nok — forhindrer feil bil (f.eks. CLA → S-CLASS via årstallet).
  let modelTokens = modelTokensAv(bil.modell ?? '', bil.merke);
  if (modelTokens.some((t) => !/^\d+$/.test(t))) {
    modelTokens = modelTokens.filter((t) => !/^\d{2,3}$/.test(t));
  }
  const sett = new Map<string, Kandidat>();
  for (const r of alle) {
    const n = (r.varenavn ?? '').toUpperCase();
    const okMerke = primaer.every((k) => ordTreff(n, k));
    const okSek = modelTokens.length === 0 || modelTokens.some((t) => ordTreff(n, t));
    // Nøkkel = eurokode (unikt produkt), IKKE varenr — varenr kan ha flere eurokode-varianter
    // (f.eks. 3172GNCM finnes som 5381AGACMVW1B OG 5381AGACMVW1T = to ulike produkter).
    if (okMerke && okSek) sett.set(r.eurokode ?? r.varenr, r);
  }

  // Steg 4: frontrute-filter (posisjon A) + Steg 5: årstall-hardfilter.
  //    Utelukk trim/lister (PYNTELIST, KLIPS, LIST) — de er ikke glass.
  const TRIM_RE = /PYNTELIST|KLIPS|LISTE\b|LIST\b|TAKELIST|BAGASJEROMSLIST/;
  const front = [...sett.values()].filter((r) => {
    const dek = dekodeEurokode(r.eurokode);
    const erTrim = TRIM_RE.test(r.varenavn ?? '');
    return !erTrim && (dek.posisjon === 'frontrute' || /FRONT/.test(r.varenavn ?? ''));
  });
  const kandidater = bil.aar != null ? front.filter((r) => matcherAar(parseAar(r.varenavn), bil.aar)) : front;

  // Steg 6: score
  const profil = bil.profil ?? {};
  const vurdert = kandidater
    .map((r) => scoreKandidat(r, profil, bil.aar))
    .sort((a, b) => b.score - a.score);

  // Steg 7: pinpoint — ETT entydig treff når toppen er feilfri og skiller seg klart ut.
  const topp = vurdert[0];
  const nest = vurdert[1];
  const margin = topp ? (nest ? topp.score - nest.score : 99) : 0;
  const pinpoint = !!topp && topp.feil.length === 0 && margin >= 4;

  return {
    kandidater: vurdert.map((v) => ({
      varenr: v.vare.varenr,
      varenavn: v.vare.varenavn,
      kommentar: v.vare.kommentar,
      pris: tierPris(v.vare.pris),
      listepris: v.vare.pris,
      eurokode: v.vare.eurokode,
      score: v.score,
      feil: v.feil,
      posisjon: v.dek.posisjon,
      fargetone: v.dek.fargetone,
      egenskaper: v.dek.egenskaper,
      aarIntervall: v.aar,
    })),
    anbefaling: vurdert.length ? {
      varenr: vurdert[0].vare.varenr,
      varenavn: vurdert[0].vare.varenavn,
      pris: tierPris(vurdert[0].vare.pris),
      listepris: vurdert[0].vare.pris,
      eurokode: vurdert[0].vare.eurokode,
      score: vurdert[0].score,
      feil: vurdert[0].feil,
      egenskaper: vurdert[0].dek.egenskaper,
      fargetone: vurdert[0].dek.fargetone,
    } : null,
    pinpoint,
    margin,
    meta: {
      seedAntall: seed.results?.length ?? 0,
      katalogkoder: [...koder],
      kandidaterTotalt: front.length,
      aarEkskludert: front.length - kandidater.length,
    },
  };
}
