/**
 * Admin v1.2 — katalogsøk, glassvalg og pristilbud i Operations Center.
 *
 * Prinsipper:
 *  - Katalogen er kandidatgenerator, aldri sannhet. Usikkert glass merkes
 *    tydelig og presenteres aldri som bekreftet.
 *  - Alle valg og tilbud er append-only med ansvarlig + tidsstempel.
 *  - Et tilbud kan bare sendes når prisen er uttrykkelig bekreftet av
 *    saksbehandler (pris_type = BEKREFTET) og begrunnelse finnes.
 *  - Ingen automatisk checkout eller betaling.
 */
import type { Env } from '../types';
import { canTransitionInquiry, isInquiryStatus } from '../inquiry-workflow';
import { fraTypekode, type TypekodePosisjon } from '../glass-posisjon';

type Rad = Record<string, unknown>;

/** Saksdata ligger i staging-auth i staging, ellers i hovedbasen. */
function inquiryDb(env: Env): D1Database {
  if (env.ENVIRONMENT === 'staging' && env.FINNBILGLASS_STAGING_AUTH) return env.FINNBILGLASS_STAGING_AUTH;
  return env.FINNBILGLASS_DB;
}

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Utleder glasstype/plassering fra varenavn. «Ukjent plassering» er et gyldig svar. */
function plassering(navn: unknown, radType?: unknown): string {
  const n = String(navn || '').toUpperCase();
  const rt = String(radType || '').toLowerCase();
  if (rt === 'frontrute' || n.includes('FRONTRUTE') || /\bWS\b/.test(n)) return 'Frontrute';
  if (n.includes('BAKRUTE') || n.includes('HECK')) return 'Bakrute';
  if (n.includes('DØRRUTE') || n.includes('DORRUTE') || n.includes('DOOR')) return 'Dørrute';
  if (n.includes('SIDERUTE') || n.includes('VENTIL')) return 'Siderute/ventil';
  if (n.includes('TAKGLASS') || n.includes('PANORAMA')) return 'Takglass';
  return 'Ukjent plassering';
}

/**
 * Strukturert plassering fra typekode-registeret.
 * Ukjent informasjon returneres som null — aldri som en antagelse.
 */
function posisjonsfelter(typekode?: string, beskrivelse?: string, kilde?: string): Record<string, unknown> {
  const tp: TypekodePosisjon | null = fraTypekode(typekode ?? null);
  if (!tp || !tp.gyldig) {
    return {
      typekode: typekode ?? null,
      typekode_beskrivelse: beskrivelse ?? null,
      typekode_kilde: kilde ?? null,
      glassklasse: null,
      side_kilde: null,
      fysisk_side: null,
      fysisk_side_antatt: false,
      dor_ledd: null,
      ventil_ledd: null,
      siderute_nummer: null,
      delt_bakrute: false,
      plassering_dokumentert: false,
      plassering_grunn: typekode ? `ukjent typekode «${typekode}»` : 'ingen typekode i registeret',
    };
  }
  return {
    typekode: tp.kode,
    typekode_beskrivelse: beskrivelse ?? null,
    typekode_kilde: kilde ?? null,
    glassklasse: tp.type,
    side_kilde: tp.side,
    fysisk_side: tp.fysiskSide,
    fysisk_side_antatt: tp.fysiskSideAntatt,
    dor_ledd: tp.dorLedd,
    ventil_ledd: tp.ventilLedd,
    siderute_nummer: tp.sideruteNummer,
    delt_bakrute: tp.deltBakrute,
    plassering_dokumentert: true,
    plassering_grunn: tp.grunn,
  };
}

/** Utleder utfall lik resolverens språk: EXACT / PROVISIONAL / AMBIGUOUS / MANUAL_REVIEW. */
function utfallFor(antall: number, harPris: boolean, harEgenskaper: boolean): string {
  if (antall === 0) return 'MANUAL_REVIEW';
  if (antall > 1) return 'AMBIGUOUS';
  if (harPris && harEgenskaper) return 'EXACT';
  return 'PROVISIONAL';
}

/** Fritekstsøk i katalog, prisliste og varenummer. */
export async function handleKatalogSok(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ ok: false, error: 'SOK_FOR_KORT' }, 400);
  const db = env.FINNBILGLASS_DB;
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const bare = q.toUpperCase().replace(/[\s-]/g, '');

  const treff: Rad[] = [];

  // 1) Prislisten — det vi faktisk kan selge.
  try {
    const r = await db.prepare(
      `SELECT p.varenr, p.varenavn, p.eurokode, p.pris, p.rad_type, p.kommentar,
              t.typekode, t.typekode_beskrivelse, t.kilde AS typekode_kilde
         FROM glass_prisliste p
         LEFT JOIN glass_typekode t ON t.varenr = UPPER(p.varenr)
        WHERE UPPER(p.varenr) = ?1 OR UPPER(p.eurokode) = ?1
           OR UPPER(p.varenr) LIKE ?2 OR UPPER(p.eurokode) LIKE ?2 OR UPPER(p.varenavn) LIKE ?2
        LIMIT 25`,
    ).bind(bare, like).all<Rad>();
    for (const x of (r.results ?? [])) {
      treff.push({
        kilde: 'glass_prisliste',
        varenr: x.varenr,
        eurokode: x.eurokode,
        beskrivelse: x.varenavn,
        pris: x.pris,
        rad_type: x.rad_type,
        plassering: plassering(x.varenavn, x.rad_type),
        kommentar: x.kommentar,
        ...posisjonsfelter(x.typekode as string | undefined, x.typekode_beskrivelse as string | undefined, x.typekode_kilde as string | undefined),
      });
    }
  } catch { /* tabellen kan mangle i et miljø */ }

  // 2) Katalog med egenskaper (Pilkington m.fl.).
  try {
    const r = await db.prepare(
      `SELECT eurocode, brand, model, year_from, year_to, category, price, description,
              adas, rain_sensor, heated, acoustic, camera, hud, shade, oem_numbers, source
         FROM glass_catalog
        WHERE UPPER(eurocode) = ?1 OR UPPER(eurocode) LIKE ?2
           OR UPPER(description) LIKE ?2 OR UPPER(brand || ' ' || model) LIKE ?2
           OR oem_numbers LIKE ?2
        LIMIT 25`,
    ).bind(bare, like).all<Rad>();
    for (const x of (r.results ?? [])) {
      treff.push({
        kilde: 'glass_catalog',
        eurokode: x.eurocode,
        beskrivelse: x.description,
        pris: x.price,
        bil: [x.brand, x.model, x.year_from, x.year_to].filter(Boolean).join(' '),
        kategori: x.category,
        plassering: plassering(x.description, x.category),
        egenskaper: {
          adas: !!x.adas, regnsensor: !!x.rain_sensor, oppvarmet: !!x.heated,
          akustisk: !!x.acoustic, kamera: !!x.camera, hud: !!x.hud, solskjerm: !!x.shade,
        },
        oe: x.oem_numbers,
        source: x.source,
      });
    }
  } catch { /* ignorer */ }

  // 3) Ground truth — verifisert bil→frontrute.
  try {
    const r = await db.prepare(
      `SELECT make, model, year, frontrute_eurocode, confidence, verified_by
         FROM ground_truth
        WHERE UPPER(make || ' ' || model) LIKE ?2 OR UPPER(frontrute_eurocode) = ?1
        LIMIT 15`,
    ).bind(bare, like).all<Rad>();
    for (const x of (r.results ?? [])) {
      treff.push({
        kilde: 'ground_truth',
        eurokode: x.frontrute_eurocode,
        bil: `${x.make} ${x.model} ${x.year}`,
        beskrivelse: `Verifisert frontrute: ${x.make} ${x.model} ${x.year}`,
        konfidens: x.confidence,
        verifisert_av: x.verified_by,
      });
    }
  } catch { /* ignorer */ }

  const antall = treff.length;
  const harPris = treff.some((t) => typeof t.pris === 'number' && (t.pris as number) > 0);
  const harEgenskaper = treff.some((t) => !!t.egenskaper);

  return json({
    ok: true,
    q,
    antall,
    utfall: utfallFor(antall, harPris, harEgenskaper),
    advarsel:
      antall === 0 ? 'Ingen treff. Saken må løses manuelt — ikke gjett glass.'
      : antall > 1 ? 'Flere mulige glass. Kontroller utstyr før du velger.'
      : harPris ? null : 'Mangler pris eller egenskaper — kandidaten er ikke bekreftet.',
    treff,
  });
}

/** Detaljer for ett glass (pris + egenskaper + kilde). */
export async function handleKatalogGlass(env: Env, ident: string): Promise<Response> {
  const db = env.FINNBILGLASS_DB;
  const key = ident.trim().toUpperCase();
  const ut: Rad = { ok: true, ident };

  try {
    const p = await db.prepare(
      'SELECT varenr, varenavn, eurokode, pris, rad_type, kommentar FROM glass_prisliste WHERE UPPER(varenr) = ?1 OR UPPER(eurokode) = ?1 LIMIT 1',
    ).bind(key).first<Rad>();
    if (p) ut.prisliste = p;
  } catch { /* ignorer */ }

  try {
    const c = await db.prepare(
      `SELECT eurocode, brand, model, year_from, year_to, category, price, description, oem_numbers,
              adas, rain_sensor, heated, acoustic, camera, hud, shade, source, stock_status
         FROM glass_catalog WHERE UPPER(eurocode) = ?1 OR UPPER(description) LIKE ?2 LIMIT 1`,
    ).bind(key, `%${ident}%`).first<Rad>();
    if (c) ut.katalog = c;
  } catch { /* ignorer */ }

  if (!ut.prisliste && !ut.katalog) return json({ ok: false, error: 'IKKE_FUNNET' }, 404);
  return json(ut);
}

/** Registrer manuelt glassvalg på en sak (append-only, med begrunnelse). */
export async function handleGlassValg(request: Request, env: Env, inquiryId: number): Promise<Response> {
  const db = inquiryDb(env);
  let b: Record<string, unknown>;
  try { b = (await request.json()) as Record<string, unknown>; } catch { return json({ ok: false, error: 'UGYLDIG_JSON' }, 400); }

  const varenr = typeof b.varenr === 'string' ? b.varenr.trim().slice(0, 40) : '';
  const eurokode = typeof b.eurokode === 'string' ? b.eurokode.trim().slice(0, 40) : '';
  const oe = typeof b.oe === 'string' ? b.oe.trim().slice(0, 60) : '';
  const begrunnelse = typeof b.begrunnelse === 'string' ? b.begrunnelse.trim().slice(0, 600) : '';
  const utfall = typeof b.utfall === 'string' ? b.utfall.trim().toUpperCase() : '';
  const av = typeof b.av === 'string' ? b.av.trim().slice(0, 120) : '';

  if (!begrunnelse || !av) return json({ ok: false, error: 'BEGRUNNELSE_OG_ANSVARLIG_PAKREVD' }, 400);
  if (!['EXACT', 'PROVISIONAL', 'AMBIGUOUS', 'MANUAL_REVIEW'].includes(utfall)) return json({ ok: false, error: 'UGYLDIG_UTFALL' }, 400);
  if (utfall === 'EXACT' && !varenr) return json({ ok: false, error: 'EXACT_KREVER_VARENR' }, 400);

  const naa = Date.now();
  await db.prepare(
    'INSERT INTO case_glass_choice (inquiry_id, varenr, eurokode, oe_nummer, utfall, begrunnelse, valgt_av, valgt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(inquiryId, varenr || null, eurokode || null, oe || null, utfall, begrunnelse, av, naa).run();

  await db.prepare(
    "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by) VALUES (?, ?, 'note', ?, ?, ?)",
  ).bind(`glassvalg-${inquiryId}-${naa}`, inquiryId, `Glassvalg (${utfall}): ${varenr || '—'} ${eurokode} · ${begrunnelse}`, naa, av).run();

  return json({ ok: true });
}

type TilbudKropp = {
  varenr?: string; eurokode?: string; oe?: string; beskrivelse?: string;
  pris?: number; prisType?: string; leveringstid?: string; tillegg?: string;
  gyldigTil?: string; begrunnelse?: string; av?: string; send?: boolean;
};

/** Opprett (og eventuelt send) et pristilbud. Krev bekreftet pris + begrunnelse. */
export async function handleTilbud(request: Request, env: Env, inquiryId: number, metode: string): Promise<Response> {
  const db = inquiryDb(env);

  if (metode === 'GET') {
    try {
      const r = await db.prepare(
        'SELECT * FROM glass_quotes WHERE inquiry_id = ? ORDER BY versjon DESC LIMIT 20',
      ).bind(inquiryId).all<Rad>();
      return json({ ok: true, tilbud: r.results ?? [] });
    } catch {
      return json({ ok: true, tilbud: [] });
    }
  }

  let b: TilbudKropp;
  try { b = (await request.json()) as TilbudKropp; } catch { return json({ ok: false, error: 'UGYLDIG_JSON' }, 400); }

  const pris = typeof b.pris === 'number' ? Math.round(b.pris) : 0;
  const prisType = String(b.prisType || '').toUpperCase();
  const av = String(b.av || '').trim().slice(0, 120);
  const begrunnelse = String(b.begrunnelse || '').trim().slice(0, 600);

  if (!av || !begrunnelse) return json({ ok: false, error: 'ANSVARLIG_OG_BEGRUNNELSE_PAKREVD' }, 400);
  if (!(pris > 0)) return json({ ok: false, error: 'PRIS_MA_VERE_POSITIV' }, 400);
  if (!['VEILEDENDE', 'BEKREFTET'].includes(prisType)) return json({ ok: false, error: 'PRIS_TYPE_PAKREVD' }, 400);

  const sak = await db.prepare('SELECT id, navn, kontakt, regnr, status FROM beta_inquiries WHERE id = ?')
    .bind(inquiryId).first<{ id: number; navn: string; kontakt: string; regnr: string | null; status: string }>();
  if (!sak) return json({ ok: false, error: 'SAK_FINNES_IKKE' }, 404);
  if (['CLOSED', 'REJECTED'].includes(sak.status)) return json({ ok: false, error: 'SAKEN_ER_LUKKET' }, 409);

  const forrige = await db.prepare('SELECT COALESCE(MAX(versjon), 0) AS v FROM glass_quotes WHERE inquiry_id = ?')
    .bind(inquiryId).first<{ v: number }>();
  const versjon = (forrige?.v ?? 0) + 1;
  const naa = Date.now();

  await db.prepare(
    `INSERT INTO glass_quotes (inquiry_id, versjon, varenr, eurokode, oe_nummer, beskrivelse, pris_kr, pris_type,
       leveringstid, tillegg_json, gyldig_til, begrunnelse, opprettet_av, opprettet_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    inquiryId, versjon,
    String(b.varenr || '').slice(0, 40) || null,
    String(b.eurokode || '').slice(0, 40) || null,
    String(b.oe || '').slice(0, 60) || null,
    String(b.beskrivelse || '').slice(0, 200) || null,
    pris, prisType,
    String(b.leveringstid || '').slice(0, 80) || null,
    String(b.tillegg || '').slice(0, 400) || null,
    String(b.gyldigTil || '').slice(0, 20) || null,
    begrunnelse, av, naa,
  ).run();

  // Logg i saken uansett om den sendes nå.
  await db.prepare(
    "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by) VALUES (?, ?, 'note', ?, ?, ?)",
  ).bind(
    `tilbud-${inquiryId}-${naa}`,
    inquiryId,
    `Tilbud v${versjon}: ${pris} kr (${prisType})${b.varenr ? ' · ' + b.varenr : ''} · ${begrunnelse}`,
    naa, av,
  ).run();

  if (!b.send) return json({ ok: true, versjon, sendt: false });

  const tilEpost = (sak.kontakt || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tilEpost)) {
    return json({ ok: true, versjon, sendt: false, advarsel: 'Kunden har ingen e-postadresse — tilbudet er lagret, men ikke sendt.' });
  }
  const sending = await sendTilbudEpost(env, tilEpost, sak.navn, sak.regnr, {
    versjon, pris, prisType, varenr: b.varenr, beskrivelse: b.beskrivelse,
    leveringstid: b.leveringstid, tillegg: b.tillegg, gyldigTil: b.gyldigTil,
  });
  if (!sending.ok) return json({ ok: true, versjon, sendt: false, advarsel: sending.error || 'Utsending feilet.' });

  await db.prepare('UPDATE glass_quotes SET sendt_at = ?, sendt_av = ? WHERE inquiry_id = ? AND versjon = ?')
    .bind(naa, av, inquiryId, versjon).run();
  await db.prepare(
    "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by) VALUES (?, ?, 'note', ?, ?, ?)",
  ).bind(`tilbudsendt-${inquiryId}-${naa}`, inquiryId, `Tilbud v${versjon} sendt på e-post til kunden (${pris} kr, ${prisType}).`, naa, av).run();
  // Gyldig status etter sendt tilbud er OFFERED — og bare når overgangen er tillatt.
  let nyStatus: string | null = null;
  if (isInquiryStatus(sak.status) && canTransitionInquiry(sak.status, 'OFFERED')) {
    await db.prepare("UPDATE beta_inquiries SET status = 'OFFERED', updated_at = ? WHERE id = ?").bind(naa, inquiryId).run();
    nyStatus = 'OFFERED';
  } else {
    await db.prepare(
      "INSERT INTO beta_inquiry_events (event_id, inquiry_id, event_type, note, created_at, created_by) VALUES (?, ?, 'note', ?, ?, ?)",
    ).bind(
      `tilbudstatus-${inquiryId}-${naa}`, inquiryId,
      `Tilbud v${versjon} sendt, men status ble stående på ${sak.status} (ikke en tillatt overgang til OFFERED).`,
      naa, av,
    ).run();
  }

  return json({ ok: true, versjon, sendt: true, status: nyStatus || sak.status });
}

async function sendTilbudEpost(
  env: Env, til: string, navn: string, regnr: string | null,
  q: { versjon: number; pris: number; prisType: string; varenr?: string; beskrivelse?: string; leveringstid?: string; tillegg?: string; gyldigTil?: string },
): Promise<{ ok: boolean; error?: string }> {
  const fra = env.SUPPORT_FROM_EMAIL || 'support@finnbilglass.no';
  if (!env.BREVO_API_KEY) return { ok: false, error: 'BREVO_API_KEY mangler' };
  const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

  const linjer = [
    `<p>Hei ${esc(navn || '')},</p>`,
    `<p>Her er tilbudet vårt${regnr ? ' til ' + esc(regnr) : ''}:</p>`,
    '<ul>',
    q.varenr ? `<li><strong>Glass:</strong> ${esc(q.varenr)}${q.beskrivelse ? ' — ' + esc(q.beskrivelse) : ''}</li>` : '',
    `<li><strong>Pris:</strong> ${q.pris} kr ${q.prisType === 'BEKREFTET' ? '(bekreftet)' : '(veiledende)'}</li>`,
    q.leveringstid ? `<li><strong>Leveringstid:</strong> ${esc(q.leveringstid)}</li>` : '',
    q.tillegg ? `<li><strong>Tillegg:</strong> ${esc(q.tillegg)}</li>` : '',
    q.gyldigTil ? `<li><strong>Gyldig til:</strong> ${esc(q.gyldigTil)}</li>` : '',
    '</ul>',
    q.prisType === 'VEILEDENDE'
      ? '<p>Prisen er veiledende og bekreftes før endelig bestilling.</p>'
      : '<p>Prisen er bekreftet av oss.</p>',
    '<p>— Finnbilglass</p>',
  ].filter(Boolean).join('');

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: fra, name: 'Finnbilglass' },
        to: [{ email: til, name: navn || undefined }],
        subject: `Pristilbud${regnr ? ' — ' + regnr : ''} (v${q.versjon})`,
        htmlContent: linjer,
        textContent: `Hei ${navn || ''}. Tilbud: ${q.varenr || 'glass'} ${q.pris} kr (${q.prisType}). — Finnbilglass`,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `Brevo ${r.status}${t ? ': ' + t.slice(0, 120) : ''}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** E-posthistorikk for en sak: svar, tilbud og notater — uten duplikater. */
export async function handleEpostHistorikk(env: Env, inquiryId: number): Promise<Response> {
  const db = inquiryDb(env);
  const rader = await db.prepare(
    `SELECT event_id, event_type, note, created_at, created_by, meta_json
       FROM beta_inquiry_events
      WHERE inquiry_id = ? AND event_type IN ('reply','status','note')
      ORDER BY created_at DESC LIMIT 100`,
  ).bind(inquiryId).all<Rad>();

  const historikk = (rader.results ?? []).map((r) => ({
    tid: r.created_at,
    type: r.event_type,
    fra: r.created_by,
    innhold: r.note,
    meta: r.meta_json ? JSON.parse(String(r.meta_json)) : null,
  }));

  return json({ ok: true, historikk });
}
