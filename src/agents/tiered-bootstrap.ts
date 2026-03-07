/**
 * Tiered Bootstrap Loading — Progressive Disclosure for Context Window Optimization
 *
 * Instead of loading ALL workspace files into every system prompt,
 * files are loaded in tiers based on necessity:
 *
 *   Tier 1 (Always): SOUL.md, IDENTITY.md, AGENTS.md — core identity, never skipped
 *   Tier 2 (First turn): TOOLS.md, USER.md, BOOTSTRAP.md — loaded on first turn or fresh sessions
 *   Tier 3 (On demand): MEMORY.md, memory/*.md, HEARTBEAT.md — loaded only when relevant
 *
 * For main sessions, this can reduce token usage by 40-60% on typical conversations,
 * since memory files are fetched via memory_search tool when actually needed.
 *
 * SoulClaw-specific: upstream OpenClaw loads everything for main sessions.
 */

import type { WorkspaceBootstrapFile } from "./workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
} from "./workspace.js";

export type BootstrapTier = 1 | 2 | 3;

/** Tier 1: Core identity — always loaded */
const TIER_1_FILES = new Set([
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_AGENTS_FILENAME,
]);

/** Tier 2: Session context — loaded on first turn / fresh sessions */
const TIER_2_FILES = new Set([
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
]);

/** Tier 3: Memory — loaded only on heartbeat or when explicitly needed */
const TIER_3_FILES = new Set([
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
]);

function isMemorySubfile(name: string): boolean {
  // memory/*.md files have names like "memory/2026-03-07.md"
  return name.startsWith("memory/") || name.startsWith("memory\\");
}

function getFileTier(name: string): BootstrapTier {
  if (TIER_1_FILES.has(name)) {
    return 1;
  }
  if (TIER_2_FILES.has(name)) {
    return 2;
  }
  if (TIER_3_FILES.has(name) || isMemorySubfile(name)) {
    return 3;
  }
  // Unknown files default to tier 2 (include on first turn)
  return 2;
}

export interface TieredFilterOptions {
  /** Current turn number in the conversation (0 = first turn) */
  turnCount?: number;
  /** Whether this is a heartbeat run */
  isHeartbeat?: boolean;
  /** Maximum tier to include (1 = minimal, 2 = standard, 3 = full) */
  maxTier?: BootstrapTier;
  /** Disable tiered loading — load everything (upstream behavior) */
  disabled?: boolean;
}

/**
 * Filter bootstrap files by tier for progressive disclosure.
 *
 * - Turn 0 (first message): Tier 1 + Tier 2
 * - Turn 1+ (ongoing): Tier 1 only (SOUL.md, IDENTITY.md, AGENTS.md)
 * - Heartbeat: Tier 1 + HEARTBEAT.md only
 * - maxTier=3: Load everything (same as upstream)
 */
export function filterByTier(
  files: WorkspaceBootstrapFile[],
  opts?: TieredFilterOptions,
): WorkspaceBootstrapFile[] {
  if (opts?.disabled) {
    return files;
  }

  const turnCount = opts?.turnCount ?? 0;
  const isHeartbeat = opts?.isHeartbeat ?? false;

  if (opts?.maxTier === 3) {
    return files;
  }

  // Heartbeat: Tier 1 + HEARTBEAT.md
  if (isHeartbeat) {
    return files.filter((f) => TIER_1_FILES.has(f.name) || f.name === DEFAULT_HEARTBEAT_FILENAME);
  }

  // First turn: Tier 1 + Tier 2
  if (turnCount === 0) {
    const maxTier = opts?.maxTier ?? 2;
    return files.filter((f) => getFileTier(f.name) <= maxTier);
  }

  // Ongoing conversation: Tier 1 only
  // Memory is available via memory_search tool
  const maxTier = opts?.maxTier ?? 1;
  return files.filter((f) => getFileTier(f.name) <= maxTier);
}

/**
 * Calculate token savings estimate for logging/diagnostics.
 */
export function estimateSavings(
  allFiles: WorkspaceBootstrapFile[],
  filteredFiles: WorkspaceBootstrapFile[],
): { totalChars: number; filteredChars: number; savedPercent: number } {
  const totalChars = allFiles.reduce((sum, f) => sum + (f.content?.length ?? 0), 0);
  const filteredChars = filteredFiles.reduce((sum, f) => sum + (f.content?.length ?? 0), 0);
  const savedPercent =
    totalChars > 0 ? Math.round(((totalChars - filteredChars) / totalChars) * 100) : 0;
  return { totalChars, filteredChars, savedPercent };
}
