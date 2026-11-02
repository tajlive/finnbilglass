/**
 * R2-inventar (kun lesing).
 *
 * Sammenligner objektene i bildearkivet med radene i evidence_case_images og
 * rapporterer:
 *   - antall objekter i R2 og antall rader i D1
 *   - foreldreløse filer (i R2, ikke i D1)
 *   - manglende filer (i D1, ikke i R2)
 *   - total størrelse
 *
 * Sletter ingenting. Brukes til dry-run før en eventuell retensjonsjobb.
 * Ingen persondata eller objektinnhold leses — kun nøkkel, størrelse og tid.
 */
import type { Env } from '../types';

const MAKS_OBJEKTER = 5000; // beskytt mot enorme bøtter i én forespørsel

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function handleR2Inventar(env: Env): Promise<Response> {
  if (!env.OPPLAERING_BUCKET) return json({ ok: false, error: 'R2_IKKE_KONFIGURERT' }, 503);

  const db = env.ENVIRONMENT === 'staging' ? env.FINNBILGLASS_STAGING_AUTH : env.FINNBILGLASS_DB;
  if (!db) return json({ ok: false, error: 'DB_IKKE_KONFIGURERT' }, 503);

  // 1) Objekter i R2 (kun nøkkel/størrelse/tid).
  const r2Nokler = new Map<string, number>();
  let cursor: string | undefined;
  let totalBytes = 0;
  let avbrutt = false;

  do {
    const side = await env.OPPLAERING_BUCKET.list({ prefix: 'evidence-capture/', limit: 500, cursor });
    for (const o of side.objects) {
      r2Nokler.set(o.key, o.size);
      totalBytes += o.size;
    }
    cursor = side.truncated ? side.cursor : undefined;
    if (r2Nokler.size >= MAKS_OBJEKTER) {
      avbrutt = true;
      break;
    }
  } while (cursor);

  // 2) Nøkler fra D1.
  let dbNokler: string[] = [];
  try {
    const rader = await db.prepare('SELECT r2_key FROM evidence_case_images WHERE r2_key IS NOT NULL').all<{ r2_key: string }>();
    dbNokler = (rader.results ?? []).map((r) => r.r2_key);
  } catch (e) {
    return json({ ok: false, error: 'DB_LES_FEILET', detalj: (e as Error).message }, 500);
  }
  const dbSett = new Set(dbNokler);

  // 3) Sammenlign.
  const foreldrelose = [...r2Nokler.keys()].filter((k) => !dbSett.has(k));
  const manglende = dbNokler.filter((k) => !r2Nokler.has(k));

  return json({
    ok: true,
    dry_run: true,
    slettet: 0,
    avbrutt_ved_tak: avbrutt,
    r2: { objekter: r2Nokler.size, bytes: totalBytes, mib: Math.round((totalBytes / 1048576) * 10) / 10 },
    d1: { rader: dbNokler.length, unike: dbSett.size },
    foreldrelose: { antall: foreldrelose.length, eksempel: foreldrelose.slice(0, 10) },
    manglende: { antall: manglende.length, eksempel: manglende.slice(0, 10) },
  });
}
