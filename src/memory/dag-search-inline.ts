/**
 * DAG FTS5 inline search — called directly from memory_search tool
 * Bypasses the MemorySearchManager cache issue.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { MemorySearchResult } from "./types.js";

const log = createSubsystemLogger("dag-search");

export async function searchDagFts5(params: {
  cfg: { agents?: { defaults?: { memorySearch?: { provider?: string }; workspace?: string } } };
  query: string;
  limit: number;
}): Promise<MemorySearchResult[]> {
  const { cfg, query, limit } = params;
  try {
    const provider = cfg.agents?.defaults?.memorySearch?.provider;
    if (!provider || provider === "none") {
      return [];
    }

    const workspaceDir = cfg.agents?.defaults?.workspace;
    if (!workspaceDir) {
      return [];
    }

    const { getDagStore } = await import("./dag-hook.js");
    const store = getDagStore(workspaceDir);
    const ftsResults = store.search(query, limit);

    if (ftsResults.length > 0) {
      log.info(`DAG FTS5: ${ftsResults.length} results for "${query.slice(0, 50)}"`);
    }

    // Deduplicate DAG results by id AND content (FTS5 can match same content across different rows)
    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    const deduped = ftsResults.filter((r) => {
      if (seenIds.has(r.id)) {
        return false;
      }
      const contentKey = (r.summary || r.content).slice(0, 200);
      if (seenContent.has(contentKey)) {
        return false;
      }
      seenIds.add(r.id);
      seenContent.add(contentKey);
      return true;
    });

    return deduped.map((r) => ({
      path: ".dag-memory.sqlite",
      startLine: 0,
      endLine: 0,
      // Lower score so semantic/file results take priority
      score: Math.min(0.5, Math.abs(r.rank) / 20),
      snippet: formatSnippet(r),
      source: "memory" as const,
      citation: `.dag-memory.sqlite#L0`,
    }));
  } catch (err) {
    log.debug(`DAG FTS5 search failed (non-fatal): ${String(err)}`);
    return [];
  }
}

function formatSnippet(r: { level: number; content: string; summary: string | null }): string {
  const text = r.summary || r.content;
  const prefix = r.level > 0 ? `[Summary L${r.level}] ` : "[DAG] ";
  const maxLen = 500;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  return `${prefix}${truncated}\n\nSource: dag-memory`;
}
