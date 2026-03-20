/**
 * Session memory autoflush hook handler
 *
 * Saves session context to memory when sessions end unexpectedly
 * (compaction, timeout, crash, reaper). Skips "command" reason since
 * the session-memory hook already handles /new and /reset.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { writeFileWithinRoot } from "../../../infra/fs-safe.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import { hasInterSessionUserProvenance } from "../../../sessions/input-provenance.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import { isSessionEndEvent } from "../../internal-hooks.js";

const log = createSubsystemLogger("hooks/session-memory-autoflush");

/** Default reasons to skip (session-memory hook handles command-triggered resets). */
const DEFAULT_SKIP_REASONS = new Set(["command"]);

const AUTOFLUSH_TIMEOUT_MS = 10_000;

/**
 * Read recent messages from a session JSONL file.
 */
async function getRecentSessionContent(
  sessionFilePath: string,
  messageCount: number = 15,
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");

    const allMessages: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          const role = msg.role;
          if ((role === "user" || role === "assistant") && msg.content) {
            if (role === "user" && hasInterSessionUserProvenance(msg)) {
              continue;
            }
            const text = Array.isArray(msg.content)
              ? // oxlint-disable-next-line typescript/no-explicit-any
                msg.content.find((c: any) => c.type === "text")?.text
              : msg.content;
            if (text && !text.startsWith("/")) {
              allMessages.push(`${role}: ${text}`);
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return allMessages.slice(-messageCount).join("\n") || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the session file path for a given session key/id.
 */
function resolveSessionFile(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.jsonl`);
}

const handler: HookHandler = async (event) => {
  if (!isSessionEndEvent(event)) {
    return;
  }

  const { reason, sessionId, sessionKey, workspaceDir: ctxWorkspaceDir, cfg } = event.context;

  // Check hook config for custom excludeReasons
  const hookConfig = resolveHookConfig(cfg, "session-memory-autoflush");
  const excludeReasons = Array.isArray(hookConfig?.excludeReasons)
    ? new Set(hookConfig.excludeReasons as string[])
    : DEFAULT_SKIP_REASONS;

  if (excludeReasons.has(reason)) {
    log.debug("Skipping autoflush for reason", { reason });
    return;
  }

  const onFailure = (hookConfig?.onFailure as string) ?? "warn";

  // Wrap in timeout to never block session end
  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), AUTOFLUSH_TIMEOUT_MS),
  );

  const flushPromise = (async () => {
    try {
      const agentId =
        event.context.agentId ?? resolveAgentIdFromSessionKey(sessionKey) ?? undefined;
      const workspaceDir =
        ctxWorkspaceDir ||
        (cfg
          ? resolveAgentWorkspaceDir(cfg, agentId)
          : path.join(resolveStateDir(process.env, os.homedir), "workspace"));

      const memoryDir = path.join(workspaceDir, "memory");
      await fs.mkdir(memoryDir, { recursive: true });

      // Try to read recent session content
      const sessionFile = resolveSessionFile(workspaceDir, sessionId);
      const sessionContent = await getRecentSessionContent(sessionFile);

      if (!sessionContent) {
        log.debug("No session content to flush", { sessionId, reason });
        return;
      }

      const now = new Date(event.timestamp);
      const dateStr = now.toISOString().split("T")[0];
      const timeStr = now.toISOString().split("T")[1].split(".")[0];

      // Build markdown entry
      const entryParts = [
        `## Autoflush: ${dateStr} ${timeStr} UTC`,
        "",
        `- **Session Key**: ${sessionKey}`,
        `- **Session ID**: ${sessionId}`,
        `- **Reason**: ${reason}`,
        "",
        "### Recent Conversation",
        "",
        sessionContent,
        "",
        "---",
        "",
      ];

      const entry = entryParts.join("\n");
      const filename = `${dateStr}-autoflush.md`;

      // Append if file exists, otherwise create with header
      const filePath = path.join(memoryDir, filename);
      let existingContent = "";
      try {
        existingContent = await fs.readFile(filePath, "utf-8");
      } catch {
        // File doesn't exist yet
      }

      const data = existingContent
        ? `${existingContent}${entry}`
        : `# Session Autoflush — ${dateStr}\n\n${entry}`;

      await writeFileWithinRoot({
        rootDir: memoryDir,
        relativePath: filename,
        data,
        encoding: "utf-8",
      });

      const relPath = filePath.replace(os.homedir(), "~");
      log.info(`Autoflush saved to ${relPath}`, { reason, sessionId });
    } catch (err) {
      if (onFailure === "silent") {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (onFailure === "error") {
        log.error("Autoflush failed", { errorMessage: message, reason, sessionId });
      } else {
        log.warn("Autoflush failed", { errorMessage: message, reason, sessionId });
      }
    }
  })();

  const result = await Promise.race([flushPromise, timeoutPromise]);
  if (result === "timeout") {
    log.warn("Autoflush timed out", { sessionId, reason, timeoutMs: AUTOFLUSH_TIMEOUT_MS });
  }
};

export default handler;
