/**
 * DAG Search Wrapper — Merges DAG FTS5 results into memory_search output
 *
 * Wraps an existing MemorySearchManager and appends DAG FTS5 results
 * to the standard vector/file-based search results.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { getDagStore } from "./dag-hook.js";
import type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
  MemorySyncProgressUpdate,
} from "./types.js";

const log = createSubsystemLogger("dag-search");

/**
 * Wrap a MemorySearchManager to include DAG FTS5 results.
 */
export function wrapWithDagSearch(
  inner: MemorySearchManager,
  workspaceDir: string,
): MemorySearchManager {
  return {
    async search(
      query: string,
      opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
    ): Promise<MemorySearchResult[]> {
      // Run inner search and DAG search in parallel
      const maxResults = opts?.maxResults ?? 10;
      const dagMaxResults = Math.min(5, Math.ceil(maxResults / 2));

      const [innerResults, dagResults] = await Promise.all([
        inner.search(query, opts),
        searchDag(workspaceDir, query, dagMaxResults),
      ]);

      // Merge: inner results first, then DAG results (deduplicated)
      const merged = [...innerResults];
      const existingSnippets = new Set(innerResults.map((r) => r.snippet.slice(0, 100)));

      for (const dagResult of dagResults) {
        // Skip if substantially similar to an existing result
        if (existingSnippets.has(dagResult.snippet.slice(0, 100))) {
          continue;
        }
        merged.push(dagResult);
      }

      // Cap to maxResults
      return merged.slice(0, maxResults);
    },

    async readFile(params: { relPath: string; from?: number; lines?: number }) {
      return inner.readFile(params);
    },

    status() {
      return inner.status();
    },

    sync: inner.sync
      ? async (params?: {
          reason?: string;
          force?: boolean;
          progress?: (update: MemorySyncProgressUpdate) => void;
        }) => {
          await inner.sync!(params);
        }
      : undefined,

    async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
      return inner.probeEmbeddingAvailability();
    },

    async probeVectorAvailability(): Promise<boolean> {
      return inner.probeVectorAvailability();
    },

    close: inner.close
      ? async () => {
          await inner.close!();
        }
      : undefined,
  };
}

/**
 * Search the DAG FTS5 index and convert results to MemorySearchResult format.
 */
async function searchDag(
  workspaceDir: string,
  query: string,
  limit: number,
): Promise<MemorySearchResult[]> {
  try {
    const store = getDagStore(workspaceDir);
    const ftsResults = store.search(query, limit);

    // Deduplicate DAG results by id
    const seen = new Set<string>();
    const deduped = ftsResults.filter((r) => {
      if (seen.has(r.id)) {
        return false;
      }
      seen.add(r.id);
      return true;
    });

    return deduped.map((r) => ({
      path: ".dag-memory.sqlite",
      startLine: 0,
      endLine: 0,
      score: Math.min(0.5, Math.abs(r.rank) / 20), // Lower score — semantic results take priority
      snippet: formatDagSnippet(r),
      source: "memory" as const,
      citation: `.dag-memory.sqlite#L0`,
    }));
  } catch (err) {
    log.debug(`DAG search failed (non-fatal): ${String(err)}`);
    return [];
  }
}

function formatDagSnippet(r: { level: number; content: string; summary: string | null }): string {
  const text = r.summary || r.content;
  const prefix = r.level > 0 ? `[Summary L${r.level}] ` : "";
  // Truncate to reasonable length
  const maxLen = 500;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  return `${prefix}${truncated}\n\nSource: dag-memory#${r.level}`;
}
