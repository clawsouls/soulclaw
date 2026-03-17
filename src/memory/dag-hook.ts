/**
 * DAG Hook — Bridges agent_end to DAG store
 *
 * Stores conversation messages into the DAG on every agent_end.
 * Lightweight — no LLM calls here; summarization is separate.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { DagStore } from "./dag-store.js";

const log = createSubsystemLogger("dag-hook");

/** Cache DagStore instances per workspace */
const storeCache = new Map<string, DagStore>();

function getStore(workspaceDir: string): DagStore {
  let store = storeCache.get(workspaceDir);
  if (!store) {
    store = new DagStore(workspaceDir);
    storeCache.set(workspaceDir, store);
  }
  return store;
}

/**
 * Extract role and content from message objects.
 * Messages can have various shapes depending on the provider.
 */
function extractMessages(messages: unknown[]): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const m = msg as Record<string, unknown>;
    const role = typeof m.role === "string" ? m.role : "unknown";
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      // Multi-part content (e.g., text + images)
      content = m.content
        .filter(
          (p: unknown) =>
            typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text",
        )
        .map((p: unknown) => {
          const t = (p as Record<string, unknown>).text;
          return typeof t === "string" ? t : "";
        })
        .join("\n");
    }
    if (content.trim()) {
      result.push({ role, content: content.trim() });
    }
  }
  return result;
}

/** Track which messages we've already stored per session */
const sessionMessageCounts = new Map<string, number>();

/**
 * Store new conversation messages in the DAG.
 * Only stores messages that haven't been stored yet (incremental).
 */
export async function maybeDagStore(params: {
  messages: unknown[];
  sessionKey?: string;
  workspaceDir?: string;
}): Promise<void> {
  const { messages, sessionKey, workspaceDir } = params;

  if (!sessionKey || !workspaceDir) {
    return;
  }

  try {
    const store = getStore(workspaceDir);
    const extracted = extractMessages(messages);

    if (extracted.length === 0) {
      return;
    }

    // Only store new messages (incremental)
    const prevCount = sessionMessageCounts.get(sessionKey) ?? 0;
    const newMessages = extracted.slice(prevCount);

    if (newMessages.length === 0) {
      return;
    }

    store.storeConversationBatch({
      sessionKey,
      messages: newMessages,
    });

    sessionMessageCounts.set(sessionKey, extracted.length);
    log.debug(
      `Stored ${newMessages.length} new messages for session ${sessionKey} (total: ${extracted.length})`,
    );
  } catch (err) {
    log.warn(`DAG store hook failed: ${String(err)}`);
  }
}

/**
 * Get a DagStore instance for external use (e.g., search integration).
 */
export function getDagStore(workspaceDir: string): DagStore {
  return getStore(workspaceDir);
}
