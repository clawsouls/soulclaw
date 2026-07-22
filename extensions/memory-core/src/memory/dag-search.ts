/**
 * DAG FTS5 search integration for memory-core (SoulClaw Soul Memory).
 *
 * Read-only accessor for the `.dag-memory.sqlite` lossless conversation DAG that
 * the host session hooks write during a conversation. This module merges DAG
 * full-text hits into the standard vector/keyword memory_search output so that
 * long-tail conversational context stays retrievable after it ages out of the
 * primary memory files.
 *
 * The write side (DagStore, dag-hook, dag-summarizer) lives in the host package
 * and is driven by the SoulScan inline hook; here we only read the same SQLite
 * file. If no DAG index exists yet the reader degrades to an empty result set,
 * so wrapping a manager is always safe.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createSubsystemLogger } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import {
  requireNodeSqlite,
  type MemorySearchManager,
  type MemorySearchResult,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";

const log = createSubsystemLogger("dag-search");

const DAG_DB_FILENAME = ".dag-memory.sqlite";
const DAG_SNIPPET_MAX_LEN = 500;
const DAG_DEDUPE_PREFIX_LEN = 200;
/** DAG hits are capped below vector/keyword scores so semantic results win ties. */
const DAG_MAX_SCORE = 0.5;

/** Marks a manager already wrapped, so a double wrap (e.g. recursive resolve) is a no-op. */
const DAG_WRAPPED = Symbol("openclaw.memory.dagSearchWrapped");

type SqliteDatabase = InstanceType<typeof import("node:sqlite").DatabaseSync>;

type DagRow = {
  id: string;
  level: number;
  content: string;
  summary: string | null;
  rank: number;
};

// Cached read handles keyed by workspace dir. `null` = no DAG index present.
const DB_CACHE = new Map<string, SqliteDatabase | null>();

function openDagDb(workspaceDir: string): SqliteDatabase | null {
  const cached = DB_CACHE.get(workspaceDir);
  if (cached !== undefined) {
    return cached;
  }
  const dbPath = path.join(workspaceDir, DAG_DB_FILENAME);
  let db: SqliteDatabase | null = null;
  try {
    if (fs.existsSync(dbPath)) {
      const sqlite = requireNodeSqlite();
      db = new sqlite.DatabaseSync(dbPath);
    }
  } catch (err) {
    log.debug(`DAG store open failed (non-fatal): ${String(err)}`);
    db = null;
  }
  DB_CACHE.set(workspaceDir, db);
  return db;
}

function formatDagSnippet(r: { level: number; content: string; summary: string | null }): string {
  const text = r.summary ?? r.content;
  const prefix = r.level > 0 ? `[Summary L${r.level}] ` : "";
  const truncated =
    text.length > DAG_SNIPPET_MAX_LEN ? `${text.slice(0, DAG_SNIPPET_MAX_LEN)}…` : text;
  return `${prefix}${truncated}\n\nSource: dag-memory#${r.level}`;
}

/** Search the DAG FTS5 index and map hits into MemorySearchResult shape. */
function searchDag(workspaceDir: string, query: string, limit: number): MemorySearchResult[] {
  const db = openDagDb(workspaceDir);
  if (!db) {
    return [];
  }
  let rows: DagRow[];
  try {
    const stmt = db.prepare(`
      SELECT n.id, n.level, n.content, n.summary, rank
      FROM dag_fts f
      JOIN dag_nodes n ON n.rowid = f.rowid
      WHERE dag_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    rows = stmt.all(query, limit) as unknown as DagRow[];
  } catch (err) {
    // Invalid FTS5 query syntax or a missing table is non-fatal — skip DAG hits.
    log.debug(`DAG search failed (non-fatal): ${String(err)}`);
    return [];
  }

  // Deduplicate by id AND content prefix (FTS5 can surface the same text across rows).
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const results: MemorySearchResult[] = [];
  for (const r of rows) {
    if (seenIds.has(r.id)) {
      continue;
    }
    const contentKey = (r.summary ?? r.content).slice(0, DAG_DEDUPE_PREFIX_LEN);
    if (seenContent.has(contentKey)) {
      continue;
    }
    seenIds.add(r.id);
    seenContent.add(contentKey);
    results.push({
      path: DAG_DB_FILENAME,
      startLine: 0,
      endLine: 0,
      // Lower score band so semantic/keyword results take priority in the merge.
      score: Math.min(DAG_MAX_SCORE, Math.abs(r.rank) / 20),
      snippet: formatDagSnippet(r),
      source: "memory",
      citation: `${DAG_DB_FILENAME}#L0`,
    });
  }
  return results;
}

/** True if `manager` is already a DAG search wrapper. */
export function isDagWrapped(manager: MemorySearchManager): boolean {
  return Boolean((manager as unknown as Record<symbol, unknown>)[DAG_WRAPPED]);
}

type SearchArgs = Parameters<MemorySearchManager["search"]>;

/**
 * Wrap a MemorySearchManager so memory_search results also include DAG FTS5 hits.
 * All other manager behavior is forwarded unchanged. Idempotent: wrapping an
 * already-wrapped manager returns it untouched.
 */
export function wrapWithDagSearch(
  inner: MemorySearchManager,
  workspaceDir: string,
): MemorySearchManager {
  if (isDagWrapped(inner)) {
    return inner;
  }

  const wrappedSearch = async (...args: SearchArgs): Promise<MemorySearchResult[]> => {
    const [query, opts] = args;
    const maxResults = opts?.maxResults ?? 10;
    const dagMaxResults = Math.min(5, Math.ceil(maxResults / 2));

    const [innerResults, dagResults] = await Promise.all([
      inner.search(...args),
      Promise.resolve().then(() => searchDag(workspaceDir, query, dagMaxResults)),
    ]);

    // Semantic/keyword results first, then DAG hits deduped by snippet prefix.
    const merged = [...innerResults];
    const existingSnippets = new Set(
      innerResults.map((r) => r.snippet.slice(0, DAG_DEDUPE_PREFIX_LEN)),
    );
    for (const dagResult of dagResults) {
      const key = dagResult.snippet.slice(0, DAG_DEDUPE_PREFIX_LEN);
      if (existingSnippets.has(key)) {
        continue;
      }
      existingSnippets.add(key);
      merged.push(dagResult);
    }
    return merged.slice(0, maxResults);
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === DAG_WRAPPED) {
        return true;
      }
      if (prop === "search") {
        return wrappedSearch;
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...callArgs: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** Close and clear cached DAG read handles. Safe to call repeatedly. */
export function closeDagSearchStores(): void {
  for (const db of DB_CACHE.values()) {
    try {
      db?.close();
    } catch {
      // best-effort close
    }
  }
  DB_CACHE.clear();
}
