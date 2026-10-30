/**
 * email-ingest — innkommende e-post til support@finnbilglass.no (Email Routing).
 *
 * Flyt (Tom-mandat: «helt automatisk, alltid»):
 *   1. Parse melding + vedlegg (postal-mime).
 *   2. Match avsender mot åpen beta_inquiry → sak.
 *   3. Lagre bilde-vedlegg i R2 (opplaering-bucket, prefiks evidence/).
 *   4. Logg 'customer_reply'-event på saken med antall bilder + tekstutdrag.
 *
 * Grenser:
 *   — Aldri auto-svar fra handleren (human-in-the-loop, Tom svarer via /ops).
 *   — Aldri slett/endre noe — kun append (nye R2-objekter + timeline-event).
 *   — Vedlegg > 8 MB eller ikke-bildetyper lagres ikke (logges som note).
 */
import PostalMime, { type Email } from 'postal-mime';

export interface Env {
  FINNBILGLASS_DB: D1Database;
  OPPLAERING_BUCKET: R2Bucket;
  DEEPSEEK_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

const MAX_ATTACHMENT = 8 * 1024 * 1024;
const OK_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

interface Inquiry {
  id: number;
  kontakt: string;
  status: string;
}

async function finnSak(env: Env, from: string): Promise<Inquiry | null> {
  // Normaliser adresse (strip +alias og case)
  const addr = from.toLowerCase().split('+')[0];
  const rows = await env.FINNBILGLASS_DB.prepare(
    `SELECT id, kontakt, status FROM beta_inquiries
     WHERE lower(kontakt) = ?1 OR lower(kontakt) LIKE '%' || ?1
     ORDER BY CASE status WHEN 'NEW' THEN 0 WHEN 'CONTACTED' THEN 1 ELSE 2 END, id DESC
     LIMIT 1`
  ).bind(addr).all<Inquiry>();
  return rows.results?.[0] ?? null;
}

/**
 * Vision-analyse av bilde via DeepSeek-vision (primær) eller Gemini (fallback).
 * Returnerer strukturert utstyrsavlesning for matching mot glass_reference.
 */
async function analyseImageVision(env: Env, imageBytes: ArrayBuffer | Uint8Array, mime: string): Promise<{
  kamera: boolean;
  regnsensor: boolean;
  varmetrader: 'hele' | 'nederst' | 'kamerafelt' | 'ingen' | 'ukjent';
  hud: boolean;
  bracketFelt: boolean;
  prikkMonster: boolean;
  klarGlassflate: boolean;
  usikker: string[];
  raw: string;
}> {
  const key = env.DEEPSEEK_API_KEY;
  const b64 = Buffer.from(imageBytes).toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;

  const prompt = `Du er bilglass-ekspert. Analyser dette bildet av frontruteområdet bak innvendig speil (kamera/regnsensor-sone).
Returner KUN JSON (ingen forklaring, ingen markdown):

{
  "kamera": true/false,           // ser du en RUND LINSE (kameraøye) mot veien?
  "regnsensor": true/false,       // ser du en GEL-PUTE / firkantet sensor mot glasset?
  "varmetrader": "hele|nederst|kamerafelt|ingen|ukjent",  // tråder/felt: hele glasset / nederst (wiper park) / felt bak kamera / ingen synlige / ukjent
  "hud": true/false,              // SER DU HUD-projeksjon PÅ GLASS? (svart hvit bilde mot sjåfør) — NB: HUD er IKKE display oppå glasset
  "bracketFelt": true/false,      // SOLIDT SVART FELT / UTSparing (større enn mynt) der kameramodul festes — IKKE prikk-mønster
  "prikkMonster": true/false,     // PRIKK-MØNSTER (frit/halftone dots) BAK SPEIL («tredje solskjerm») — alene = IKKE bevis for kamera
  "klarGlassflate": true/false,   // ren klar glassflate bak speil = ingen kamera
  "usikker": ["..."],             // ting du ikke er sikker på
  "note": "kort beskrivelse"
}

VIKTIGE REGLER (Regel 5b/17):
- RUND LINSE synlig = kamera BEVIS.
- PRIKK-MØNSTER (frit-dots) alene = UKJENT (finnes på biler Uten kamera).
- SOLIDT SVART BRACKET-FELT = sterk indikasjon på kamera-montering.
- HUD vises ALDRI på glasset (projeksjon fra dash) → aldri true fra bilde.
- Varmefilm (usynlig laminat) = IKKE synlig — spør kunden om knapp for strøm til frontrute.`;

  // DeepSeek-vision
  if (key) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash-vision-exp',
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl }},
          ]}],
          max_tokens: 4000,
          temperature: 0.1,
        })
      });
      if (res.ok) {
        const data: any = await res.json();
        const msg = data.choices?.[0]?.message;
        const content = msg?.content || '';
        const reasoning = msg?.reasoning_content || '';
        const best = reasoning.length > content.length ? reasoning : content;
        const jsonMatch = best.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch { /* fall through to gemini */ }
  }

  // Gemini-vision (modell-kjede verifisert 2026-08-24; deepseek = 402 tom kreditt, gemini-2.0-flash = 404 pensjonert)
  // Dobbeltkall-konsistenssjekk: samme bilde 2x — avvis hvis kjernefunn strider (vision-hallusinasjons-guard).
  const gemKey = env.GOOGLE_API_KEY;
  if (gemKey) {
    const MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash', 'gemini-flash-latest'];
    const callOnce = async (): Promise<any | null> => {
      for (const model of MODELS) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
            })
          });
          if (!res.ok) continue;
          const data: any = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } catch { /* next model */ }
      }
      return null;
    };
    try {
      const first = await callOnce();
      if (first) {
        const second = await callOnce();
        if (second) {
          // Konsistens: hvis kamera/regnsensor/bracket strider → usikker, aldri bevis
          const coreKeys = ['kamera', 'regnsensor', 'bracketFelt'] as const;
          const conflicting = coreKeys.some(k => !!first[k] !== !!second[k]);
          if (conflicting) {
            return { ...first, kamera: false, regnsensor: false, bracketFelt: false,
              usikker: [...(first.usikker ?? []), 'INKONSISTENT: to vision-kall gir ulike kjernefunn — behandles som UKJENT'] };
          }
        }
        return first;
      }
    } catch { /* fall through */ }
  }

  // Fallback: ukjent
  return { kamera: false, regnsensor: false, varmetrader: 'ukjent', hud: false, bracketFelt: false, prikkMonster: false, klarGlassflate: false, usikker: ['vision_unavailable'], raw: '' };
}

export async function handleInboundEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const raw = await new Response(message.raw).arrayBuffer();
  let parsed: Email;
  try {
    parsed = await PostalMime.parse(raw);
  } catch {
    message.setReject('Kunne ikke lese meldingen');
    return;
  }

  const sak = await finnSak(env, message.from);

  // Lagre bildervedlegg i R2 (uavhengig av om vi finner saken — aldri mist bevis)
  const saved: string[] = [];
    const rejected: string[] = [];
    const visionResults: any[] = [];
    for (const att of parsed.attachments ?? []) {
      if (!OK_MIME.has(att.mimeType)) { rejected.push(`${att.filename}: type ${att.mimeType}`); continue; }
      const size = att.content instanceof ArrayBuffer ? att.content.byteLength :
                   att.content instanceof Uint8Array ? att.content.length :
                   typeof att.content === 'string' ? Buffer.from(att.content, 'base64').length : 0;
      if (size > MAX_ATTACHMENT) { rejected.push(`${att.filename}: >8MB`); continue; }
      const key = `evidence/email/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${(att.filename || 'bilde.jpg').replace(/[^\\w.-]/g, '_')}`;
      await env.OPPLAERING_BUCKET.put(key, att.content!, {
        httpMetadata: { contentType: att.mimeType },
        customMetadata: { from: message.from, inquiryId: String(sak?.id ?? 'ukjent') },
      });
      saved.push(key);

      // Vision-analyse (async, men vi venter på alle før vi logger)
      try {
        const obj = await env.OPPLAERING_BUCKET.get(key);
        if (obj) {
          const bytes = await obj.arrayBuffer();
          const vision = await analyseImageVision(env, bytes, att.mimeType);
          visionResults.push({ r2Key: key, filename: att.filename, ...vision });
        }
      } catch (e) {
        visionResults.push({ r2Key: key, filename: att.filename, error: String(e), usikker: ['vision_error'] });
      }
    }

    const tekst = (parsed.text || '').slice(0, 500);
    const visionSummary = visionResults.length
      ? visionResults.map(v => {
          const parts: string[] = [];
          if (v.kamera) parts.push('kamera');
          if (v.regnsensor) parts.push('regnsensor');
          if (v.varmetrader !== 'ukjent' && v.varmetrader !== 'ingen') parts.push(`varme:${v.varmetrader}`);
          if (v.bracketFelt) parts.push('bracket');
          if (v.prikkMonster) parts.push('prikker');
          if (v.klarGlassflate) parts.push('klar');
          if (v.usikker?.length) parts.push(`usikker:${v.usikker.join(',')}`);
          return `${v.filename}: ${parts.join(', ') || 'ingen funn'}`;
        }).join(' | ')
      : '';
    const note = sak
      ? `E-post mottatt: ${saved.length} bilde(r) lagret${rejected.length ? `, ${rejected.length} avvist` : ''}${visionSummary ? ` — VISION: ${visionSummary}` : ''}${tekst ? ` — «${tekst}»` : ''}`
      : `E-post fra ukjent avsender (${message.from}): ${saved.length} bilde(r) i R2${visionSummary ? ` — VISION: ${visionSummary}` : ''}${tekst ? ` — «${tekst}»` : ''}`;

    if (sak) {
      await env.FINNBILGLASS_DB.prepare(
        `INSERT INTO beta_inquiry_events
         (event_id, inquiry_id, event_type, status, note, created_by, meta_json)
         VALUES (?1, ?2, 'note', ?3, ?4, 'email-ingest', ?5)`
      ).bind(
        `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sak.id,
        sak.status,
        note,
        JSON.stringify({ r2Keys: saved, rejected, messageId: message.headers.get('message-id'), vision: visionResults }),
      ).run();
    }

  // Alltid forward til Tom (aldri mist e-posten) — handleren er additiv.
  await message.forward('tomarnejensen@gmail.com');
}
