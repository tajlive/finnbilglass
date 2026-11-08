const FIXTURE_TABLES = Object.freeze({
  ground_truth: {
    columns: ['make', 'model', 'year', 'frontrute_eurocode', 'confidence'],
    order: ['make', 'model', 'year', 'frontrute_eurocode', 'confidence'],
  },
  glass_prisliste: {
    columns: ['varenr', 'varenavn', 'kommentar', 'pris', 'eurokode', 'rad_type'],
    order: ['varenr', 'eurokode', 'rad_type', 'varenavn', 'pris', 'kommentar'],
  },
});

export function buildPageQuery(table, limit, offset) {
  const spec = FIXTURE_TABLES[table];
  if (!spec) throw new Error(`unsupported fixture table: ${table}`);
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('invalid page');
  }
  return `SELECT ${spec.columns.join(', ')} FROM ${table} ORDER BY ${spec.order.join(', ')} LIMIT ${limit} OFFSET ${offset}`;
}

export function buildWranglerArgs(sql) {
  if (typeof sql !== 'string' || !/^SELECT\b/i.test(sql.trim())) throw new Error('SELECT-only query required');
  return ['d1', 'execute', 'finnbilglass-staging-catalog', '--config', 'wrangler.staging.toml', '--remote', '--json', '--command', sql];
}

export function parseReadOnlyD1Result(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error('invalid wrangler JSON'); }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length !== 1 || entries[0]?.success !== true || !Array.isArray(entries[0]?.results)) {
    throw new Error('invalid wrangler D1 response');
  }
  const meta = entries[0].meta ?? {};
  if (meta.changed_db !== false || Number(meta.changes ?? 0) !== 0 || Number(meta.rows_written ?? 0) !== 0) {
    throw new Error('read-only D1 assertion failed');
  }
  return entries[0].results;
}
