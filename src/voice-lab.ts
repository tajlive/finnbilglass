import type { Env } from './types';
import { svvLookup } from './svv';

export const VOICE_NAME = 'marin';
export const VOICE_NAMES = ['marin', 'coral', 'shimmer', 'sage'] as const;
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
export const VOICE_PROMPT_VERSION = 'fbg-no-v5-nettbutikk-kun-glass';
export const VOICE_SCENARIOS = ['ny_frontrute', 'ny_dorrute', 'ny_siderute', 'ny_bakrute', 'ny_panoramaglass', 'ukjent_glass'] as const;
export const VOICE_STYLES = ['varm', 'kort', 'rolig'] as const;
type VoiceScenario = typeof VOICE_SCENARIOS[number];
type VoiceStyle = typeof VOICE_STYLES[number];
type VoiceName = typeof VOICE_NAMES[number];
export const VOICE_INSTRUCTIONS = `Du er Arch aXN, den norske stemmeassistenten for Finnbilglass.
Snakk alltid naturlig norsk bokmål med en varm, rolig og profesjonell kvinnelig stemme.
Finnbilglass er en landsdekkende nettbutikk som selger bilglass og relevant tilbehør til privatpersoner og næringskunder som betaler selv. Hold deg til denne oppgaven.
Ikke fortell kunder hvilken grossist, lagerleverandør eller intern samarbeidspartner Finnbilglass bruker.
Hold hvert svar kort og still ett spørsmål om gangen. Ikke oppgi eller antyd en pris før et manuelt pristilbud er laget.
Samle inn kundetype, registreringsnummer, hvilket glass kunden trenger, relevante egenskaper som kamera, sensor, varme, HUD, antenne eller toning, om glasset skal sendes til kunden eller et verksted, navn, kontaktmåte og leveringssted.
Finnbilglass selger ikke montering, bestiller ikke montering og er ikke part i kundens avtale med et verksted. Dersom kunden ønsker hjelp til montering, kan du forklare at glasset kan sendes til et avtaleverksted, men kunden avtaler og betaler eventuell montering direkte med verkstedet.
Ikke foreslå reparasjon av steinsprut. Dersom kunden spør om reparasjon, forklar kort at Finnbilglass bare selger nytt glass, og spør om kunden ønsker pristilbud på nytt glass.
For vanlige norske biler er registreringsnummeret som regel to bokstaver og fem tall, for eksempel SU 18018 eller AB 12345. Be kunden lese det sakte hvis det er uklart. Personlige, eldre eller spesielle kjennemerker kan avvike, men da skal du bekrefte ekstra tydelig.
Les alltid registreringsnummer tegn for tegn og be om tydelig bekreftelse før lookup_vehicle. Hvis nummeret ikke ligner to bokstaver og fem tall, spør om det er personlig eller spesielt kjennemerke. Når kunden uttrykkelig har bekreftet dette, kall verktøyet med special_plate satt til true.
Les navn og kontaktinformasjon tilbake før draft_inquiry. Ikke gjett manglende informasjon.
Etter to mislykkede forsøk foreslår du menneskelig hjelp.
Du kan bare lage et demo-utkast for manuell oppfølging. Finnbilglass tilbyr ikke timebestilling, og du skal aldri spørre om, foreslå eller love et tidspunkt. Du kan heller aldri bestille, ta imot kortopplysninger, gjennomføre betaling eller velge glass. Betaling skjer senere i nettbutikken med Klarna eller betalingskort.
Når alt er bekreftet, oppsummer kort og si at forespørselen om pristilbud er klar for manuell kontroll.`;

const SCENARIO_INSTRUCTIONS: Record<VoiceScenario, string> = {
  ny_frontrute: 'Scenario: Kunden trenger ny frontrute og vil ha pristilbud. Avklar kamera, regnsensor, varme, HUD, antenne, toning og hvor glasset skal leveres.',
  ny_dorrute: 'Scenario: Kunden trenger ny dørrute og vil ha pristilbud. Avklar side, foran eller bak, toning og hvor glasset skal leveres.',
  ny_siderute: 'Scenario: Kunden trenger ny fast siderute og vil ha pristilbud. Avklar side, nøyaktig plassering, toning og hvor glasset skal leveres.',
  ny_bakrute: 'Scenario: Kunden trenger ny bakrute og vil ha pristilbud. Avklar varme, antenne, toning og hvor glasset skal leveres.',
  ny_panoramaglass: 'Scenario: Kunden trenger nytt panoramaglass og vil ha pristilbud. Avklar nøyaktig plassering, om glasset kan åpnes og hvor glasset skal leveres.',
  ukjent_glass: 'Scenario: Kunden vet ikke nøyaktig hvilket glass som trengs, men vil ha pristilbud på nytt glass. Hjelp kunden å beskrive plasseringen uten å velge glassvariant.',
};
const STYLE_INSTRUCTIONS: Record<VoiceStyle, string> = {
  varm: 'Talestil: Varm, tillitsvekkende og profesjonell. Bruk korte, naturlige setninger.',
  kort: 'Talestil: Kort og effektiv. Unngå småprat og bruk færrest mulig ord uten å virke brå.',
  rolig: 'Talestil: Rolig og pedagogisk. Snakk litt saktere og forklar neste steg enkelt.',
};

function choice<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(value as T[number]) ? value as T[number] : fallback;
}

export function realtimeSession(model = DEFAULT_REALTIME_MODEL, scenario: VoiceScenario = 'ny_frontrute', style: VoiceStyle = 'varm', voice: VoiceName = VOICE_NAME) {
  return {
    type: 'realtime', model, output_modalities: ['audio'],
    instructions: `${VOICE_INSTRUCTIONS}\n${SCENARIO_INSTRUCTIONS[scenario]}\n${STYLE_INSTRUCTIONS[style]}\nPromptversjon: ${VOICE_PROMPT_VERSION}.`,
    audio: {
      input: {
        turn_detection: { type: 'semantic_vad' },
      },
      output: { voice },
    },
    tools: [
      { type: 'function', name: 'lookup_vehicle', description: 'Slå opp bilen etter at registreringsnummeret er uttrykkelig bekreftet.', parameters: { type: 'object', additionalProperties: false, properties: { regnr: { type: 'string' }, confirmed: { type: 'boolean' }, special_plate: { type: 'boolean', description: 'True bare når kunden uttrykkelig har bekreftet at dette er et personlig, eldre eller spesielt kjennemerke.' } }, required: ['regnr', 'confirmed'] } },
      { type: 'function', name: 'draft_inquiry', description: 'Lagre en ikke-bindende forespørsel om pristilbud på nytt glass etter opplesing og bekreftelse.', parameters: { type: 'object', additionalProperties: false, properties: { session_id: { type: 'string' }, regnr: { type: 'string' }, navn: { type: 'string' }, kontakt: { type: 'string' }, sted: { type: 'string' }, skade: { type: 'string', description: 'Kundetype, hvilket nytt glass kunden trenger, relevante egenskaper og om glasset skal leveres til kunden eller et verksted.' }, confirmed: { type: 'boolean' }, special_plate: { type: 'boolean', description: 'True bare når kunden uttrykkelig har bekreftet at dette er et personlig, eldre eller spesielt kjennemerke.' } }, required: ['session_id', 'regnr', 'navn', 'kontakt', 'skade', 'confirmed'] } },
    ], tool_choice: 'auto', max_output_tokens: 600,
  };
}

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cleanRegnr = (value: unknown) => typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) : '';
const isLikelyNorwegianCarRegnr = (regnr: string) => /^[A-Z]{2}\d{5}$/.test(regnr);
const isConfirmedSpecialRegnr = (regnr: string, specialPlate: unknown) => specialPlate === true && /^[A-Z0-9]{2,10}$/.test(regnr);

export async function createVoiceSession(request: Request, env: Env): Promise<Response> {
  if (env.VOICE_LAB_ENABLED !== 'true') return response({ ok: false, error: 'Stemmelaben er slått av.' }, 503);
  if (!env.OPENAI_API_KEY) return response({ ok: false, error: 'OpenAI API-nøkkel mangler.' }, 503);
  const sdp = await request.text();
  if (!sdp.startsWith('v=0') || sdp.length > 100_000) return response({ ok: false, error: 'Ugyldig WebRTC-tilbud.' }, 400);
  const sessionId = crypto.randomUUID(), model = env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const scenario = choice(request.headers.get('X-Voice-Scenario'), VOICE_SCENARIOS, 'ny_frontrute');
  const style = choice(request.headers.get('X-Voice-Style'), VOICE_STYLES, 'varm');
  const voice = choice(request.headers.get('X-Voice-Name'), VOICE_NAMES, VOICE_NAME);
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(realtimeSession(model, scenario, style, voice)));
  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
  if (!upstream.ok) {
    const upstreamError = (await upstream.text().catch(() => '')).slice(0, 500);
    console.error('Realtime session feilet', upstream.status, upstreamError);
    return response({ ok: false, error: `Kunne ikke starte stemmen (OpenAI ${upstream.status}).` }, 502);
  }
  try { await env.FINNBILGLASS_DB.prepare('INSERT INTO voice_sessions (session_id, started_at, status, model, voice, scenario, style, prompt_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(sessionId, Date.now(), 'ACTIVE', model, voice, scenario, style, VOICE_PROMPT_VERSION).run(); }
  catch (error) { console.error('voice_sessions logging feilet', error); }
  return new Response(await upstream.text(), { status: 201, headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store', 'X-Voice-Session-Id': sessionId } });
}

export async function voiceTool(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return response({ ok: false, error: 'Ugyldig JSON.' }, 400); }
  const name = cleanText(body.name, 40), args = body.arguments && typeof body.arguments === 'object' ? body.arguments as Record<string, unknown> : {};
  if (name === 'lookup_vehicle') {
    const regnr = cleanRegnr(args.regnr);
    if (!regnr || args.confirmed !== true) return response({ ok: false, error: 'Registreringsnummeret må bekreftes først.' }, 409);
    if (!isLikelyNorwegianCarRegnr(regnr) && !isConfirmedSpecialRegnr(regnr, args.special_plate)) return response({ ok: false, error: 'Registreringsnummeret ser ikke ut som vanlig norsk bilformat. Be kunden bekrefte sakte: to bokstaver og fem tall, eller bekrefte uttrykkelig at det er et personlig, eldre eller spesielt kjennemerke.' }, 422);
    const bil = await svvLookup(regnr, env.SVV_API_KEY).catch(() => null);
    return response({ ok: true, regnr, found: !!bil, vehicle: bil ? { merke: bil.merke, modell: bil.modell, aar: bil.aar } : null });
  }
  if (name === 'draft_inquiry') {
    const sid = cleanText(args.session_id, 64), regnr = cleanRegnr(args.regnr), navn = cleanText(args.navn, 100), kontakt = cleanText(args.kontakt, 160), skade = cleanText(args.skade, 500);
    if (!sid || !regnr || navn.length < 2 || !kontakt || !skade || args.confirmed !== true) return response({ ok: false, error: 'Alle opplysninger må være utfylt og bekreftet.' }, 409);
    if (!isLikelyNorwegianCarRegnr(regnr) && !isConfirmedSpecialRegnr(regnr, args.special_plate)) return response({ ok: false, error: 'Registreringsnummeret må kontrolleres på nytt før utkastet lagres. Vanlig bilformat er to bokstaver og fem tall; andre kjennemerker må bekreftes uttrykkelig som spesielle.' }, 422);
    if (!await env.FINNBILGLASS_DB.prepare('SELECT session_id FROM voice_sessions WHERE session_id = ?').bind(sid).first()) return response({ ok: false, error: 'Ukjent eller utløpt stemmeøkt.' }, 404);
    const draft = { session_id: sid, regnr, navn, kontakt, sted: cleanText(args.sted, 120), skade, confirmed: 1, updated_at: Date.now() };
    await env.FINNBILGLASS_DB.prepare(`INSERT INTO voice_drafts (session_id,regnr,navn,kontakt,sted,skade,confirmed,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET regnr=excluded.regnr,navn=excluded.navn,kontakt=excluded.kontakt,sted=excluded.sted,skade=excluded.skade,confirmed=excluded.confirmed,updated_at=excluded.updated_at`).bind(draft.session_id,draft.regnr,draft.navn,draft.kontakt,draft.sted,draft.skade,draft.confirmed,draft.updated_at).run();
    return response({ ok: true, draft, message: 'Demo-utkast lagret. Ingen kundehenvendelse er opprettet.' });
  }
  return response({ ok: false, error: 'Verktøyet er ikke tillatt.' }, 403);
}

export async function closeVoiceSession(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown> = {}; try { body = await request.json() as Record<string, unknown>; } catch {}
  const sid = cleanText(body.session_id, 64), duration = Math.max(0, Math.min(Number(body.duration_ms) || 0, 3_600_000));
  if (!sid) return response({ ok: false, error: 'Mangler session_id.' }, 400);
  await env.FINNBILGLASS_DB.prepare('UPDATE voice_sessions SET ended_at=?,status=?,duration_ms=?,result=?,error_code=? WHERE session_id=?').bind(Date.now(), body.error_code ? 'ERROR' : 'COMPLETED', duration, cleanText(body.result, 80) || null, cleanText(body.error_code, 80) || null, sid).run();
  return response({ ok: true });
}

export async function voiceSummary(env: Env): Promise<Response> {
  const rows = await env.FINNBILGLASS_DB.prepare(`SELECT s.session_id,s.started_at,s.ended_at,s.status,s.model,s.voice,s.scenario,s.style,s.prompt_version,s.duration_ms,s.result,d.regnr,d.navn,d.kontakt,d.sted,d.skade,d.confirmed FROM voice_sessions s LEFT JOIN voice_drafts d ON d.session_id=s.session_id ORDER BY s.started_at DESC LIMIT 50`).all();
  return response({ ok: true, sessions: rows.results });
}
