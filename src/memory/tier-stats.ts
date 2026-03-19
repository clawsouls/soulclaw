/**
 * Soul Memory — Tier Statistics
 *
 * Computes file counts and sizes for each memory tier.
 */

import fs from "node:fs/promises";
import path from "node:path";

const DATED_FILE_RE = /^\d{4}-\d{2}-\d{2}(?:[-_].+)?\.md$/;
const SOUL_FILES = ["SOUL.md", "IDENTITY.md"];

export interface TierStats {
  t0: { files: number; bytes: number; paths: string[] };
  t1: { files: number; bytes: number; paths: string[] };
  t2: { files: number; bytes: number; paths: string[] };
  total: { files: number; bytes: number };
}

/**
 * Compute tier statistics for a workspace.
 */
export async function computeTierStats(workspaceDir: string): Promise<TierStats> {
  const stats: TierStats = {
    t0: { files: 0, bytes: 0, paths: [] },
    t1: { files: 0, bytes: 0, paths: [] },
    t2: { files: 0, bytes: 0, paths: [] },
    total: { files: 0, bytes: 0 },
  };

  // T0: Soul files
  for (const name of SOUL_FILES) {
    const fullPath = path.join(workspaceDir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        stats.t0.files++;
        stats.t0.bytes += stat.size;
        stats.t0.paths.push(name);
      }
    } catch {
      // File doesn't exist
    }
  }

  // T1 + T2: MEMORY.md + memory/ directory
  const memoryMd = path.join(workspaceDir, "MEMORY.md");
  try {
    const stat = await fs.stat(memoryMd);
    if (stat.isFile()) {
      stats.t1.files++;
      stats.t1.bytes += stat.size;
      stats.t1.paths.push("MEMORY.md");
    }
  } catch {
    // No MEMORY.md
  }

  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const fullPath = path.join(memoryDir, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) {
          continue;
        }

        if (DATED_FILE_RE.test(entry)) {
          // T2: Working Memory (dated)
          stats.t2.files++;
          stats.t2.bytes += stat.size;
          stats.t2.paths.push(`memory/${entry}`);
        } else {
          // T1: Core Memory (undated/evergreen)
          stats.t1.files++;
          stats.t1.bytes += stat.size;
          stats.t1.paths.push(`memory/${entry}`);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // No memory/ directory
  }

  stats.total.files = stats.t0.files + stats.t1.files + stats.t2.files;
  stats.total.bytes = stats.t0.bytes + stats.t1.bytes + stats.t2.bytes;

  return stats;
}

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format tier stats as a compact display string.
 */
export function formatTierStatsCompact(stats: TierStats): string[] {
  return [
    `T0 Soul: ${stats.t0.files} files (${formatBytes(stats.t0.bytes)})`,
    `T1 Core: ${stats.t1.files} files (${formatBytes(stats.t1.bytes)})`,
    `T2 Working: ${stats.t2.files} files (${formatBytes(stats.t2.bytes)})`,
    `Total: ${stats.total.files} files (${formatBytes(stats.total.bytes)})`,
  ];
}
