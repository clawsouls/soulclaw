/**
 * `soulclaw swarm` CLI — Swarm Memory management commands.
 *
 * Usage:
 *   soulclaw swarm init [--remote <url>]       Initialize swarm memory repo
 *   soulclaw swarm status                      Show swarm sync status
 *   soulclaw swarm sync [--llm-merge]          Force sync now
 *   soulclaw swarm resolve [file] [--llm|--ours|--theirs|--manual]
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

      if (!fs.existsSync(swarmDir)) {
        fs.mkdirSync(swarmDir, { recursive: true });
        console.log(colorize(theme.success, "✓ Created swarm directory"));
      } else {
        console.log(colorize(theme.muted, "· Swarm directory already exists"));
      }

      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        try {
          execSync("git init", { cwd: swarmDir, stdio: "pipe" });
          console.log(colorize(theme.success, "✓ Initialized git repository"));
        } catch (err) {
          console.error(colorize(theme.error, `✗ Git init failed: ${String(err)}`));
          process.exit(1);
        }
      } else {
        console.log(colorize(theme.muted, "· Git repository already initialized"));
      }

      if (opts.remote) {
        try {
          const existing = execSync("git remote get-url origin", {
            cwd: swarmDir,
            stdio: "pipe",
          })
            .toString()
            .trim();
          if (existing !== opts.remote) {
            execSync(`git remote set-url origin ${opts.remote}`, { cwd: swarmDir, stdio: "pipe" });
            console.log(colorize(theme.success, `✓ Updated remote: ${opts.remote}`));
          } else {
            console.log(colorize(theme.muted, `· Remote already set: ${opts.remote}`));
          }
        } catch {
          try {
            execSync(`git remote add origin ${opts.remote}`, { cwd: swarmDir, stdio: "pipe" });
            console.log(colorize(theme.success, `✓ Added remote: ${opts.remote}`));
          } catch (err) {
            console.error(colorize(theme.error, `✗ Failed to add remote: ${String(err)}`));
          }
        }
      }

      const memoryFile = path.join(swarmDir, "MEMORY.md");
      if (!fs.existsSync(memoryFile)) {
        fs.writeFileSync(memoryFile, "# Swarm Memory\n\nShared memory across agents.\n");
        console.log(colorize(theme.success, "✓ Created initial MEMORY.md"));
      }

      const memoryDir = path.join(swarmDir, "memory");
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
        console.log(colorize(theme.success, "✓ Created memory/ directory"));
      }

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
        // nothing to commit
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
            theme.muted,
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
        console.log(colorize(theme.warn, "Swarm not initialized. Run: soulclaw swarm init"));
        return;
      }

      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        console.log(colorize(theme.warn, "Swarm directory exists but is not a git repo."));
        return;
      }

      console.log(colorize(theme.info, `\nSwarm Memory Status\n`));
      console.log(`  Directory: ${swarmDir}`);

      try {
        const remote = execSync("git remote get-url origin", { cwd: swarmDir, stdio: "pipe" })
          .toString()
          .trim();
        console.log(`  Remote: ${remote}`);
      } catch {
        console.log(`  Remote: ${colorize(theme.muted, "(none)")}`);
      }

      const memoryDir = path.join(swarmDir, "memory");
      let memoryFileCount = 0;
      if (fs.existsSync(memoryDir)) {
        memoryFileCount = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md")).length;
      }
      const hasMemoryMd = fs.existsSync(path.join(swarmDir, "MEMORY.md"));
      console.log(`  Files: MEMORY.md=${hasMemoryMd ? "✓" : "✗"}, memory/*.md=${memoryFileCount}`);

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
        console.log(`  Last commit: ${colorize(theme.muted, "(no commits)")}`);
      }

      try {
        const gitStatus = execSync("git status --porcelain", { cwd: swarmDir, stdio: "pipe" })
          .toString()
          .trim();
        if (gitStatus) {
          console.log(`  Uncommitted changes: ${gitStatus.split("\n").length} file(s)`);
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
    .option("--llm-merge", "Use LLM for semantic conflict resolution (default: fallback to 'ours')")
    .option("--model <model>", "Ollama model for LLM merge (default: gemma3:4b)")
    .action(async (opts: { llmMerge?: boolean; model?: string }) => {
      const swarmDir = getSwarmDir();

      if (!fs.existsSync(path.join(swarmDir, ".git"))) {
        console.log(colorize(theme.warn, "Swarm not initialized. Run: soulclaw swarm init"));
        return;
      }

      console.log(colorize(theme.info, "Syncing swarm memory..."));
      if (opts.llmMerge) {
        console.log(
          colorize(theme.muted, `  LLM merge enabled (model: ${opts.model ?? "gemma3:4b"})`),
        );
      }

      try {
        const { syncCycle } = await import("../swarm/auto-sync.js");
        const syncConfig: Record<string, unknown> = { swarmDir };
        if (opts.model) {
          syncConfig["llmModel"] = opts.model;
        }
        if (!opts.llmMerge) {
          syncConfig["ollamaUrl"] = "http://localhost:0";
        } // disable LLM
        const result = await syncCycle(syncConfig as never);

        if (result.success) {
          console.log(colorize(theme.success, `✓ Sync complete: ${result.action}`));
          if (result.conflicts && result.conflicts.length > 0) {
            console.log(
              colorize(theme.warn, `  Conflicts resolved: ${result.conflicts.join(", ")}`),
            );
          }
        } else {
          console.log(colorize(theme.muted, `· Sync skipped: ${result.reason ?? "unknown"}`));
        }
      } catch (err) {
        console.error(colorize(theme.error, `✗ Sync failed: ${String(err)}`));
      }
    });

  // ─── resolve ─────────────────────────────────────────────
  swarm
    .command("resolve")
    .description("Resolve merge conflicts in swarm files")
    .argument("[file]", "Specific file to resolve (default: all conflicted files)")
    .option("--llm", "Use LLM for semantic merge (default)")
    .option("--manual", "List conflicted files for manual editing")
    .option("--ours", "Keep our version (discard theirs)")
    .option("--theirs", "Keep their version (discard ours)")
    .option("--model <model>", "Ollama model for LLM merge")
    .action(
      async (
        file?: string,
        opts?: {
          llm?: boolean;
          manual?: boolean;
          ours?: boolean;
          theirs?: boolean;
          model?: string;
        },
      ) => {
        const swarmDir = getSwarmDir();

        if (!fs.existsSync(path.join(swarmDir, ".git"))) {
          console.log(colorize(theme.warn, "Swarm not initialized. Run: soulclaw swarm init"));
          return;
        }

        const { resolveConflict, hasConflictMarkers } =
          await import("../swarm/conflict-resolver.js");

        // Find files with conflicts
        let targetFiles: string[] = [];
        if (file) {
          const filePath = path.resolve(swarmDir, file);
          if (!fs.existsSync(filePath)) {
            console.error(colorize(theme.error, `File not found: ${filePath}`));
            process.exit(1);
          }
          targetFiles = [filePath];
        } else {
          const scanDir = (dir: string) => {
            if (!fs.existsSync(dir)) {
              return;
            }
            for (const f of fs.readdirSync(dir)) {
              const fp = path.join(dir, f);
              const stat = fs.statSync(fp);
              if (stat.isFile() && f.endsWith(".md")) {
                const content = fs.readFileSync(fp, "utf-8");
                if (hasConflictMarkers(content)) {
                  targetFiles.push(fp);
                }
              } else if (stat.isDirectory() && f !== ".git") {
                scanDir(fp);
              }
            }
          };
          scanDir(swarmDir);
        }

        if (targetFiles.length === 0) {
          console.log(colorize(theme.success, "\nNo conflicts found.\n"));
          return;
        }

        console.log(
          colorize(theme.info, `\nResolving ${targetFiles.length} conflicted file(s):\n`),
        );

        for (const fp of targetFiles) {
          const relPath = path.relative(swarmDir, fp);

          if (opts?.manual) {
            console.log(
              colorize(
                theme.warn,
                `  ⚠ ${relPath} — edit manually, then run 'soulclaw swarm sync'`,
              ),
            );
            continue;
          }

          if (opts?.theirs) {
            const content = fs.readFileSync(fp, "utf-8");
            fs.writeFileSync(fp, keepSide(content, "theirs"));
            console.log(colorize(theme.success, `  ✓ ${relPath} — kept theirs`));
            continue;
          }

          if (opts?.ours) {
            const content = fs.readFileSync(fp, "utf-8");
            fs.writeFileSync(fp, keepSide(content, "ours"));
            console.log(colorize(theme.success, `  ✓ ${relPath} — kept ours`));
            continue;
          }

          // Default: LLM merge
          const config: Record<string, unknown> = {};
          if (opts?.model) {
            config["llmModel"] = opts.model;
          }
          const result = await resolveConflict(fp, config as never);
          const methodLabel = result.method === "llm" ? "LLM semantic merge" : "fallback (ours)";
          console.log(
            colorize(
              theme.success,
              `  ✓ ${relPath} — ${methodLabel}${result.reason ? ` (${result.reason})` : ""}`,
            ),
          );
        }

        console.log("");
      },
    );
}

/** Keep one side of git conflict markers */
function keepSide(content: string, side: "ours" | "theirs"): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inConflict = false;
  let inOurs = false;

  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      inOurs = true;
      continue;
    }
    if (line.startsWith("=======")) {
      inOurs = false;
      continue;
    }
    if (line.startsWith(">>>>>>>")) {
      inConflict = false;
      continue;
    }
    if (!inConflict) {
      result.push(line);
    } else if (side === "ours" && inOurs) {
      result.push(line);
    } else if (side === "theirs" && !inOurs) {
      result.push(line);
    }
  }
  return result.join("\n");
}
