/**
 * Soul Memory — Access Frequency Tracker
 *
 * Tracks how often memory chunks are retrieved in search results.
 * Memories accessed 3+ times across different sessions are flagged
 * as promotion candidates (T2 → T1).
 *
 * Storage: `search_hits` table in the existing memory SQLite database.
 */

import type { DatabaseSync } from "node:sqlite";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccessRecord {
  /** Memory chunk path */
  path: string;
  /** Total hit count */
  hitCount: number;
  /** Number of distinct sessions that accessed this */
  sessionCount: number;
  /** First access timestamp (ms) */
  firstAccessMs: number;
  /** Last access timestamp (ms) */
  lastAccessMs: number;
}

export interface FrequentMemory extends AccessRecord {
  /** Preview of the content */
  preview: string;
}

// ── Schema ─────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS search_hits (
    chunk_id TEXT NOT NULL,
    path TEXT NOT NULL,
    session_key TEXT NOT NULL,
    query TEXT NOT NULL,
    score REAL NOT NULL,
    hit_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`;

const CREATE_INDEX_CHUNK = `
  CREATE INDEX IF NOT EXISTS idx_search_hits_chunk ON search_hits(chunk_id)
`;

const CREATE_INDEX_PATH = `
  CREATE INDEX IF NOT EXISTS idx_search_hits_path ON search_hits(path)
`;

// ── Ensure schema ──────────────────────────────────────────────────────────

export function ensureAccessTrackerSchema(db: DatabaseSync): void {
  db.exec(CREATE_TABLE);
  db.exec(CREATE_INDEX_CHUNK);
  db.exec(CREATE_INDEX_PATH);
}

// ── Record hits ────────────────────────────────────────────────────────────

export interface SearchHit {
  chunkId: string;
  path: string;
  score: number;
}

/**
 * Record search hits for a query. Call this after each search.
 */
export function recordSearchHits(
  db: DatabaseSync,
  hits: SearchHit[],
  sessionKey: string,
  query: string,
): void {
  if (hits.length === 0) {
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO search_hits (chunk_id, path, session_key, query, score, hit_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const now = Date.now();
  for (const hit of hits) {
    stmt.run(hit.chunkId, hit.path, sessionKey, query, hit.score, now);
  }
}

// ── Query frequent memories ────────────────────────────────────────────────

/**
 * Find memories that have been accessed frequently across different sessions.
 * These are candidates for promotion from T2 (Working) to T1 (Core).
 *
 * @param minSessionCount - Minimum distinct sessions (default: 3)
 * @param daysBack - Only consider hits from last N days (default: 30)
 */
export function getFrequentlyAccessedMemories(
  db: DatabaseSync,
  options?: {
    minSessionCount?: number;
    daysBack?: number;
    limit?: number;
  },
): AccessRecord[] {
  const minSessions = options?.minSessionCount ?? 3;
  const daysBack = options?.daysBack ?? 30;
  const limit = options?.limit ?? 20;
  const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const stmt = db.prepare(`
    SELECT
      path,
      COUNT(*) as hit_count,
      COUNT(DISTINCT session_key) as session_count,
      MIN(hit_at) as first_access_ms,
      MAX(hit_at) as last_access_ms
    FROM search_hits
    WHERE hit_at >= ?
    GROUP BY path
    HAVING session_count >= ?
    ORDER BY session_count DESC, hit_count DESC
    LIMIT ?
  `);

  const rows = stmt.all(cutoffMs, minSessions, limit) as Array<{
    path: string;
    hit_count: number;
    session_count: number;
    first_access_ms: number;
    last_access_ms: number;
  }>;

  return rows.map((r) => ({
    path: r.path,
    hitCount: r.hit_count,
    sessionCount: r.session_count,
    firstAccessMs: r.first_access_ms,
    lastAccessMs: r.last_access_ms,
  }));
}

/**
 * Get total stats for the access tracker.
 */
export function getAccessStats(db: DatabaseSync): {
  totalHits: number;
  uniquePaths: number;
  uniqueSessions: number;
  oldestHitMs: number | null;
} {
  const row = db
    .prepare(`
    SELECT
      COUNT(*) as total_hits,
      COUNT(DISTINCT path) as unique_paths,
      COUNT(DISTINCT session_key) as unique_sessions,
      MIN(hit_at) as oldest_hit_ms
    FROM search_hits
  `)
    .get() as {
    total_hits: number;
    unique_paths: number;
    unique_sessions: number;
    oldest_hit_ms: number | null;
  };

  return {
    totalHits: row.total_hits,
    uniquePaths: row.unique_paths,
    uniqueSessions: row.unique_sessions,
    oldestHitMs: row.oldest_hit_ms,
  };
}

/**
 * Format access frequency data as a human-readable report.
 */
export function formatAccessReport(records: AccessRecord[]): string {
  if (records.length === 0) {
    return "No frequently accessed memories found (threshold: 3+ sessions).";
  }

  const lines: string[] = [
    `# Soul Memory — Frequently Accessed Memories`,
    ``,
    `Found **${records.length}** memories accessed across 3+ sessions (promotion candidates).`,
    ``,
    `| Path | Hits | Sessions | Last Access |`,
    `|------|------|----------|-------------|`,
  ];

  for (const r of records) {
    const lastAccess = new Date(r.lastAccessMs).toISOString().split("T")[0];
    lines.push(`| \`${r.path}\` | ${r.hitCount} | ${r.sessionCount} | ${lastAccess} |`);
  }

  lines.push(``);
  lines.push(`*Memories accessed in 3+ distinct sessions likely belong in Core Memory (T1).*`);

  return lines.join("\n");
}
