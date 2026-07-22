/**
 * DAG Summarizer — Creates hierarchical summaries from raw conversation nodes
 *
 * Triggered after agent_end when enough raw nodes accumulate.
 * Uses the active LLM to generate concise summaries.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { DagStore } from "./dag-store.js";

const log = createSubsystemLogger("dag-summarizer");

const SUMMARIZE_PROMPT = `Summarize the following conversation chunk concisely. 
Focus on: decisions made, facts learned, tasks completed/assigned, preferences expressed, and technical details.
Keep it under 200 words. Use bullet points.

Conversation:
`;

export interface SummarizeFunction {
  (prompt: string): Promise<string>;
}

/**
 * Check if a session needs summarization and perform it.
 * Called as fire-and-forget after agent_end.
 */
export async function maybeSummarizeDag(params: {
  dagStore: DagStore;
  sessionKey: string;
  summarize: SummarizeFunction;
}): Promise<void> {
  const { dagStore, sessionKey, summarize } = params;
  const chunkSize = dagStore.getChunkSize();

  try {
    const unsummarized = dagStore.getUnsummarizedNodes(sessionKey);

    if (unsummarized.length < chunkSize) {
      return; // Not enough nodes yet
    }

    // Process in chunks
    for (let i = 0; i + chunkSize <= unsummarized.length; i += chunkSize) {
      const chunk = unsummarized.slice(i, i + chunkSize);
      const chunkContent = chunk.map((n) => `[${n.role}]: ${n.content}`).join("\n\n");

      log.info(`Summarizing chunk of ${chunk.length} nodes for session ${sessionKey}`);

      const summary = await summarize(SUMMARIZE_PROMPT + chunkContent);

      if (summary && summary.trim() !== "NONE") {
        dagStore.storeSummary({
          parentIds: chunk.map((n) => n.id),
          sessionKey,
          level: 1,
          summary: summary.trim(),
          content: chunkContent,
        });
        log.info(`Created level-1 summary for ${chunk.length} nodes`);
      }
    }

    // Check if we need level-2 summaries (10+ level-1 summaries)
    await maybeCreateHigherSummary(dagStore, sessionKey, summarize, 1);
  } catch (err) {
    log.warn(`DAG summarization failed: ${String(err)}`);
  }
}

/**
 * Recursively create higher-level summaries.
 */
async function maybeCreateHigherSummary(
  dagStore: DagStore,
  sessionKey: string,
  summarize: SummarizeFunction,
  currentLevel: number,
): Promise<void> {
  // Get summaries at current level that haven't been rolled up
  const chunkSize = dagStore.getChunkSize();

  // Simple heuristic: if we have 10+ summaries at this level, roll up
  // This is a simplified check — production would track which are already rolled up
  const stats = dagStore.getStats();
  const countAtLevel = stats.byLevel[currentLevel] ?? 0;

  if (countAtLevel < chunkSize) {
    return;
  }

  log.info(
    `Creating level-${currentLevel + 1} summary from ${countAtLevel} level-${currentLevel} nodes`,
  );

  // For now, cap at level 3 to avoid infinite recursion
  if (currentLevel >= 3) {
    return;
  }

  // Would need a more sophisticated query to find un-rolled-up summaries
  // Skipping recursive summarization for v1 — level 1 summaries are sufficient
}
