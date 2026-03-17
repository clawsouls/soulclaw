/**
 * DAG Conversation Store — Lossless hierarchical conversation memory
 *
 * Stores all conversation turns in a DAG (Directed Acyclic Graph) structure:
 * - Level 0: Raw conversation messages (never deleted)
 * - Level 1: Chunk summaries (groups of ~10 turns)
 * - Level 2+: Higher-level summaries (recursive)
 *
 * Combined with FTS5 full-text search for retrieval.
 * Works alongside passive-memory.ts and the existing vector search.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "./sqlite.js";

const log = createSubsystemLogger("dag-store");

/** Number of raw turns before triggering a chunk summary */
const CHUNK_SIZE = 10;

/** Max chars for a single node's content */
const MAX_NODE_CONTENT = 50_000;

export interface DagNode {
  id: string;
  parentId: string | null;
  level: number;
  content: string;
  summary: string | null;
  sessionKey: string;
  role: string | null;
  createdAt: number;
  tokenEstimate: number;
}

export interface DagSearchResult {
  id: string;
  level: number;
  content: string;
  summary: string | null;
  rank: number;
}

export class DagStore {
  private db: InstanceType<typeof import("node:sqlite").DatabaseSync>;
  private dbPath: string;

  constructor(workspaceDir: string) {
    this.dbPath = path.join(workspaceDir, ".dag-memory.sqlite");
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(this.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dag_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        level INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        summary TEXT,
        session_key TEXT NOT NULL,
        role TEXT,
        created_at INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_dag_session ON dag_nodes(session_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_dag_level ON dag_nodes(level);
      CREATE INDEX IF NOT EXISTS idx_dag_parent ON dag_nodes(parent_id);
    `);

    // Create FTS5 virtual table if not exists
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS dag_fts USING fts5(
          content,
          summary,
          content_rowid='rowid'
        );
      `);
    } catch {
      // FTS5 table might already exist
      log.debug("FTS5 table already exists or not supported");
    }

    log.info(`DAG store initialized at ${this.dbPath}`);
  }

  /**
   * Store a raw conversation message (level 0).
   */
  storeMessage(params: { sessionKey: string; role: string; content: string }): string {
    const id = generateId();
    const tokenEstimate = estimateTokens(params.content);

    const stmt = this.db.prepare(`
      INSERT INTO dag_nodes (id, parent_id, level, content, summary, session_key, role, created_at, token_estimate)
      VALUES (?, NULL, 0, ?, NULL, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.content.slice(0, MAX_NODE_CONTENT),
      params.sessionKey,
      params.role,
      Date.now(),
      tokenEstimate,
    );

    // Index in FTS5
    try {
      const ftsStmt = this.db.prepare(`
        INSERT INTO dag_fts (rowid, content, summary)
        VALUES ((SELECT rowid FROM dag_nodes WHERE id = ?), ?, '')
      `);
      ftsStmt.run(id, params.content.slice(0, MAX_NODE_CONTENT));
    } catch {
      // FTS insert failure is non-fatal
    }

    return id;
  }

  /**
   * Store a batch of messages from a conversation turn.
   */
  storeConversationBatch(params: {
    sessionKey: string;
    messages: Array<{ role: string; content: string }>;
  }): string[] {
    const ids: string[] = [];
    for (const msg of params.messages) {
      if (msg.content && msg.content.trim()) {
        ids.push(
          this.storeMessage({
            sessionKey: params.sessionKey,
            role: msg.role,
            content: msg.content,
          }),
        );
      }
    }
    return ids;
  }

  /**
   * Get unsummarized raw nodes for a session.
   */
  getUnsummarizedNodes(sessionKey: string): DagNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM dag_nodes
      WHERE session_key = ? AND level = 0 AND id NOT IN (
        SELECT DISTINCT parent_id FROM dag_nodes WHERE parent_id IS NOT NULL
      )
      ORDER BY created_at ASC
    `);
    return stmt.all(sessionKey) as unknown as DagNode[];
  }

  /**
   * Create a summary node (level N+1) from child nodes.
   */
  storeSummary(params: {
    parentIds: string[];
    sessionKey: string;
    level: number;
    summary: string;
    content: string;
  }): string {
    const id = generateId();
    const tokenEstimate = estimateTokens(params.summary);

    // Store summary node
    const stmt = this.db.prepare(`
      INSERT INTO dag_nodes (id, parent_id, level, content, summary, session_key, role, created_at, token_estimate)
      VALUES (?, ?, ?, ?, ?, ?, 'summary', ?, ?)
    `);
    // Use first parent as parent_id (for tree traversal)
    stmt.run(
      id,
      params.parentIds[0] ?? null,
      params.level,
      params.content.slice(0, MAX_NODE_CONTENT),
      params.summary,
      params.sessionKey,
      Date.now(),
      tokenEstimate,
    );

    // Link all parent IDs via junction table if needed in future
    // For now, the parent_id points to the first child

    // Index in FTS5
    try {
      const ftsStmt = this.db.prepare(`
        INSERT INTO dag_fts (rowid, content, summary)
        VALUES ((SELECT rowid FROM dag_nodes WHERE id = ?), ?, ?)
      `);
      ftsStmt.run(id, params.content.slice(0, MAX_NODE_CONTENT), params.summary);
    } catch {
      // non-fatal
    }

    return id;
  }

  /**
   * Full-text search across all DAG nodes.
   */
  search(query: string, limit: number = 10): DagSearchResult[] {
    try {
      const stmt = this.db.prepare(`
        SELECT n.id, n.level, n.content, n.summary, rank
        FROM dag_fts f
        JOIN dag_nodes n ON n.rowid = f.rowid
        WHERE dag_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(query, limit) as unknown as DagSearchResult[];
    } catch (err) {
      log.warn(`FTS search failed: ${String(err)}`);
      return [];
    }
  }

  /**
   * Get recent conversation context for a session.
   * Returns most recent raw messages + relevant summaries.
   */
  getRecentContext(sessionKey: string, maxTokens: number = 4000): DagNode[] {
    const nodes: DagNode[] = [];
    let tokenBudget = maxTokens;

    // First, get recent raw messages
    const recentStmt = this.db.prepare(`
      SELECT * FROM dag_nodes
      WHERE session_key = ? AND level = 0
      ORDER BY created_at DESC
      LIMIT 50
    `);
    const recent = (recentStmt.all(sessionKey) as unknown as DagNode[]).toReversed();

    for (const node of recent) {
      if (tokenBudget <= 0) {
        break;
      }
      nodes.push(node);
      tokenBudget -= node.tokenEstimate || estimateTokens(node.content);
    }

    // If we have budget left, add higher-level summaries
    if (tokenBudget > 0) {
      const summaryStmt = this.db.prepare(`
        SELECT * FROM dag_nodes
        WHERE session_key = ? AND level > 0
        ORDER BY level DESC, created_at DESC
        LIMIT 10
      `);
      const summaries = summaryStmt.all(sessionKey) as unknown as DagNode[];
      for (const s of summaries) {
        if (tokenBudget <= 0) {
          break;
        }
        nodes.unshift(s); // prepend summaries before recent messages
        tokenBudget -= s.tokenEstimate || estimateTokens(s.summary || s.content);
      }
    }

    return nodes;
  }

  /**
   * Get the chunk size threshold for triggering summarization.
   */
  getChunkSize(): number {
    return CHUNK_SIZE;
  }

  /**
   * Count raw (level 0) nodes for a session.
   */
  countRawNodes(sessionKey: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM dag_nodes WHERE session_key = ? AND level = 0
    `);
    const result = stmt.get(sessionKey) as unknown as { count: number };
    return result.count;
  }

  /**
   * Get stats for diagnostics.
   */
  getStats(): { totalNodes: number; byLevel: Record<number, number>; dbSizeBytes: number } {
    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM dag_nodes`);
    const total = (totalStmt.get() as unknown as { count: number }).count;

    const levelStmt = this.db.prepare(
      `SELECT level, COUNT(*) as count FROM dag_nodes GROUP BY level ORDER BY level`,
    );
    const levels = levelStmt.all() as Array<{ level: number; count: number }>;
    const byLevel: Record<number, number> = {};
    for (const l of levels) {
      byLevel[l.level] = l.count;
    }

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(this.dbPath).size;
    } catch {
      /* ignore */
    }

    return { totalNodes: total, byLevel, dbSizeBytes };
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}

// --- Helpers ---

function generateId(): string {
  return `dag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  // Rough estimate: ~4 chars per token for English, ~2 for CJK
  const cjkChars = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(otherChars / 4 + cjkChars / 2);
}
