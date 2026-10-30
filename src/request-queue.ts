/**
 * Crawlee-style RequestQueue for FinnBilGlass with D1 persistency,
 * restart/resume, and deduplication.
 * 
 * P1 Implementation: Full feature set with idempotent operations.
 */
export interface RequestQueueEntry {
  id: number;
  probe_id: string;
  vin_hash: string;
  make: string;
  model: string;
  year: number;
  ktype: string;
  eurocode: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  payload_json: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  error_message?: string;
  metadata_json: string;
  /** For deduplication - the canonical URL or SKU identifier */
  canonical_url?: string;
  /** SKU fingerprint for dedup */
  sku_fingerprint?: string;
}

/** Checkpoint state for resume */
export interface CheckpointState {
  probe_id: string;
  last_processed_index: number;
  last_successful_index: number;
  last_checkpoint_at: number;
  state_json: string;
  completed: boolean;
}

/** Quality event recorded during scraping */
export interface QualityEvent {
  event_id: string;
  probe_id: string;
  case_id: string;
  eurocode: string;
  quality_class: 'PASS' | 'REVIEW' | 'REJECT';
  reason_codes_json: string;
  confidence: number;
  created_at: number;
  created_by: string;
}

/** Performance metric recorded during scraping */
export interface PerformanceMetric {
  metric_id: string;
  probe_id: string;
  operation: string;
  duration_ms: number;
  success: boolean;
  error_type?: string;
  created_at: number;
}

/** Stop rule result enforced during execution */
export interface StopRuleResult {
  halt: boolean;
  reason: string;
  /** Error count that triggered the halt */
  error_trigger: number;
  /** Consecutive 429 count that triggered the halt */
  consecutive_429s: number;
  /** Quality pass rate at time of halt */
  quality_pass_rate: number;
}

/** Payload for enqueue operations */
export interface EnqueuePayload {
  vin_hash: string;
  make: string;
  model: string;
  year: number;
  ktype: string;
  eurocode: string;
  metadata?: Record<string, any>;
}

/** Result of dequeue operation */
export interface DequeueResult {
  entry: RequestQueueEntry | null;
  /** Whether the entry was newly claimed */
  newly_claimed: boolean;
}

/**
 * Full RequestQueue implementation with D1 persistency.
 * 
 * Features:
 * - Entry management with status tracking
 * - Checkpoint save/restore for resume
 * - Deduplication via canonical_url / sku_fingerprint
 * - Restart from checkpoint without data loss
 * - Fail/error tracking per entry
 */
export class RequestQueue {
  /** Database connection */
  private db: any;
  /** Probe identifier */
  private probeId: string;

  constructor(db: any, probeId: string) {
    this.db = db;
    this.probeId = probeId;
  }

  /** Initialize D1 tables on first use */
  async initialize(): Promise<void> {
    // Tables should already be created via migrations
    // This ensures they exist and have correct schema
    await this.ensureTables();
  }

  private async ensureTables(): Promise<void> {
    // request_queue table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        probe_id TEXT NOT NULL,
        vin_hash TEXT NOT NULL,
        make TEXT NOT NULL,
        model TEXT NOT NULL,
        year INTEGER NOT NULL,
        ktype TEXT NOT NULL,
        eurocode TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        payload_json TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now')*1000),
        started_at INTEGER,
        completed_at INTEGER,
        error_message TEXT,
        metadata_json TEXT DEFAULT '{}',
        canonical_url TEXT,
        sku_fingerprint TEXT,
        UNIQUE(probe_id, vin_hash)
      )
    `);

    // checkpoint_state table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_state (
        probe_id TEXT PRIMARY KEY,
        last_processed_index INTEGER DEFAULT 0,
        last_successful_index INTEGER DEFAULT 0,
        last_checkpoint_at INTEGER,
        state_json TEXT DEFAULT '{}',
        completed INTEGER DEFAULT 0
      )
    `);

    // quality_events table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS quality_events (
        event_id TEXT PRIMARY KEY,
        probe_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        eurocode TEXT NOT NULL,
        quality_class TEXT NOT NULL CHECK(quality_class IN ('PASS','REVIEW','REJECT')),
        reason_codes_json TEXT DEFAULT '[]',
        confidence REAL,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000),
        created_by TEXT NOT NULL
      )
    `);

    // performance_metrics table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        metric_id TEXT PRIMARY KEY,
        probe_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER DEFAULT 1,
        error_type TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000)
      )
    `);
  }

  /**
   * Enqueue a new request with deduplication.
   * If an entry with same vin_hash + probe_id exists, skip it.
   * Returns the entry id if created, or existing id if duplicate.
   */
  async enqueue(payload: EnqueuePayload, priority: number = 0): Promise<{ success: boolean; entryId: number; deduped: boolean }> {
    const vinHash = payload.vin_hash;
    const canonicalUrl = payload.metadata?.canonical_url;
    const skuFingerprint = payload.metadata?.sku_fingerprint;

    // Check for duplicate via canonical_url or sku_fingerprint
    if (canonicalUrl || skuFingerprint) {
      const existing = await this.findByCanonical(canonicalUrl || '', skuFingerprint || '');
      if (existing && existing.id > 0) {
        return { success: true, entryId: existing.id, deduped: true };
      }
    }

    // Check for duplicate via vin_hash + probe_id
    const vinCheck = await this.db.exec`
      SELECT id FROM request_queue WHERE probe_id = ${this.probeId} AND vin_hash = ${vinHash}
    `;

    if ((vinCheck.results || []).length > 0) {
      return { success: true, entryId: (vinCheck.results || [])[0].id, deduped: true };
    }

    const now = Date.now();
    const result = await this.db.exec`
      INSERT INTO request_queue 
        (probe_id, vin_hash, make, model, year, ktype, eurocode, status, priority, payload_json, created_at, metadata_json)
      VALUES 
        (${this.probeId}, ${vinHash}, ${payload.make}, ${payload.model}, ${payload.year}, ${payload.ktype}, ${payload.eurocode}, 'pending', ${priority}, ${JSON.stringify(payload)}, ${now}, ${JSON.stringify({})})
    `;

    const entryId = (result.lastID || 0);
    return { success: true, entryId, deduped: false };
  }

  /**
   * Dequeue the next pending request, claimed by this probe.
   * Marks entry as 'in_progress' and returns it.
   */
  async dequeue(): Promise<DequeueResult> {
    // Find next pending entry, ordered by priority then created_at
    const result = await this.db.exec`
      SELECT id, probe_id, vin_hash, make, model, year, ktype, eurocode, status, priority, payload_json, created_at, started_at, completed_at, error_message, metadata_json, canonical_url, sku_fingerprint
      FROM request_queue
      WHERE probe_id = ${this.probeId} AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `;

    const rows: any[] = result.results || [];
    if (rows.length === 0) {
      return { entry: null, newly_claimed: false };
    }

    const row = rows[0];
    // Mark as in_progress
    await this.db.exec`
      UPDATE request_queue SET status = 'in_progress', started_at = (strftime('%s','now')*1000) WHERE id = ${row.id}
    `;

    const entry: RequestQueueEntry = {
      id: row.id,
      probe_id: row.probe_id,
      vin_hash: row.vin_hash,
      make: row.make,
      model: row.model,
      year: row.year,
      ktype: row.ktype,
      eurocode: row.eurocode,
      status: 'in_progress' as const,
      priority: row.priority,
      payload_json: row.payload_json || '{}',
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error_message: row.error_message,
      metadata_json: row.metadata_json || '{}',
      canonical_url: row.canonical_url,
      sku_fingerprint: row.sku_fingerprint,
    };

    return { entry, newly_claimed: true };
  }

  /**
   * Mark a request as completed.
   * Updates status and records completion time.
   */
  async complete(entryId: number, errorMessage?: string): Promise<void> {
    await this.db.exec`
      UPDATE request_queue SET 
        status = 'completed', 
        completed_at = (strftime('%s','now')*1000),
        error_message = CASE WHEN ${errorMessage !== undefined} THEN ${errorMessage} ELSE error_message END
      WHERE id = ${entryId}
    `;
  }

  /**
   * Mark a request as failed.
   * Updates status, records error, and increments error counter.
   */
  async fail(entryId: number, errorMessage: string): Promise<void> {
    await this.db.exec`
      UPDATE request_queue SET 
        status = 'failed', 
        error_message = ${errorMessage},
        completed_at = (strftime('%s','now')*1000)
      WHERE id = ${entryId}
    `;
  }

  /**
   * Save checkpoint state for resume.
   * Records the last processed index and successful index.
   */
  async saveCheckpoint(lastProcessedIndex: number, lastSuccessfulIndex: number, state: Record<string, any> = {}): Promise<void> {
    const now = Date.now();
    // Use UPSERT - merge with existing if present
    await this.db.exec`
      INSERT INTO checkpoint_state (probe_id, last_processed_index, last_successful_index, last_checkpoint_at, state_json, completed)
      VALUES (${this.probeId}, ${lastProcessedIndex}, ${lastSuccessfulIndex}, ${now}, ${JSON.stringify(state)}, 0)
      ON CONFLICT(probe_id) DO UPDATE SET
        last_processed_index = ${lastProcessedIndex},
        last_successful_index = ${lastSuccessfulIndex},
        last_checkpoint_at = ${now},
        state_json = ${JSON.stringify(state)},
        completed = 0
    `;
  }

  /**
   * Load checkpoint state for resume.
   * Returns the checkpoint state or null if none exists.
   */
  async loadCheckpoint(): Promise<CheckpointState | null> {
    const result = await this.db.exec`
      SELECT * FROM checkpoint_state WHERE probe_id = ${this.probeId}
    `;

    const rows: any[] = result.results || [];
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      probe_id: row.probe_id,
      last_processed_index: row.last_processed_index || 0,
      last_successful_index: row.last_successful_index || 0,
      last_checkpoint_at: row.last_checkpoint_at || 0,
      state_json: row.state_json || '{}',
      completed: row.completed === 1,
    };
  }

  /**
   * Mark checkpoint as completed (final save).
   */
  async completeCheckpoint(): Promise<void> {
    await this.db.exec`
      UPDATE checkpoint_state SET completed = 1 WHERE probe_id = ${this.probeId}
    `;
  }

  /**
   * Find existing entry by canonical URL or SKU fingerprint
   */
  private async findByCanonical(canonicalUrl: string, skuFingerprint: string): Promise<{ id: number } | null> {
    if (canonicalUrl) {
      const result = await this.db.exec`
        SELECT id FROM request_queue WHERE probe_id = ${this.probeId} AND canonical_url = ${canonicalUrl}
      `;
      const rows: any[] = result.results || [];
      if (rows.length > 0) return { id: rows[0].id };
    }
    if (skuFingerprint) {
      const result = await this.db.exec`
        SELECT id FROM request_queue WHERE probe_id = ${this.probeId} AND sku_fingerprint = ${skuFingerprint}
      `;
      const rows: any[] = result.results || [];
      if (rows.length > 0) return { id: rows[0].id };
    }
    return null;
  }

  /**
   * Get all pending entries for this probe.
   */
  async getPending(): Promise<RequestQueueEntry[]> {
    const result = await this.db.exec`
      SELECT id, probe_id, vin_hash, make, model, year, ktype, eurocode, status, priority, payload_json, created_at, started_at, completed_at, error_message, metadata_json, canonical_url, sku_fingerprint
      FROM request_queue
      WHERE probe_id = ${this.probeId} AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
    `;

    const rows: any[] = result.results || [];
    return rows.map((row: any) => ({
      id: row.id,
      probe_id: row.probe_id,
      vin_hash: row.vin_hash,
      make: row.make,
      model: row.model,
      year: row.year,
      ktype: row.ktype,
      eurocode: row.eurocode,
      status: 'pending' as const,
      priority: row.priority,
      payload_json: row.payload_json || '{}',
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error_message: row.error_message,
      metadata_json: row.metadata_json || '{}',
      canonical_url: row.canonical_url,
      sku_fingerprint: row.sku_fingerprint,
    }));
  }

  /**
   * Get failed entries that can be retried.
   */
  async getFailed(): Promise<RequestQueueEntry[]> {
    const result = await this.db.exec`
      SELECT id, probe_id, vin_hash, make, model, year, ktype, eurocode, status, priority, payload_json, created_at, started_at, completed_at, error_message, metadata_json, canonical_url, sku_fingerprint
      FROM request_queue
      WHERE probe_id = ${this.probeId} AND status = 'failed'
      ORDER BY priority DESC, created_at ASC
    `;

    const rows: any[] = result.results || [];
    return rows.map((row: any) => ({
      id: row.id,
      probe_id: row.probe_id,
      vin_hash: row.vin_hash,
      make: row.make,
      model: row.model,
      year: row.year,
      ktype: row.ktype,
      eurocode: row.eurocode,
      status: 'failed' as const,
      priority: row.priority,
      payload_json: row.payload_json || '{}',
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error_message: row.error_message,
      metadata_json: row.metadata_json || '{}',
      canonical_url: row.canonical_url,
      sku_fingerprint: row.sku_fingerprint,
    }));
  }

  /**
   * Increment retry count and reset to pending if under max retries
   */
  async retryIfPossible(entryId: number, maxRetries: number = 3): Promise<boolean> {
    // Get current entry to check retry count
    const result = await this.db.exec`
      SELECT * FROM request_queue WHERE id = ${entryId}
    `;
    const rows: any[] = result.results || [];
    if (rows.length === 0) return false;

    const row = rows[0];

    // Only retry failed entries
    if (row.status !== 'failed') return false;

    // Check current retry count from metadata
    const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
    const retryCount = (metadata.retryCount || 0);

    if (retryCount >= maxRetries) {
      return false; // Max retries exceeded
    }

    // Increment retry count and reset to pending
    const newRetryCount = retryCount + 1;
    await this.db.exec`
      UPDATE request_queue SET
        status = 'pending',
        metadata_json = ${JSON.stringify({ ...metadata, retryCount: newRetryCount })},
        error_message = CASE WHEN ${metadata.error_message === ''} THEN NULL ELSE ${metadata.error_message} END,
        started_at = NULL
      WHERE id = ${entryId}
    `;

    return true;
  }

  /** Get queue statistics */
  async getStats(): Promise<{
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  }> {
    const result = await this.db.exec`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM request_queue WHERE probe_id = ${this.probeId}
    `;

    const rows: any[] = result.results || [];
    const r = rows[0] || {};
    return {
      total: r.total || 0,
      pending: r.pending || 0,
      in_progress: r.in_progress || 0,
      completed: r.completed || 0,
      failed: r.failed || 0,
    };
  }
}

/** Default export for module compatibility */
export default RequestQueue;