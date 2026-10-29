/** Commercial outcome ledger. Does not write inquiry status, SKU, fitment or price catalogs. */
export const COMMERCIAL_STAGES = ['OPEN', 'BOOKED', 'FULFILLED', 'PAID', 'LOST'] as const;
export interface CommercialInput {
  eventId: string; version: number; stage: string; delivery: string; source: string;
  followUp: string; paidOn: string; revenueOre: number; directCostOre: number;
  incremental: boolean; attribution: string; note: string; actor: string;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Ugyldig tekstfelt.');
  return value.trim();
}
function date(value: unknown): string {
  const s = text(value, 10);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s)) throw new Error('Ugyldig dato.');
  return s;
}
function ore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new Error('Beløp må være 0–1 000 000 kr, angitt i hele øre.');
  return value;
}
export function validateCommercial(body: unknown): CommercialInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ugyldige data.');
  const b = body as Record<string, unknown>;
  const eventId = text(b.eventId,80), stage = text(b.stage,20), delivery = text(b.delivery,20), source = text(b.source,10);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(eventId) || typeof b.version !== 'number' || !Number.isSafeInteger(b.version) || b.version < 0) throw new Error('Ugyldig versjon eller hendelses-ID.');
  if (!(COMMERCIAL_STAGES as readonly string[]).includes(stage) || !['UNKNOWN','GLASS_ONLY','PARTNER_INSTALL'].includes(delivery) || !['WEB','PHONE','MANUAL','DEMO'].includes(source)) throw new Error('Velg gyldig status, leveranse og kilde.');
  const actor = text(b.actor,64), note = text(b.note,600), attribution = text(b.attribution,600);
  if (actor.length < 2 || !note) throw new Error('Ansvarlig og endringsnotat er påkrevd.');
  if (typeof b.incremental !== 'boolean' || (b.incremental && !attribution)) throw new Error('Ekstra oppdrag må begrunnes.');
  const paidOn = date(b.paidOn);
  if (stage === 'PAID' && !paidOn) throw new Error('Registrer betalingsdato.');
  if (paidOn > new Date().toISOString().slice(0,10)) throw new Error('Betalingsdato kan ikke være i fremtiden.');
  return { eventId, version:b.version, stage, delivery, source, followUp:date(b.followUp), paidOn, revenueOre:ore(b.revenueOre), directCostOre:ore(b.directCostOre), incremental:b.incremental, attribution, note, actor };
}
export interface CommercialRow {
  event_id: string; inquiry_id: number; version: number; stage: string; delivery: string; source: string;
  follow_up: string; paid_on: string; revenue_ore: number; direct_cost_ore: number; incremental: number;
  attribution: string; note: string; actor: string; created_at: number;
}
const latest = `WITH latest AS (SELECT e.* FROM inquiry_commercial_events e WHERE NOT EXISTS
  (SELECT 1 FROM inquiry_commercial_events newer WHERE newer.inquiry_id=e.inquiry_id AND newer.version>e.version))`;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
export async function commercialRoute(request: Request, db: D1Database, id: number | null): Promise<Response> {
  try {
    if (id === null && request.method === 'GET') {
      const rows = await db.prepare(`${latest} SELECT l.*, i.navn, i.regnr FROM latest l JOIN beta_inquiries i ON i.id=l.inquiry_id ORDER BY CASE WHEN l.follow_up='' THEN 1 ELSE 0 END, l.follow_up, l.created_at DESC LIMIT 100`).all();
      const totals = await db.prepare(`${latest} SELECT COUNT(*) AS recorded,
        SUM(CASE WHEN source='DEMO' THEN 1 ELSE 0 END) AS demos,
        SUM(CASE WHEN source!='DEMO' AND stage='PAID' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN source!='DEMO' AND stage='PAID' THEN revenue_ore ELSE 0 END) AS revenueOre,
        SUM(CASE WHEN source!='DEMO' AND stage='PAID' THEN revenue_ore-direct_cost_ore ELSE 0 END) AS contributionOre,
        SUM(CASE WHEN source!='DEMO' AND stage='PAID' AND incremental=1 THEN revenue_ore-direct_cost_ore ELSE 0 END) AS incrementalOre
        FROM latest`).first();
      return response({ ok:true, rows:rows.results, totals, listLimit:100, scope:'Alle registrerte salgsutfall, hele perioden. Demo er utelatt fra økonomien.' });
    }
    if (!id || !Number.isSafeInteger(id)) return response({ok:false,error:'Ugyldig henvendelse.'},400);
    const inquiry = await db.prepare('SELECT id, navn, regnr FROM beta_inquiries WHERE id=?').bind(id).first();
    if (!inquiry) return response({ok:false,error:'Henvendelsen finnes ikke.'},404);
    const current = await db.prepare('SELECT * FROM inquiry_commercial_events WHERE inquiry_id=? ORDER BY version DESC LIMIT 1').bind(id).first<CommercialRow>();
    if (request.method === 'GET') {
      const history = await db.prepare('SELECT version,stage,note,actor,created_at FROM inquiry_commercial_events WHERE inquiry_id=? ORDER BY version DESC LIMIT 20').bind(id).all();
      return response({ok:true,inquiry,current,history:history.results});
    }
    if (request.method !== 'POST') return response({ok:false,error:'Metoden er ikke støttet.'},405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return response({ok:false,error:'JSON kreves.'},415);
    // Bound the request even when Content-Length is absent.
    const reader = request.body?.getReader(); let raw = '', length = 0; const decoder = new TextDecoder();
    if (!reader) return response({ok:false,error:'Mangler data.'},400);
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 8192) { await reader.cancel(); return response({ok:false,error:'For mye data.'},413); } raw += decoder.decode(part.value,{stream:true}); }
    raw += decoder.decode();
    let input: CommercialInput;
    try { input = validateCommercial(JSON.parse(raw)); } catch (e) { return response({ok:false,error:e instanceof Error ? e.message : 'Ugyldige data.'},400); }
    const retry = await db.prepare('SELECT * FROM inquiry_commercial_events WHERE event_id=?').bind(input.eventId).first<CommercialRow>();
    if (retry) {
      const same = retry.inquiry_id === id && retry.version === input.version + 1 && retry.stage === input.stage
        && retry.delivery === input.delivery && retry.source === input.source && retry.follow_up === input.followUp
        && retry.paid_on === input.paidOn && retry.revenue_ore === input.revenueOre && retry.direct_cost_ore === input.directCostOre
        && retry.incremental === (input.incremental ? 1 : 0) && retry.attribution === input.attribution
        && retry.note === input.note && retry.actor === input.actor;
      return same ? response({ok:true,replayed:true}) : response({ok:false,error:'Hendelses-ID er allerede brukt med andre data. Åpne saken på nytt.'},409);
    }
    if (input.version !== (current?.version ?? 0)) return response({ok:false,error:'Saken er endret. Åpne salgsutfallet på nytt før du lagrer.'},409);
    if (current && input.source !== current.source) return response({ok:false,error:'Kilden kan ikke endres etter første registrering.'},400);
    const nextVersion = input.version + 1;
    const inserted = await db.prepare(`INSERT INTO inquiry_commercial_events
      (event_id,inquiry_id,version,stage,delivery,source,follow_up,paid_on,revenue_ore,direct_cost_ore,incremental,attribution,note,actor,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(input.eventId,id,nextVersion,input.stage,input.delivery,input.source,input.followUp,input.paidOn,input.revenueOre,input.directCostOre,input.incremental?1:0,input.attribution,input.note,input.actor,Date.now()).run();
    if (!inserted.meta.changes) return response({ok:false,error:'En annen lagring kom først. Åpne salgsutfallet på nytt.'},409);
    return response({ok:true,version:nextVersion},201);
  } catch { return response({ok:false,error:'Salgsoppfølging er utilgjengelig. Kontroller at migrasjon 0028 er installert.'},503); }
}
