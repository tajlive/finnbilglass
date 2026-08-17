/** Finnbilglass Worker — frontrute-matcher API + statisk frontend.
 *  POST /api/frontrute  {merke, modell, aar, profil} → glass
 *  GET  /health
 *  Alt annet (/, styles.css, app.js, index.html) → [assets] public/
 */
import type { Env } from './types';
import { matchFrontrute, tierPris, type BilInput } from './matcher';
import { resolveFrontrute } from './vin-resolver';
import { resolverModus } from './kill-switch';
import { svvLookup, svvLookupVin } from './svv';
import { lesSkilt } from './les-skilt';
import {
  resolveImageObservations,
  observationToSignals,
  type ImageObservation,
} from './image-resolver';
import { WorkersAIVisionProvider } from './vision-provider';
import type {
  EvidenceSignal,
  FusionCandidate,
} from './evidence-fusion';
import { normalizeR43, fuseEvidence } from './evidence-fusion';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** IP + geolokalisering gratis fra Cloudflare (request.cf) — ingen ekstern API. */
function geoAv(request: Request) {
  const cf = (request as unknown as { cf?: { country?: string; city?: string; asOrganization?: string } }).cf;
  return {
    ip: request.headers.get('CF-Connecting-IP') ?? null,
    land: cf?.country ?? null,
    by: cf?.city ?? null,
    asn: cf?.asOrganization ?? null,
  };
}

function validateBil(body: unknown): BilInput | string {
  if (!body || typeof body !== 'object') return 'JSON-body påkrevd';
  const b = body as Record<string, unknown>;
  if (typeof b.merke !== 'string' || !b.merke.trim()) return 'merke påkrevd (f.eks. "VW")';
  const bil: BilInput = { merke: b.merke.trim() };
  if (typeof b.modell === 'string') bil.modell = b.modell.trim();
  if (typeof b.aar === 'number' && Number.isInteger(b.aar) && b.aar > 1900 && b.aar < 2100) bil.aar = b.aar;
  if (typeof b.vin === 'string' && b.vin.trim()) bil.vin = b.vin.trim().toUpperCase();
  if (Array.isArray(b.nokkelord)) bil.nokkelord = (b.nokkelord as unknown[]).filter((k) => typeof k === 'string').map((k) => (k as string).trim());
  if (b.profil && typeof b.profil === 'object') {
    const p = b.profil as Record<string, unknown>;
    const profil: BilInput['profil'] = {};
    for (const key of ['coated', 'sensor', 'antenne', 'sensorgel', 'innkapslet'] as const) {
      if (typeof p[key] === 'boolean') profil[key] = p[key] as boolean;
    }
    if (typeof p.fargetone === 'string') profil.fargetone = p.fargetone;
    bil.profil = profil;
  }
  return bil;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function validateImageResolverBody(body: unknown):
  | {
      queryRef: string;
      candidates: FusionCandidate[];
      observations: ImageObservation[];
      existingSignals: EvidenceSignal[];
    }
  | string {
  if (!isRecord(body)) return 'JSON-body påkrevd';
  const queryRef = typeof body.queryRef === 'string' && body.queryRef.trim()
    ? body.queryRef.trim().slice(0, 120)
    : `img-${crypto.randomUUID()}`;
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) return 'candidates påkrevd';
  if (!Array.isArray(body.observations) || body.observations.length === 0) return 'observations påkrevd';

  const candidates = body.candidates.slice(0, 25).map((raw) => {
    if (!isRecord(raw)) throw new Error('ugyldig kandidat');
    const glassId = typeof raw.glassId === 'string' ? raw.glassId.trim() : '';
    if (!glassId) throw new Error('candidate.glassId påkrevd');
    const oemNumbers = Array.isArray(raw.oemNumbers) ? raw.oemNumbers.filter((v): v is string => typeof v === 'string') : [];
    const r43Numbers = Array.isArray(raw.r43Numbers)
      ? raw.r43Numbers.filter((v): v is string => typeof v === 'string').map(normalizeR43).filter((v): v is string => v !== null)
      : [];
    const features = isRecord(raw.features) ? raw.features : {};
    const normalizedFeatures: Record<string, boolean | null> = {};
    for (const [k, v] of Object.entries(features)) {
      if (typeof v === 'boolean' || v === null) normalizedFeatures[k] = v;
    }
    return {
      glassId,
      eurocode: typeof raw.eurocode === 'string' ? raw.eurocode : null,
      oemNumbers,
      r43Numbers,
      features: normalizedFeatures,
      sellable: raw.sellable !== false,
      priceTier: typeof raw.priceTier === 'number' ? raw.priceTier : null,
      label: typeof raw.label === 'string' ? raw.label : undefined,
    };
  });

  const observations = body.observations.slice(0, 6).map((raw) => {
    if (!isRecord(raw)) throw new Error('ugyldig observation');
    const imageId = typeof raw.imageId === 'string' ? raw.imageId.trim() : '';
    const modelVersion = typeof raw.modelVersion === 'string' ? raw.modelVersion.trim() : '';
    if (!imageId || !modelVersion) throw new Error('observation.imageId og modelVersion påkrevd');
    return {
      imageId,
      role: typeof raw.role === 'string' ? raw.role as ImageObservation['role'] : 'unknown',
      inputHash: typeof raw.inputHash === 'string' ? raw.inputHash : undefined,
      modelVersion,
      rawText: typeof raw.rawText === 'string' ? raw.rawText.slice(0, 5000) : undefined,
      eurocodes: Array.isArray(raw.eurocodes) ? raw.eurocodes : [],
      oemNumbers: Array.isArray(raw.oemNumbers) ? raw.oemNumbers : [],
      features: Array.isArray(raw.features) ? raw.features : [],
      similarities: Array.isArray(raw.similarities) ? raw.similarities : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((v): v is string => typeof v === 'string') : [],
    };
  });

  const existingSignals = Array.isArray(body.existingSignals)
    ? body.existingSignals.filter(isRecord) as unknown as EvidenceSignal[]
    : [];

  return { queryRef, candidates, observations, existingSignals };
}

function hasImageResolverAccess(request: Request, env: Env): boolean {
  if (!env.IMAGE_RESOLVER_SECRET) return env.ENVIRONMENT !== 'production';
  const auth = request.headers.get('Authorization') ?? '';
  return auth === `Bearer ${env.IMAGE_RESOLVER_SECRET}`;
}

/** Session-id fra frontend (localStorage) — kobler hele kundereisen. */
function sessionId(body: unknown, request: Request): string | null {
  if (isRecord(body) && typeof body.sessionId === 'string' && body.sessionId.trim()) {
    return body.sessionId.trim().slice(0, 64) || null;
  }
  return request.headers.get('X-Session-Id')?.slice(0, 64) || null;
}

/** Hent bil-kontekst fra body for opplæringslogging. */
function bilKontekst(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  const b = body as Record<string, unknown>;
  const bil = isRecord(b.bil) ? b.bil as Record<string, unknown> : null;
  const ctx: Record<string, unknown> = {};
  if (typeof b.regnr === 'string' && b.regnr.trim()) ctx.regnr = b.regnr.trim();
  if (typeof b.vin === 'string' && b.vin.trim()) ctx.vin = b.vin.trim();
  if (bil) {
    for (const key of ['merke', 'modell', 'aar', 'import', 'importLand', 'forstegangsregistrert'] as const) {
      if (bil[key] !== undefined && bil[key] !== null) ctx[key] = bil[key];
    }
  }
  return Object.keys(ctx).length ? ctx : null;
}

/** Logg hendelse (valg/inntasting) — aldri blokkerende, feil svelges. */
async function loggHendelse(env: Env, body: unknown, request: Request): Promise<void> {
  try {
    const hendelse = isRecord(body) && typeof (body as Record<string, unknown>).hendelse === 'string'
      ? ((body as Record<string, unknown>).hendelse as string).trim().slice(0, 40)
      : '';
    if (!hendelse) return;
    const data = isRecord(body) && (body as Record<string, unknown>).data !== undefined
      ? JSON.stringify((body as Record<string, unknown>).data)
      : null;
    const utfall = isRecord(body) && typeof (body as Record<string, unknown>).resolverUtfall === 'string'
      ? ((body as Record<string, unknown>).resolverUtfall as string).slice(0, 12)
      : null;
    const sid = sessionId(body, request);
    const ctx = bilKontekst(body);
    await env.FINNBILGLASS_DB.prepare(
      `INSERT INTO opplaering_hendelse (session_id, hendelse, data, bil_kontekst, resolver_utfall, ip, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sid,
      hendelse,
      data,
      ctx ? JSON.stringify(ctx) : null,
      utfall,
      request.headers.get('CF-Connecting-IP') ?? null,
      request.headers.get('User-Agent') ?? null,
    ).run();
  } catch (e) {
    console.error('opplaering-hendelse-logging feilet:', e);
  }
}

/** DataURL → { bytes, mime, ext }. Returnerer null ved ugyldig dataURL. */
function dataUrlTilBytes(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const m = /^data:([a-z0-9/+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const mime = m[1].toLowerCase();
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { bytes, mime, ext };
  } catch {
    return null;
  }
}

/** Lagre bilde til R2 + metadata til D1 — aldri blokkerende. */
async function lagreOpplaeringBilde(
  env: Env,
  opts: {
    sessionId: string | null;
    type: 'skilt' | 'verify43r';
    imageDataUrl?: string;
    lesing?: Record<string, unknown>;
    fasit?: Record<string, unknown> | null;
    utfall: 'ok' | 'ikke_funnet' | 'feil';
  }
): Promise<void> {
  try {
    if (!env.OPPLAERING_BUCKET) return;
    let r2Key: string | null = null;
    let mime: string | null = null;
    if (opts.imageDataUrl) {
      const parsed = dataUrlTilBytes(opts.imageDataUrl);
      if (parsed) {
        const ts = Date.now();
        const sid = opts.sessionId ?? 'anonym';
        r2Key = `${opts.type}/${sid}/${ts}.${parsed.ext}`;
        mime = parsed.mime;
        await env.OPPLAERING_BUCKET.put(r2Key, parsed.bytes, { httpMetadata: { contentType: parsed.mime } });
      }
    }
    await env.FINNBILGLASS_DB.prepare(
      `INSERT INTO opplaering_bilde (session_id, type, r2_key, mime, lesing, fasit, utfall)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.sessionId,
      opts.type,
      r2Key,
      mime,
      opts.lesing ? JSON.stringify(opts.lesing) : null,
      opts.fasit ? JSON.stringify(opts.fasit) : null,
      opts.utfall,
    ).run();
  } catch (e) {
    console.error('opplaering-bilde-lagring feilet:', e);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (method === 'GET' && path === '/health') {
      const count = await env.FINNBILGLASS_DB.prepare('SELECT COUNT(*) AS n FROM glass_prisliste').first<{ n: number }>();
      return json({ ok: true, service: 'finnbilglass-frontrute', katalogRader: count?.n ?? 0 });
    }

    if (method === 'POST' && path === '/api/frontrute') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const bil = validateBil(body);
      if (typeof bil === 'string') return json({ ok: false, error: bil }, 400);
      try {
        // Resolver først (PINPOINT/VERIFY). FALLBACK → eksisterende tekstmatcher (uendret).
        // Kill switch (G6): resolver_all → tvungen FALLBACK; resolver_pinpoint → degrader til VERIFY.
        let resolver = await resolveFrontrute(env, bil);
        const modus = await resolverModus(env, resolver.utfall);
        if (modus !== resolver.utfall) {
          resolver = { ...resolver, utfall: modus, grunn: `kill switch: ${resolver.utfall}→${modus} (${resolver.grunn})` };
        }
        if (resolver.utfall !== 'FALLBACK') {
          const topp = resolver.kandidater?.[0] ?? null;
          return json({
            ok: true,
            ...resolver,
            pinpoint: resolver.utfall === 'PINPOINT',
            anbefaling: resolver.utfall === 'PINPOINT'
              ? { varenr: resolver.varenr, varenavn: resolver.varenavn, pris: resolver.pris, listepris: resolver.listepris, eurokode: resolver.eurokode }
              : (topp ? {
                  varenr: topp.varenr,
                  varenavn: topp.varenavn,
                  pris: topp.pris,
                  listepris: topp.listepris,
                  eurokode: topp.eurokode,
                } : null),
            meta: { resolver: true, grunn: resolver.grunn },
          });
        }
        const resultat = await matchFrontrute(env, bil);
        return json({ ok: true, ...resultat, meta: { ...resultat.meta, resolver: false } });
      } catch (e) {
        console.error('matchFrontrute feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/opplaering') {
      // Opplæringslogging av valg/inntasting — frontend kaller ved hver interaksjon.
      // Aldri blokkerende, ingen auth (kun hendelsesdata, ingen PII utover kjennemerke).
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      await loggHendelse(env, body, request);
      return json({ ok: true });
    }

    if (method === 'POST' && path === '/api/regnr') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const regnr = (body as Record<string, unknown>)?.regnr;
      if (typeof regnr !== 'string' || !regnr.trim()) return json({ ok: false, error: 'regnr påkrevd' }, 400);
      const ren = regnr.trim();
      const norm = ren.toUpperCase().replace(/[\s\-–—.]+/g, '');
      let lagret = false;
      try {
        await env.FINNBILGLASS_DB.prepare(
          'INSERT OR IGNORE INTO regnr_logg (regnr, regnr_norm, ua) VALUES (?, ?, ?)'
        ).bind(ren, norm, request.headers.get('User-Agent') ?? null).run();
        lagret = true;
      } catch (e) {
        console.error('regnr-lagring feilet:', e);
      }
      // Søkelogg: hvert søk med IP + geolokalisering (land/by/ISP) — aldri blokkerende.
      try {
        const g = geoAv(request);
        await env.FINNBILGLASS_DB.prepare(
          'INSERT INTO sok_logg (regnr, regnr_norm, ip, land, by, asn, ua) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(ren, norm, g.ip, g.land, g.by, g.asn, request.headers.get('User-Agent') ?? null).run();
      } catch (e) {
        console.error('søkelogg feilet:', e);
      }
      // SVV-oppslag: kjennemerke → bil. Null ved feil/ukjent — frontend faller til manuell.
      let bil = null;
      let resolver = null;
      try {
        bil = await svvLookup(norm, env.SVV_API_KEY);
      } catch (e) {
        console.error('SVV-oppslag feilet:', e);
      }
      // OE/VIN-pinpoint: SVV-bil → resolver (PINPOINT/VERIFY/FALLBACK) — aldri blokkerende.
      if (bil) {
        try {
          resolver = await resolveFrontrute(env, {
            merke: bil.merke,
            modell: bil.modell ?? undefined,
            aar: bil.aar ?? undefined,
            vin: bil.vin ?? undefined,
          });
        } catch (e) {
          console.error('Resolver feilet:', e);
        }
      }
      return json({ ok: true, lagret, bil, resolver });
    }

    if (method === 'POST' && path === '/api/vin') {
      // Backup-oppslag: kjennemerke fant ikke bilen i SVV → prøv understellsnummer (VIN).
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const vin = (body as Record<string, unknown>)?.vin;
      if (typeof vin !== 'string' || !vin.trim()) return json({ ok: false, error: 'vin påkrevd' }, 400);
      const ren = vin.trim().toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (ren.length < 11 || ren.length > 17) return json({ ok: false, error: 'Ugyldig chassisnummer' }, 400);
      let bil = null;
      let resolver = null;
      try {
        bil = await svvLookupVin(ren, env.SVV_API_KEY);
      } catch (e) {
        console.error('SVV VIN-oppslag feilet:', e);
      }
      if (bil) {
        try {
          resolver = await resolveFrontrute(env, {
            merke: bil.merke,
            modell: bil.modell ?? undefined,
            aar: bil.aar ?? undefined,
            vin: bil.vin ?? ren,
          });
        } catch (e) {
          console.error('Resolver feilet (VIN):', e);
        }
      }
      return json({ ok: true, bil, resolver });
    }

    if (method === 'POST' && path === '/api/les-skilt') {
      // Foto av kjennemerket → AI leser skiltet → SVV gir hele bilen.
      // Erstatter «Fyll inn bilen manuelt»: privatkunder skal ikke gjette merke/modell/år.
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      const imageRaw = (body as Record<string, unknown>)?.image;
      if (typeof imageRaw !== 'string' || imageRaw.length < 100 || !imageRaw.startsWith('data:image/')) {
        return json({ ok: false, error: 'image må være dataURL (data:image/jpeg|png|webp;base64,...)' }, 400);
      }
      if (imageRaw.length > 7_000_000) {
        return json({ ok: false, error: 'Bildet er for stort (maks ~5 MB)' }, 413);
      }
      try {
        const lest = await lesSkilt(env.AI, imageRaw);
        // Opplæring: lagre skiltbildet + hva AI-en leste (innlesingsfeil må kunne analyseres).
        const sid = sessionId(body, request);
        await lagreOpplaeringBilde(env, {
          sessionId: sid,
          type: 'skilt',
          imageDataUrl: imageRaw,
          lesing: { regnr: lest.regnr, confidence: lest.confidence, raatekst: lest.raatekst.slice(0, 300) },
          fasit: bilKontekst(body),
          utfall: lest.regnr ? 'ok' : 'ikke_funnet',
        });
        if (!lest.regnr) {
          return json({ ok: false, error: 'Kunne ikke lese kjennemerket i bildet. Prøv igjen i bedre lys, eller skriv det inn manuelt.', lest: { confidence: lest.confidence } }, 422);
        }
        // Samme SVV+resolver-sekvens som /api/regnr.
        let bil = null;
        let resolver = null;
        try {
          bil = await svvLookup(lest.regnr, env.SVV_API_KEY);
        } catch (e) {
          console.error('SVV-oppslag feilet:', e);
        }
        if (bil) {
          try {
            resolver = await resolveFrontrute(env, {
              merke: bil.merke,
              modell: bil.modell ?? undefined,
              aar: bil.aar ?? undefined,
              vin: bil.vin ?? undefined,
            });
          } catch (e) {
            console.error('Resolver feilet:', e);
          }
        }
        return json({ ok: true, regnr: lest.regnr, lest: { confidence: lest.confidence, raatekst: lest.raatekst.slice(0, 120) }, funnet: !!bil, bil, resolver });
      } catch (e) {
        console.error('les-skilt feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    if (method === 'POST' && path === '/api/image-resolver') {
      if (!hasImageResolverAccess(request, env)) return json({ ok: false, error: 'Ikke autorisert' }, 401);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      try {
        const parsed = validateImageResolverBody(body);
        if (typeof parsed === 'string') return json({ ok: false, error: parsed }, 400);

        const result = resolveImageObservations(parsed.candidates, parsed.observations, parsed.existingSignals);
        try {
          await env.FINNBILGLASS_DB.prepare(
            `INSERT INTO image_resolution_audit
             (query_ref, request_json, response_json, outcome, confidence, resolver_version)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            parsed.queryRef,
            JSON.stringify({
              candidates: parsed.candidates,
              observations: parsed.observations,
              existingSignals: parsed.existingSignals,
            }),
            JSON.stringify(result),
            result.outcome,
            result.fusion.confidence,
            result.resolverVersion,
          ).run();
        } catch (e) {
          console.error('image-resolver audit feilet:', e);
        }

        return json({ ok: true, queryRef: parsed.queryRef, ...result });
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'Ugyldig bilde-resolver payload' }, 400);
      }
    }

    if (method === 'POST' && path === '/api/verify-glass') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Ugyldig JSON' }, 400);
      }
      if (!isRecord(body)) return json({ ok: false, error: 'JSON-body påkrevd' }, 400);

      const imageRaw = typeof body.image === 'string' ? body.image : '';
      const manuellR43 = typeof body.r43 === 'string' ? body.r43.trim() : '';
      if (!imageRaw && !manuellR43) {
        return json({ ok: false, error: 'image (dataURL) eller r43 påkrevd' }, 400);
      }
      if (imageRaw && (imageRaw.length < 100 || !imageRaw.startsWith('data:image/'))) {
        return json({ ok: false, error: 'image må være dataURL (data:image/jpeg|png|webp;base64,...)' }, 400);
      }
      if (imageRaw.length > 7_000_000) {
        return json({ ok: false, error: 'Bildet er for stort (maks ~5 MB)' }, 413);
      }

      const queryRef =
        typeof body.queryRef === 'string' && body.queryRef.trim()
          ? body.queryRef.trim().slice(0, 120)
          : `verify-${crypto.randomUUID()}`;
      const roleRaw = body.role;
      const role: 'corner_marking' | 'full_glass' = roleRaw === 'corner_marking' || roleRaw === 'full_glass' ? roleRaw : 'corner_marking';
      const sid = sessionId(body, request);

      try {
        let observation: ImageObservation;
        if (imageRaw) {
          const provider = new WorkersAIVisionProvider(env.AI);
          const image = {
            id: `${queryRef}-img`,
            role,
            imageRef: imageRaw,
            mime: 'image/jpeg',
            source: 'customer' as const,
          };
          observation = await provider.observe({ image, candidateImages: [], prompt: '' });
        } else {
          // Manuell vei: kunden leste av nummeret selv — syntetisk observasjon.
          const r43v = manuellR43;
          observation = {
            imageId: `${queryRef}-manual`,
            role,
            modelVersion: 'manual-input-0.1',
            eurocodes: [],
            oemNumbers: [],
            r43Numbers: [{ value: r43v, confidence: 0.9, explanation: 'manuelt innskrevet av kunde' }],
            features: [],
            similarities: [],
            warnings: [],
          };
        }
        const imageSignals = observationToSignals(observation);
        const r43Norm = normalizeR43(observation.r43Numbers?.[0]?.value ?? '');

        // 1) ECE R43-oppslag i mappingen.
        let treff: Array<Record<string, unknown>> = [];
        if (r43Norm) {
          const { results } = await env.FINNBILGLASS_DB.prepare(
            `SELECT r43_nummer, landkode, eurokode, varenr, merke, modell, kilde, bekreftet
             FROM ece_r43 WHERE r43_nummer = ? ORDER BY bekreftet DESC, id ASC LIMIT 20`
          ).bind(r43Norm).all();
          treff = results as Array<Record<string, unknown>>;
          // Berik treffene med varenavn + sluttpris (tier) fra prislista.
          const varenrListe = treff
            .map((r) => r.varenr)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
            .slice(0, 20);
          if (varenrListe.length > 0) {
            const placeholders = varenrListe.map(() => '?').join(',');
            const { results: prisResult } = await env.FINNBILGLASS_DB.prepare(
              `SELECT varenr, varenavn, pris FROM glass_prisliste
               WHERE rad_type = 'glass' AND varenr IN (${placeholders})`
            ).bind(...varenrListe).all();
            const prisMap = new Map<string, { varenavn: string | null; pris: number | null }>();
            for (const row of prisResult as Array<Record<string, unknown>>) {
              prisMap.set(String(row.varenr), {
                varenavn: typeof row.varenavn === 'string' ? row.varenavn : null,
                pris: tierPris(typeof row.pris === 'number' ? row.pris : null),
              });
            }
            treff = treff.map((r) => {
              const info = prisMap.get(String(r.varenr));
              return info ? { ...r, varenavn: info.varenavn, pris: info.pris } : r;
            });
          }
          try {
            await env.FINNBILGLASS_DB.prepare(
              'INSERT INTO r43_sok_logg (r43_nummer, treff, kilde, query_ref, ip) VALUES (?, ?, ?, ?, ?)'
            ).bind(r43Norm, treff.length, 'photo', queryRef, request.headers.get('CF-Connecting-IP') ?? null).run();
          } catch {
            // søkelogg-feil må ikke knekke svaret
          }
        }

        // 2) Kandidater: ece_r43-treff + (valgfri) resolver-kjøring med bil-kontekst.
        const candidates: FusionCandidate[] = [];
        for (const rad of treff) {
          const varenr = typeof rad.varenr === 'string' ? rad.varenr : null;
          const eurokode = typeof rad.eurokode === 'string' ? rad.eurokode : null;
          candidates.push({
            glassId: `r43-${varenr ?? eurokode ?? '?'}`,
            eurocode: eurokode,
            oemNumbers: [],
            r43Numbers: [String(rad.r43_nummer)],
            features: {},
            sellable: true,
            priceTier: null,
            label: [rad.merke, rad.modell].filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ') || undefined,
          });
        }

        const harKontekst = typeof body.merke === 'string' && typeof body.modell === 'string';
        if (harKontekst) {
          const bil = validateBil({
            merke: body.merke,
            modell: body.modell,
            aar: body.aar ?? null,
            vin: typeof body.vin === 'string' ? body.vin : undefined,
            profil: {},
          });
          if (typeof bil !== 'string') {
            const resolver = await resolveFrontrute(env, bil);
            const koder = (resolver.kandidater ?? [])
              .slice(0, 25)
              .map((k) => k.eurokode)
              .filter((k): k is string => !!k);
            const r43Map = new Map<string, string[]>();
            if (koder.length > 0) {
              const placeholders = koder.map(() => '?').join(',');
              const { results } = await env.FINNBILGLASS_DB.prepare(
                `SELECT eurokode, r43_nummer FROM ece_r43 WHERE eurokode IN (${placeholders})`
              ).bind(...koder).all();
              for (const row of results as Array<Record<string, unknown>>) {
                const ek = String(row.eurokode);
                r43Map.set(ek, [...(r43Map.get(ek) ?? []), String(row.r43_nummer)]);
              }
            }
            for (const k of resolver.kandidater ?? []) {
              candidates.push({
                glassId: `res-${k.varenr}`,
                eurocode: k.eurokode ?? null,
                oemNumbers: [],
                r43Numbers: k.eurokode ? (r43Map.get(k.eurokode) ?? []) : [],
                features: {
                  rain_sensor: k.attributter.sensor ?? null,
                  antenna: k.attributter.antenne ?? null,
                  hud: k.attributter.hud ?? null,
                  camera: k.attributter.kamera ?? null,
                  solar_coated: k.attributter.coated ?? null,
                },
                sellable: true,
                priceTier: k.pris,
                label: k.varenavn ?? undefined,
              });
            }
          }
        }

        // 3) Fusion: 43R-bevis (0.95) + eventuelle katalog-/resolver-signaler.
        const fusion = candidates.length > 0 ? fuseEvidence(candidates, imageSignals) : null;

        // 4) Audit (sporbarhet — reproduserbar beslutning, bildet lagres ALDRI).
        try {
          await env.FINNBILGLASS_DB.prepare(
            `INSERT INTO image_resolution_audit
             (query_ref, request_json, response_json, outcome, confidence, resolver_version)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            queryRef,
            JSON.stringify({ role, harKontekst, bildeSha256: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imageRaw)).then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')) }),
            JSON.stringify({ observation, treff, fusion }),
            fusion?.outcome ?? 'FALLBACK',
            fusion?.confidence ?? 0,
            observation.modelVersion,
          ).run();
        } catch {
          // audit-feil må aldri knekke svaret
        }

        // Opplæring: lagre 43R-bildet + hva som ble lest/utfall (innlesingsfeil analyseres).
        await lagreOpplaeringBilde(env, {
          sessionId: sid,
          type: 'verify43r',
          imageDataUrl: imageRaw || undefined,
          lesing: {
            r43: r43Norm ? `43R-${r43Norm}` : null,
            modelVersion: observation.modelVersion,
            raatekst: observation.rawText?.slice(0, 300),
          },
          fasit: fusion?.outcome === 'PINPOINT' && fusion.winner
            ? { varenr: String(fusion.winner.glassId).replace(/^(r43|res)-/, ''), utfall: fusion.outcome }
            : null,
          utfall: fusion?.outcome === 'PINPOINT' ? 'ok' : r43Norm ? 'ikke_funnet' : 'feil',
        });

        const erIkkeNaerbilde = (observation.warnings ?? []).some((w) => /ikke et nærbilde|not a close/i.test(w));
        return json({
          ok: true,
          queryRef,
          r43Nummer: r43Norm ? `43R-${r43Norm}` : null,
          observasjon: observation,
          treff,
          fusion,
          melding: !r43Norm
            ? erIkkeNaerbilde
              ? 'Bildet ser ikke ut til å være et nærbilde av merkingen. Merket sitter nederst i hjørnet av frontruten (på førersiden) og er noen centimeter stort — zoom inn så merket fyller bildet, eller skriv nummeret manuelt.'
              : 'Fant ikke 43R-nummer i bildet. Prøv nytt bilde med bedre lys, eller skriv nummeret manuelt.'
            : treff.length === 0
              ? 'Vi kjenner ikke dette 43R-nummeret ennå — det kan være kopiglass eller et glass utenfor katalogen vår. Her er forslaget basert på bilen din.'
              : fusion?.outcome === 'PINPOINT'
                ? 'Bekreftet: dette er glasset som hører til nummeret du fotograferte.'
                : fusion?.outcome === 'VERIFY'
                  ? 'Nummeret stemmer med riktig glassfamilie — svar på spørsmålene for å lande eksakt glass.'
                  : 'Fant glass i samme godkjenningsfamilie.',
        });
      } catch (e) {
        console.error('verify-glass feilet:', e);
        return json({ ok: false, error: 'Intern feil' }, 500);
      }
    }

    // Statiske undersider for GEO/SEO (ren URL → .html): «Bilglass uten forsikring», «Personvern»
    const STATISKE_SIDER = ['/bilglass-uten-forsikring', '/personvern', '/om-oss'];
    if (method === 'GET' && STATISKE_SIDER.includes(path)) {
      const html = await env.ASSETS.fetch(new Request(url.origin + path + '.html'));
      if (html.ok) return html;
    }

    // Alt annet (/, index.html, styles.css, app.js, …) → statiske assets fra public/
    const asset = await env.ASSETS.fetch(request);
    // Pen 404 for HTML-navigasjon (ukjente sider) — assets gir ellers tom 404
    if (asset.status === 404 && (request.headers.get('Accept') || '').includes('text/html')) {
      const notFound = await env.ASSETS.fetch(new Request(url.origin + '/404'));
      if (notFound.ok) {
        return new Response(notFound.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }
    return asset;
  },
};