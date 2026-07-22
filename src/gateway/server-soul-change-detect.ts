/**
 * Detects SOUL.md changes between gateway restarts.
 * When a soul change is detected, resets active sessions so the new persona takes effect
 * without requiring users to manually send /new.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgentSessionDirs } from "../agents/session-dirs.js";
import { resolveStateDir } from "../config/paths.js";
import { updateSessionStore, loadSessionStore } from "../config/sessions.js";

const SOUL_HASH_FILENAME = ".soul-hash";

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getSoulHashPath(stateDir: string): string {
  return join(stateDir, SOUL_HASH_FILENAME);
}

function readStoredHash(stateDir: string): string {
  const hashPath = getSoulHashPath(stateDir);
  if (!existsSync(hashPath)) {
    return "";
  }
  return readFileSync(hashPath, "utf-8").trim();
}

function writeHash(stateDir: string, hash: string): void {
  const hashPath = getSoulHashPath(stateDir);
  writeFileSync(hashPath, hash, "utf-8");
}

/**
 * Check if SOUL.md has changed since last gateway start.
 * If changed, reset all active session updatedAt to 0 (triggers idle reset).
 */
export async function detectAndResetOnSoulChange(params: {
  workspaceDir: string;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<boolean> {
  try {
    const stateDir = resolveStateDir(process.env);
    const soulMdPath = join(params.workspaceDir, "SOUL.md");
    const identityMdPath = join(params.workspaceDir, "IDENTITY.md");

    // Hash both SOUL.md and IDENTITY.md
    const currentHash = hashFile(soulMdPath) + ":" + hashFile(identityMdPath);
    const storedHash = readStoredHash(stateDir);

    // Always update stored hash
    writeHash(stateDir, currentHash);

    // First run or no change
    if (!storedHash || storedHash === currentHash) {
      return false;
    }

    params.log.info("Soul change detected — resetting active sessions for new persona");

    // Reset sessions by setting updatedAt to 0 (triggers idle/daily reset)
    const sessionDirs = await resolveAgentSessionDirs(stateDir);
    for (const sessionsDir of sessionDirs) {
      try {
        const store = loadSessionStore({ sessionsDir });
        if (!store) {
          continue;
        }

        for (const [sessionKey, entry] of Object.entries(store)) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const e = entry as { updatedAt?: number; sessionId?: string };
          if (!e.updatedAt || e.updatedAt === 0) {
            continue;
          }

          // Skip cron sessions — they don't have persona context issues
          if (sessionKey.includes(":cron:")) {
            continue;
          }

          await updateSessionStore({
            sessionsDir,
            sessionKey,
            update: (existing) => ({
              ...existing,
              updatedAt: 0,
            }),
          });
        }
      } catch (err) {
        params.log.warn(`Failed to reset sessions in ${sessionsDir}: ${String(err)}`);
      }
    }

    return true;
  } catch (err) {
    params.log.warn(`Soul change detection failed: ${String(err)}`);
    return false;
  }
}
