/**
 * SwarmClient — Git-based swarm memory operations
 *
 * Manages a shared git repository at ~/.openclaw/swarm/ where multiple agents
 * can sync memory files via agent/{name} branches.
 */

import { execFile } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { type SwarmConfig, resolveSwarmConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface SwarmStatus {
  initialized: boolean;
  currentBranch: string | null;
  agentBranch: string | null;
  agentBranches: string[];
  hasChanges: boolean;
}

export class SwarmClient {
  private config: SwarmConfig;

  constructor(config?: Partial<SwarmConfig>) {
    this.config = resolveSwarmConfig(config);
  }

  get swarmDir(): string {
    return this.config.swarmDir;
  }

  // ─── Git helpers ────────────────────────────────────

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.swarmDir,
      env: { ...process.env },
    });
    return stdout.trim();
  }

  private async gitSafe(...args: string[]): Promise<string | null> {
    try {
      return await this.git(...args);
    } catch {
      return null;
    }
  }

  // ─── Operations ─────────────────────────────────────

  /**
   * Initialize the swarm directory as a git repo.
   * If repoUrl is provided, clone it; otherwise init a bare local repo.
   */
  async init(repoUrl?: string): Promise<void> {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }

    const gitDir = join(this.swarmDir, ".git");
    if (existsSync(gitDir)) {
      return; // already initialized
    }

    if (repoUrl) {
      // Clone into swarm dir
      const parent = join(this.swarmDir, "..");
      mkdirSync(parent, { recursive: true });
      await execFileAsync("git", ["clone", repoUrl, this.swarmDir]);
    } else {
      await this.git("init");
      // Create initial commit so branches work
      await this.git("commit", "--allow-empty", "-m", "swarm: init");
    }
  }

  /**
   * Join the swarm as a named agent. Creates agent/{name} branch.
   */
  async join(agentName: string): Promise<string> {
    const branch = `agent/${agentName}`;

    // Check if branch exists
    const existing = await this.gitSafe("rev-parse", "--verify", branch);
    if (existing) {
      await this.git("checkout", branch);
    } else {
      // Create from current HEAD (main)
      const mainBranch = await this.getMainBranch();
      await this.git("checkout", "-b", branch, mainBranch);
    }

    return branch;
  }

  /**
   * Switch to a different branch
   */
  async switch(branch: string): Promise<void> {
    await this.git("checkout", branch);
  }

  /**
   * Stage and push memory files on the current agent branch.
   */
  async push(message?: string): Promise<boolean> {
    // Stage memory files
    const memoryFiles = ["MEMORY.md"];
    for (const f of memoryFiles) {
      if (existsSync(join(this.swarmDir, f))) {
        await this.gitSafe("add", f);
      }
    }
    // Stage memory/ directory
    if (existsSync(join(this.swarmDir, "memory"))) {
      await this.gitSafe("add", "memory/");
    }

    // Check if there's anything to commit
    const status = await this.git("status", "--porcelain");
    if (!status) {
      return false;
    }

    const now = new Date().toISOString().replace("T", " ").substring(0, 16);
    const commitMsg = message || `swarm: sync ${now}`;
    await this.git("commit", "-m", commitMsg);

    // Push to remote if configured
    const remote = await this.gitSafe("remote", "get-url", "origin");
    if (remote) {
      const branch = await this.getCurrentBranch();
      if (branch) {
        await this.gitSafe("push", "origin", branch);
      }
    }

    return true;
  }

  /**
   * Pull latest from remote and rebase current branch on main.
   * Returns true if successful, false if conflicts detected.
   */
  async pull(): Promise<{ success: boolean; conflicts: string[] }> {
    const remote = await this.gitSafe("remote", "get-url", "origin");

    if (remote) {
      await this.gitSafe("fetch", "origin");
    }

    const mainBranch = await this.getMainBranch();
    const remoteMain = remote ? `origin/${mainBranch}` : mainBranch;

    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === mainBranch) {
      // On main, just pull
      if (remote) {
        await this.gitSafe("pull", "origin", mainBranch);
      }
      return { success: true, conflicts: [] };
    }

    // On agent branch — rebase on main
    const result = await this.gitSafe("rebase", remoteMain);
    if (result === null) {
      // Conflict — get list and abort
      const conflictOutput = await this.gitSafe("diff", "--name-only", "--diff-filter=U");
      const conflicts = conflictOutput?.split("\n").filter(Boolean) || [];
      await this.gitSafe("rebase", "--abort");
      return { success: false, conflicts };
    }

    return { success: true, conflicts: [] };
  }

  /**
   * Merge an agent branch into main.
   * Returns conflicting files if any.
   */
  async merge(agentBranch: string): Promise<{ success: boolean; conflicts: string[] }> {
    const mainBranch = await this.getMainBranch();
    await this.git("checkout", mainBranch);

    const result = await this.gitSafe(
      "merge",
      agentBranch,
      "-m",
      `swarm merge: ${agentBranch} → ${mainBranch}`,
    );
    if (result === null) {
      const conflictOutput = await this.gitSafe("diff", "--name-only", "--diff-filter=U");
      const conflicts = conflictOutput?.split("\n").filter(Boolean) || [];
      await this.gitSafe("merge", "--abort");
      return { success: false, conflicts };
    }

    return { success: true, conflicts: [] };
  }

  // ─── Status / Info ──────────────────────────────────

  async status(): Promise<SwarmStatus> {
    const gitDir = join(this.swarmDir, ".git");
    if (!existsSync(gitDir)) {
      return {
        initialized: false,
        currentBranch: null,
        agentBranch: null,
        agentBranches: [],
        hasChanges: false,
      };
    }

    const currentBranch = await this.getCurrentBranch();
    const agentBranch = currentBranch?.startsWith("agent/") ? currentBranch : null;
    const agentBranches = await this.listAgentBranches();
    const statusOutput = await this.gitSafe("status", "--porcelain");

    return {
      initialized: true,
      currentBranch,
      agentBranch,
      agentBranches,
      hasChanges: !!statusOutput,
    };
  }

  async getCurrentBranch(): Promise<string | null> {
    return this.gitSafe("rev-parse", "--abbrev-ref", "HEAD");
  }

  async getMainBranch(): Promise<string> {
    // Try to detect main branch
    const symbolic = await this.gitSafe("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    if (symbolic) {
      return symbolic.replace("origin/", "");
    }

    // Check if 'main' exists
    const main = await this.gitSafe("rev-parse", "--verify", "main");
    if (main) {
      return "main";
    }

    // Fallback to current branch or 'master'
    const current = await this.getCurrentBranch();
    return current || "master";
  }

  async listAgentBranches(): Promise<string[]> {
    const output = await this.gitSafe("branch", "--list", "agent/*");
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((b) => b.trim().replace(/^\*\s*/, ""))
      .filter(Boolean);
  }
}
