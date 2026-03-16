/**
 * Passive Memory — Automatic long-term memory extraction
 *
 * Hooks into agent_end to periodically analyze conversations and
 * automatically save important information to memory/ files.
 *
 * Coexists with explicit memory_search/memory_write tools as an
 * additional passive layer.
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("passive-memory");

/** Track turn counts per session to trigger every N turns */
const sessionTurnCounts = new Map<string, number>();

/** Debounce: skip if last extraction was too recent */
const lastExtractionTs = new Map<string, number>();

const PASSIVE_INTERVAL_TURNS = 5;
const MIN_EXTRACTION_INTERVAL_MS = 60_000; // 1 min cooldown
const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the recent conversation and identify information worth remembering long-term.

Extract ONLY truly important items:
- User preferences, habits, personal facts
- Key decisions made
- Important dates, deadlines, commitments
- Technical configurations or project details
- Names, relationships, contact info

If nothing important, respond with exactly: NONE

Otherwise respond with a markdown list of memories, one per line:
- [category] memory content

Categories: preference, decision, fact, deadline, config, person, project

Be extremely selective. Only extract what would be useful weeks later.`;

export interface PassiveMemoryConfig {
  /** Turns between passive extraction checks (default: 5) */
  intervalTurns?: number;
  /** Minimum ms between extractions for same session (default: 60000) */
  cooldownMs?: number;
  /** Whether passive memory is enabled (default: true if memory search is configured) */
  enabled?: boolean;
}

/**
 * Extract important memories from conversation messages.
 * Called as fire-and-forget from agent_end hook.
 */
export async function maybeExtractPassiveMemory(params: {
  messages: unknown[];
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  agentId?: string;
  config?: PassiveMemoryConfig;
}): Promise<void> {
  const { messages, sessionKey, workspaceDir, config } = params;
  const intervalTurns = config?.intervalTurns ?? PASSIVE_INTERVAL_TURNS;
  const cooldownMs = config?.cooldownMs ?? MIN_EXTRACTION_INTERVAL_MS;

  if (config?.enabled === false) {
    return;
  }

  if (!sessionKey || !workspaceDir) {
    return;
  }

  // Count user messages as "turns"
  const userMsgCount = countUserMessages(messages);
  const prevCount = sessionTurnCounts.get(sessionKey) ?? 0;
  sessionTurnCounts.set(sessionKey, userMsgCount);

  // Only trigger at interval boundaries
  if (userMsgCount < intervalTurns) {
    return;
  }
  const prevBucket = Math.floor(prevCount / intervalTurns);
  const curBucket = Math.floor(userMsgCount / intervalTurns);
  if (curBucket <= prevBucket && prevCount > 0) {
    return;
  }

  // Cooldown check
  const lastTs = lastExtractionTs.get(sessionKey) ?? 0;
  if (Date.now() - lastTs < cooldownMs) {
    return;
  }

  lastExtractionTs.set(sessionKey, Date.now());

  try {
    await extractAndSaveMemories({ messages, workspaceDir, sessionKey });
  } catch (err) {
    log.warn(
      `Passive memory extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function countUserMessages(messages: unknown[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg && typeof msg === "object" && (msg as { role?: string }).role === "user") {
      count++;
    }
  }
  return count;
}

/**
 * Get recent conversation text for the extraction prompt.
 * Only uses the last ~10 messages to minimize token usage.
 */
function getRecentConversationText(messages: unknown[]): string {
  const recent = messages.slice(-10);
  const lines: string[] = [];
  for (const msg of recent) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const m = msg as { role?: string; content?: unknown };
    if (m.role === "user" || m.role === "assistant") {
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter(
                  (c: unknown) =>
                    c && typeof c === "object" && (c as { type?: string }).type === "text",
                )
                .map((c: unknown) => (c as { text?: string }).text ?? "")
                .join("\n")
            : "";
      if (text.trim()) {
        lines.push(`[${m.role}]: ${text.slice(0, 500)}`);
      }
    }
  }
  return lines.join("\n\n");
}

async function extractAndSaveMemories(params: {
  messages: unknown[];
  workspaceDir: string;
  sessionKey: string;
}): Promise<void> {
  const conversationText = getRecentConversationText(params.messages);
  if (!conversationText.trim()) {
    return;
  }

  log.info(`Running passive memory extraction for session ${params.sessionKey}`);

  // Use local Ollama for lightweight extraction (cost-free, no API key needed)
  const text = await callOllamaForExtraction(conversationText);

  if (!text || text === "NONE" || text.toUpperCase().startsWith("NONE")) {
    log.info("Passive memory: nothing important detected");
    return;
  }

  // Parse extracted memories
  const memories = parseExtractedMemories(text);
  if (memories.length === 0) {
    return;
  }

  // Write to memory/passive-YYYY-MM.md (monthly files)
  const memoryDir = path.join(params.workspaceDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filePath = path.join(memoryDir, `passive-${monthKey}.md`);

  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().slice(0, 5);
  const header = `\n## ${dateStr} ${timeStr}\n\n`;
  const content = memories.map((m) => `- ${m}`).join("\n") + "\n";

  // Append to file (creates if not exists)
  const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  if (!existingContent) {
    fs.writeFileSync(
      filePath,
      `# Passive Memory — ${monthKey}\n\nAutomatically extracted long-term memories.\n${header}${content}`,
    );
  } else {
    fs.appendFileSync(filePath, `${header}${content}`);
  }

  log.info(`Passive memory: saved ${memories.length} items to ${path.basename(filePath)}`);
}

const OLLAMA_GENERATE_URL = "http://127.0.0.1:11434/api/chat";
const PASSIVE_MEMORY_MODEL = "llama3.2:3b"; // Small model for cost efficiency

async function callOllamaForExtraction(conversationText: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(OLLAMA_GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PASSIVE_MEMORY_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: conversationText },
        ],
        stream: false,
        options: { num_predict: 500, temperature: 0.3 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }
    const json = (await response.json()) as { message?: { content?: string } };
    return json?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseExtractedMemories(text: string): string[] {
  const lines = text.split("\n");
  const memories: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const content = trimmed.slice(2).trim();
      if (content.length > 5) {
        memories.push(content);
      }
    }
  }
  return memories;
}

/**
 * Clear session tracking (for tests or session resets).
 */
export function clearPassiveMemoryState(sessionKey?: string): void {
  if (sessionKey) {
    sessionTurnCounts.delete(sessionKey);
    lastExtractionTs.delete(sessionKey);
  } else {
    sessionTurnCounts.clear();
    lastExtractionTs.clear();
  }
}
