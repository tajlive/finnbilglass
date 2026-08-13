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
  fargetone?: string;
}

export interface BilInput {
  merke: string;
  modell?: string;
  aar?: number | null;
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

  if (profil.fargetone && dek.fargetone) {
    if (dek.fargetone.includes(profil.fargetone)) score += 2;
    else { score -= 2; feil.push(`fargetone: bil ${profil.fargetone}, vare ${dek.fargetone}`); }
  }

  return { vare, score, feil, dek, aar };
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Hovedmatcher: bil → sortert kandidatliste + anbefaling. */
export async function matchFrontrute(env: { FINNBILGLASS_DB: D1Database }, bil: BilInput) {
  const primaer = bil.nokkelord ?? [bil.merke];
  const sekundaer = [bil.modell, bil.aar ? String(bil.aar) : null].filter(Boolean) as string[];

  // Steg 1: seed via varenavn (parametrisert)
  const frontGlob = "(varenavn LIKE '%FRONTRUTE%' OR varenavn LIKE '%FRONT%'" +
    " OR eurokode GLOB '[0-9][0-9][0-9]A*'" +
    " OR eurokode GLOB '[0-9][0-9][0-9][0-9]A*'" +
    " OR eurokode GLOB '[0-9][0-9][0-9][0-9][0-9]A*')";
  const likePrim = primaer.map(() => 'varenavn LIKE ?').join(' AND ');
  const likeSek = sekundaer.map(() => 'varenavn LIKE ?').join(' OR ');
  const primParams = primaer.map((k) => `%${k.toUpperCase()}%`);
  const sekParams = sekundaer.map((k) => `%${k.toUpperCase()}%`);

  const seedSql = `SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
    FROM autoglass_prisliste
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
  if (koder.size) {
    const globs = [...koder].map(() => 'eurokode LIKE ?').join(' OR ');
    const params = [...koder].map((k) => `${k}%`);
    const ekstra = await env.FINNBILGLASS_DB.prepare(
      `SELECT varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type
       FROM autoglass_prisliste WHERE rad_type='glass' AND (${globs})`
    ).bind(...params).all<Kandidat>();
    alle = [...alle, ...(ekstra.results ?? [])];
  }

  // Steg 3: dedupe + kollisjonsvalidering (varenavn bekrefter bilen)
  const sett = new Map<string, Kandidat>();
  for (const r of alle) {
    const n = (r.varenavn ?? '').toUpperCase();
    const okMerke = primaer.every((k) => n.includes(k.toUpperCase()));
    const okSek = sekundaer.length === 0 || sekundaer.some((k) => n.includes(k.toUpperCase()));
    if (okMerke && okSek) sett.set(r.varenr, r);
  }

  // Steg 4: frontrute-filter (posisjon A) + Steg 5: årstall-hardfilter
  const front = [...sett.values()].filter((r) => {
    const dek = dekodeEurokode(r.eurokode);
    return dek.posisjon === 'frontrute' || /FRONT/.test(r.varenavn ?? '');
  });
  const kandidater = bil.aar != null ? front.filter((r) => matcherAar(parseAar(r.varenavn), bil.aar)) : front;

  // Steg 6: score
  const profil = bil.profil ?? {};
  const vurdert = kandidater
    .map((r) => scoreKandidat(r, profil, bil.aar))
    .sort((a, b) => b.score - a.score);

  return {
    kandidater: vurdert.map((v) => ({
      varenr: v.vare.varenr,
      varenavn: v.vare.varenavn,
      kommentar: v.vare.kommentar,
      pris: v.vare.pris,
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
      pris: vurdert[0].vare.pris,
      eurokode: vurdert[0].vare.eurokode,
      score: vurdert[0].score,
      feil: vurdert[0].feil,
    } : null,
    meta: {
      seedAntall: seed.results?.length ?? 0,
      katalogkoder: [...koder],
      kandidaterTotalt: front.length,
      aarEkskludert: front.length - kandidater.length,
    },
  };
}
