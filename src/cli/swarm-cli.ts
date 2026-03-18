/**
 * `soulclaw swarm` CLI — Swarm Memory management commands.
 *
 * Usage:
 *   soulclaw swarm init [--remote <url>]   Initialize swarm memory repo
 *   soulclaw swarm status                  Show swarm sync status
 *   soulclaw swarm sync                    Force sync now
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { colorize, theme } from "../terminal/theme.js";

function getSwarmDir(): string {
  const config = loadConfig();
  const swarmDir = (config as Record<string, unknown>)["swarmDir"] as string | undefined;
  if (swarmDir) {
    return swarmDir;
  }
  const stateDir = resolveStateDir();
  return path.join(stateDir, "swarm");
}

export function registerSwarmCli(program: Command) {
  const swarm = program
    .command("swarm")
    .description("Manage Swarm Memory — shared memory sync across agents");

  // ─── init ────────────────────────────────────────────────
  swarm
    .command("init")
    .description("Initialize swarm memory repository")
    .option("-r, --remote <url>", "Git remote URL for shared memory repo")
    .option("-d, --dir <path>", "Custom swarm directory path")
    .action(async (opts: { remote?: string; dir?: string }) => {
      const swarmDir = opts.dir ?? getSwarmDir();

      console.log(colorize(theme.info, `\nInitializing Swarm Memory at: ${swarmDir}\n`));

      // Create directory
      if (!fs.existsSync(swarmDir)) {
        fs.mkdirSync(swarmDir, { recursive: true });
        console.log(colorize(theme.success, "✓ Created swarm directory"));
      } else {
        console.log(colorize(theme.dim, "· Swarm directory already exists"));
      }

      // Init git repo
      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        try {
          execSync("git init", { cwd: swarmDir, stdio: "pipe" });
          console.log(colorize(theme.success, "✓ Initialized git repository"));
        } catch (err) {
          console.error(colorize(theme.error, `✗ Git init failed: ${String(err)}`));
          process.exit(1);
        }
      } else {
        console.log(colorize(theme.dim, "· Git repository already initialized"));
      }

      // Add remote if provided
      if (opts.remote) {
        try {
          // Check if remote already exists
          const existing = execSync("git remote get-url origin", {
            cwd: swarmDir,
            stdio: "pipe",
          })
            .toString()
            .trim();
          if (existing !== opts.remote) {
            execSync(`git remote set-url origin ${opts.remote}`, {
              cwd: swarmDir,
              stdio: "pipe",
            });
            console.log(colorize(theme.success, `✓ Updated remote: ${opts.remote}`));
          } else {
            console.log(colorize(theme.dim, `· Remote already set: ${opts.remote}`));
          }
        } catch {
          // No remote yet
          try {
            execSync(`git remote add origin ${opts.remote}`, {
              cwd: swarmDir,
              stdio: "pipe",
            });
            console.log(colorize(theme.success, `✓ Added remote: ${opts.remote}`));
          } catch (err) {
            console.error(colorize(theme.error, `✗ Failed to add remote: ${String(err)}`));
          }
        }
      }

      // Create initial MEMORY.md if not exists
      const memoryFile = path.join(swarmDir, "MEMORY.md");
      if (!fs.existsSync(memoryFile)) {
        fs.writeFileSync(memoryFile, "# Swarm Memory\n\nShared memory across agents.\n");
        console.log(colorize(theme.success, "✓ Created initial MEMORY.md"));
      }

      // Create memory/ directory
      const memoryDir = path.join(swarmDir, "memory");
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
        console.log(colorize(theme.success, "✓ Created memory/ directory"));
      }

      // Initial commit
      try {
        execSync("git add -A", { cwd: swarmDir, stdio: "pipe" });
        const status = execSync("git status --porcelain", { cwd: swarmDir, stdio: "pipe" })
          .toString()
          .trim();
        if (status) {
          execSync('git commit -m "swarm: initial setup"', { cwd: swarmDir, stdio: "pipe" });
          console.log(colorize(theme.success, "✓ Created initial commit"));
        }
      } catch {
        // Commit may fail if nothing to commit — that's ok
      }

      console.log(
        colorize(
          theme.info,
          `\nSwarm Memory initialized! Files will auto-sync every 10 minutes.\n`,
        ),
      );

      if (!opts.remote) {
        console.log(
          colorize(
            theme.dim,
            "Tip: Add a remote later with:\n" +
              `  cd ${swarmDir}\n` +
              "  git remote add origin <your-repo-url>\n",
          ),
        );
      }
    });

  // ─── status ──────────────────────────────────────────────
  swarm
    .command("status")
    .description("Show swarm memory status")
    .action(async () => {
      const swarmDir = getSwarmDir();

      if (!fs.existsSync(swarmDir)) {
        console.log(colorize(theme.warning, "Swarm not initialized. Run: soulclaw swarm init"));
        return;
      }

      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        console.log(colorize(theme.warning, "Swarm directory exists but is not a git repo."));
        return;
      }

      console.log(colorize(theme.info, `\nSwarm Memory Status\n`));
      console.log(`  Directory: ${swarmDir}`);

      // Check remote
      try {
        const remote = execSync("git remote get-url origin", {
          cwd: swarmDir,
          stdio: "pipe",
        })
          .toString()
          .trim();
        console.log(`  Remote: ${remote}`);
      } catch {
        console.log(`  Remote: ${colorize(theme.dim, "(none)")}`);
      }

      // Count files
      const memoryDir = path.join(swarmDir, "memory");
      let memoryFileCount = 0;
      if (fs.existsSync(memoryDir)) {
        memoryFileCount = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md")).length;
      }
      const hasMemoryMd = fs.existsSync(path.join(swarmDir, "MEMORY.md"));
      console.log(`  Files: MEMORY.md=${hasMemoryMd ? "✓" : "✗"}, memory/*.md=${memoryFileCount}`);

      // Last commit
      try {
        const lastCommit = execSync('git log -1 --format="%H %s" 2>/dev/null', {
          cwd: swarmDir,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (lastCommit) {
          console.log(`  Last commit: ${lastCommit.slice(0, 50)}...`);
        }
      } catch {
        console.log(`  Last commit: ${colorize(theme.dim, "(no commits)")}`);
      }

      // Git status
      try {
        const gitStatus = execSync("git status --porcelain", {
          cwd: swarmDir,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (gitStatus) {
          const lines = gitStatus.split("\n");
          console.log(`  Uncommitted changes: ${lines.length} file(s)`);
        } else {
          console.log(`  Working tree: ${colorize(theme.success, "clean")}`);
        }
      } catch {
        // ignore
      }

      console.log("");
    });

  // ─── sync ────────────────────────────────────────────────
  swarm
    .command("sync")
    .description("Force sync swarm memory now")
    .action(async () => {
      const swarmDir = getSwarmDir();

      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        console.log(colorize(theme.warning, "Swarm not initialized. Run: soulclaw swarm init"));
        return;
      }

      console.log(colorize(theme.info, "Syncing swarm memory..."));

      try {
        const { syncCycle } = await import("../swarm/auto-sync.js");
        const result = await syncCycle({ swarmDir });

        if (result.success) {
          console.log(colorize(theme.success, `✓ Sync complete: ${result.action}`));
          if (result.conflicts && result.conflicts.length > 0) {
            console.log(
              colorize(theme.warning, `  Conflicts resolved: ${result.conflicts.join(", ")}`),
            );
          }
        } else {
          console.log(colorize(theme.dim, `· Sync skipped: ${result.reason ?? "unknown"}`));
        }
      } catch (err) {
        console.error(colorize(theme.error, `✗ Sync failed: ${String(err)}`));
      }
    });
}
