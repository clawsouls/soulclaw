/**
 * Swarm auto-sync — automatic pull/push on heartbeat + workspace sync
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SwarmClient } from "./client.js";
import { type SwarmConfig, resolveSwarmConfig } from "./config.js";
import { resolveConflict } from "./conflict-resolver.js";

/**
 * Memory files to sync between swarm repo and workspace
 */
const SYNC_FILES = ["MEMORY.md"];
const SYNC_DIRS = ["memory"];

/**
 * Perform a full sync cycle: pull → resolve conflicts → push → sync to workspace
 */
export async function syncCycle(config?: Partial<SwarmConfig>): Promise<SyncResult> {
  const cfg = resolveSwarmConfig(config);
  const client = new SwarmClient(cfg);

  const status = await client.status();
  if (!status.initialized) {
    return { success: false, action: "skip", reason: "swarm not initialized" };
  }

  // 1. Pull from remote
  const pullResult = await client.pull();

  if (!pullResult.success && pullResult.conflicts.length > 0) {
    // Attempt conflict resolution
    for (const file of pullResult.conflicts) {
      const filePath = join(cfg.swarmDir, file);
      if (existsSync(filePath)) {
        await resolveConflict(filePath, cfg);
      }
    }
  }

  // 2. Sync workspace → swarm (copy workspace changes into swarm dir)
  syncFromWorkspace(cfg.swarmDir);

  // 3. Push changes
  const pushed = await client.push();

  // 4. Sync swarm → workspace
  syncToWorkspace(cfg.swarmDir);

  return {
    success: true,
    action: pushed ? "synced" : "no-changes",
    conflicts: pullResult.conflicts,
  };
}

export interface SyncResult {
  success: boolean;
  action: "synced" | "no-changes" | "skip";
  reason?: string;
  conflicts?: string[];
}

/**
 * Get workspace directory from env or default
 */
function getWorkspaceDir(): string {
  return process.env["OPENCLAW_STATE_DIR"]
    ? join(process.env["OPENCLAW_STATE_DIR"], "workspace")
    : join(homedir(), ".openclaw", "workspace");
}

/**
 * Copy memory files from swarm directory to workspace
 */
export function syncToWorkspace(swarmDir: string): number {
  const workspaceDir = getWorkspaceDir();
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  let synced = 0;

  // Sync individual files
  for (const f of SYNC_FILES) {
    const src = join(swarmDir, f);
    if (existsSync(src)) {
      copyFileSync(src, join(workspaceDir, f));
      synced++;
    }
  }

  // Sync directories
  for (const dir of SYNC_DIRS) {
    const srcDir = join(swarmDir, dir);
    if (existsSync(srcDir)) {
      const destDir = join(workspaceDir, dir);
      mkdirSync(destDir, { recursive: true });
      for (const f of readdirSync(srcDir)) {
        if (f.endsWith(".md")) {
          copyFileSync(join(srcDir, f), join(destDir, f));
          synced++;
        }
      }
    }
  }

  return synced;
}

/**
 * Copy memory files from workspace to swarm directory
 */
export function syncFromWorkspace(swarmDir: string): number {
  const workspaceDir = getWorkspaceDir();
  if (!existsSync(workspaceDir)) {
    return 0;
  }

  let synced = 0;

  for (const f of SYNC_FILES) {
    const src = join(workspaceDir, f);
    if (existsSync(src)) {
      mkdirSync(swarmDir, { recursive: true });
      copyFileSync(src, join(swarmDir, f));
      synced++;
    }
  }

  for (const dir of SYNC_DIRS) {
    const srcDir = join(workspaceDir, dir);
    if (existsSync(srcDir)) {
      const destDir = join(swarmDir, dir);
      mkdirSync(destDir, { recursive: true });
      for (const f of readdirSync(srcDir)) {
        if (f.endsWith(".md")) {
          copyFileSync(join(srcDir, f), join(destDir, f));
          synced++;
        }
      }
    }
  }

  return synced;
}
