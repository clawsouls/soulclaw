/**
 * `soulclaw persona` CLI — Persona drift detection and metrics.
 *
 * Usage:
 *   soulclaw persona check           Check current drift score
 *   soulclaw persona metrics          Show drift history
 *   soulclaw persona rules            Show parsed persona rules
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolveStateDir } from "../config/paths.js";
import { colorize, theme } from "../terminal/theme.js";

function getWorkspaceDir(): string {
  return path.join(resolveStateDir(), "workspace");
}

export function registerPersonaCli(program: Command) {
  const persona = program.command("persona").description("Persona drift detection and metrics");

  // ─── check ───────────────────────────────────────────────
  persona
    .command("check")
    .description("Run a drift check on the last session")
    .option("-t, --text <response>", "Response text to check against persona")
    .option("--workspace <dir>", "Workspace directory")
    .action(async (opts: { text?: string; workspace?: string }) => {
      const workspaceDir = opts.workspace ?? getWorkspaceDir();
      const soulMdPath = path.join(workspaceDir, "SOUL.md");

      if (!fs.existsSync(soulMdPath)) {
        console.error(colorize(theme.warning, "No SOUL.md found in workspace."));
        process.exit(1);
      }

      const { parseSoulSpec } = await import("../persona/parser.js");
      const { detectDrift } = await import("../persona/drift-detector.js");
      const { evaluateDrift } = await import("../persona/enforcer.js");
      const { mergeConfig } = await import("../persona/config.js");

      const content = fs.readFileSync(soulMdPath, "utf-8");
      const rules = parseSoulSpec(content, "markdown");
      const config = mergeConfig();

      // Use provided text or prompt for input
      const responseText =
        opts.text ??
        "This is a sample response to test persona alignment. Please provide a response with --text flag for accurate results.";

      console.log(colorize(theme.info, "\nPersona Drift Check\n"));
      console.log(`  Persona: ${rules.name || "(unnamed)"}`);
      console.log(`  Tone: ${rules.tone.join(", ") || "(none)"}`);
      console.log(`  Method: ${config.useOllama ? "Ollama → keyword fallback" : "keyword only"}`);
      console.log("");

      const result = await detectDrift(responseText, rules, config);
      const action = evaluateDrift(result, config);

      const scoreColor =
        result.score <= 0.3 ? theme.success : result.score <= 0.7 ? theme.warning : theme.error;

      console.log(`  Drift Score: ${colorize(scoreColor, result.score.toFixed(3))}`);
      console.log(`  Method Used: ${result.method}`);
      console.log(`  Action: ${action.type}`);

      if (result.details) {
        console.log(`  Details: ${result.details}`);
      }

      if (action.type === "none") {
        console.log(colorize(theme.success, "\n  ✓ Persona aligned\n"));
      } else if (action.type === "reminder") {
        console.log(
          colorize(theme.warning, "\n  ⚠ Minor drift detected — reminder would be injected\n"),
        );
      } else {
        console.log(colorize(theme.error, "\n  ✗ Severe drift — correction needed\n"));
      }
    });

  // ─── metrics ─────────────────────────────────────────────
  persona
    .command("metrics")
    .description("Show drift check history")
    .option("-n, --last <count>", "Show last N entries", "20")
    .option("--workspace <dir>", "Workspace directory")
    .action(async (opts: { last?: string; workspace?: string }) => {
      const workspaceDir = opts.workspace ?? getWorkspaceDir();
      const { mergeConfig } = await import("../persona/config.js");
      const { getAllMetrics, getAverageDrift } = await import("../persona/metrics.js");

      const config = mergeConfig({
        metricsPath: path.join(workspaceDir, "data/persona-metrics.json"),
      });
      const entries = await getAllMetrics(config);
      const lastN = parseInt(opts.last ?? "20", 10);

      if (entries.length === 0) {
        console.log(colorize(theme.dim, "\nNo drift metrics recorded yet.\n"));
        return;
      }

      const avg = await getAverageDrift(config, lastN);
      const recent = entries.slice(-lastN);

      console.log(
        colorize(theme.info, `\nPersona Drift Metrics (last ${recent.length}/${entries.length})\n`),
      );
      console.log(`  Average drift: ${avg.toFixed(3)}`);
      console.log("");

      for (const entry of recent) {
        const date = new Date(entry.timestamp).toISOString().slice(0, 19);
        const scoreColor =
          entry.score <= 0.3 ? theme.success : entry.score <= 0.7 ? theme.warning : theme.error;
        console.log(
          `  ${date}  ${colorize(scoreColor, entry.score.toFixed(3).padStart(5))}  [${entry.method}]`,
        );
      }
      console.log("");
    });

  // ─── rules ───────────────────────────────────────────────
  persona
    .command("rules")
    .description("Show parsed persona rules from SOUL.md")
    .option("--workspace <dir>", "Workspace directory")
    .option("--json", "Output as JSON")
    .action(async (opts: { workspace?: string; json?: boolean }) => {
      const workspaceDir = opts.workspace ?? getWorkspaceDir();
      const soulMdPath = path.join(workspaceDir, "SOUL.md");

      if (!fs.existsSync(soulMdPath)) {
        console.error(colorize(theme.warning, "No SOUL.md found in workspace."));
        process.exit(1);
      }

      const { parseSoulSpec, rulesToPromptBlock } = await import("../persona/parser.js");
      const content = fs.readFileSync(soulMdPath, "utf-8");
      const rules = parseSoulSpec(content, "markdown");

      if (opts.json) {
        console.log(JSON.stringify(rules, null, 2));
      } else {
        console.log(colorize(theme.info, "\nParsed Persona Rules\n"));
        console.log(`  Name: ${rules.name || "(unnamed)"}`);
        console.log(`  Tone: ${rules.tone.length ? rules.tone.join(", ") : "(none)"}`);
        console.log(`  Style: ${rules.style.length ? rules.style.join(", ") : "(none)"}`);

        if (rules.principles.length) {
          console.log("\n  Principles:");
          for (const p of rules.principles) {
            console.log(`    · ${p}`);
          }
        }

        if (rules.boundaries.length) {
          console.log("\n  Boundaries:");
          for (const b of rules.boundaries) {
            console.log(`    · ${b}`);
          }
        }

        if (rules.communicationRules.length) {
          console.log("\n  Communication Rules:");
          for (const r of rules.communicationRules) {
            console.log(`    · ${r}`);
          }
        }

        console.log(colorize(theme.dim, "\n  --- Prompt Block ---"));
        console.log(colorize(theme.dim, `  ${rulesToPromptBlock(rules).replace(/\n/g, "\n  ")}`));
        console.log("");
      }
    });

  // ─── config ──────────────────────────────────────────────
  persona
    .command("config")
    .description("Show or set persona drift detection settings")
    .option("--enable", "Enable persona drift detection")
    .option("--disable", "Disable persona drift detection")
    .option("--interval <n>", "Check every N agent responses")
    .option("--threshold <n>", "Drift warning threshold (0-1)")
    .option("--severe <n>", "Severe drift threshold (0-1)")
    .option("--notify", "Enable notifications on drift")
    .option("--no-notify", "Disable notifications on drift")
    .option("--ollama", "Use Ollama for detection")
    .option("--no-ollama", "Use keyword-only detection")
    .option("--model <model>", "Ollama model for drift detection")
    .action(
      async (opts: {
        enable?: boolean;
        disable?: boolean;
        interval?: string;
        threshold?: string;
        severe?: string;
        notify?: boolean;
        ollama?: boolean;
        model?: string;
      }) => {
        const configPath = path.join(resolveStateDir(), "..", "openclaw.json");

        // Read current config
        let config: Record<string, unknown> = {};
        if (fs.existsSync(configPath)) {
          try {
            config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
          } catch {
            console.error(colorize(theme.error, "Failed to parse openclaw.json"));
            process.exit(1);
          }
        }

        // Navigate to agents.defaults.personaDrift
        if (!config["agents"]) {
          config["agents"] = {};
        }
        const agents = config["agents"] as Record<string, unknown>;
        if (!agents["defaults"]) {
          agents["defaults"] = {};
        }
        const defaults = agents["defaults"] as Record<string, unknown>;
        if (!defaults["personaDrift"]) {
          defaults["personaDrift"] = {};
        }
        const drift = defaults["personaDrift"] as Record<string, unknown>;

        const hasChanges =
          opts.enable !== undefined ||
          opts.disable !== undefined ||
          opts.interval !== undefined ||
          opts.threshold !== undefined ||
          opts.severe !== undefined ||
          opts.notify !== undefined ||
          opts.ollama !== undefined ||
          opts.model !== undefined;

        if (!hasChanges) {
          // Show current config
          console.log(colorize(theme.info, "\nPersona Drift Configuration\n"));
          const dEnabled = drift["enabled"] === true;
          const dInterval = typeof drift["checkInterval"] === "number" ? drift["checkInterval"] : 5;
          const dThreshold =
            typeof drift["driftThreshold"] === "number" ? drift["driftThreshold"] : 0.3;
          const dSevere =
            typeof drift["severeThreshold"] === "number" ? drift["severeThreshold"] : 0.7;
          const dNotify = drift["notify"] !== false;
          const dOllama = drift["useOllama"] !== false;
          const dModel =
            typeof drift["ollamaModel"] === "string" ? drift["ollamaModel"] : "qwen3:8b";

          console.log(
            `  Enabled: ${dEnabled ? colorize(theme.success, "yes") : colorize(theme.dim, "no (default)")}`,
          );
          console.log(`  Check interval: every ${dInterval} responses`);
          console.log(`  Warning threshold: ${dThreshold}`);
          console.log(`  Severe threshold: ${dSevere}`);
          console.log(`  Notifications: ${dNotify ? "on (default)" : "off"}`);
          console.log(`  Ollama: ${dOllama ? "on (default)" : "off (keyword only)"}`);
          console.log(`  Ollama model: ${dModel}`);
          console.log(
            colorize(
              theme.dim,
              "\n  Enable with: soulclaw persona config --enable\n" +
                "  Customize: soulclaw persona config --interval 3 --threshold 0.4\n",
            ),
          );
          return;
        }

        // Apply changes
        if (opts.enable) {
          drift["enabled"] = true;
        }
        if (opts.disable) {
          drift["enabled"] = false;
        }
        if (opts.interval) {
          drift["checkInterval"] = parseInt(opts.interval, 10);
        }
        if (opts.threshold) {
          drift["driftThreshold"] = parseFloat(opts.threshold);
        }
        if (opts.severe) {
          drift["severeThreshold"] = parseFloat(opts.severe);
        }
        if (opts.notify !== undefined) {
          drift["notify"] = opts.notify;
        }
        if (opts.ollama !== undefined) {
          drift["useOllama"] = opts.ollama;
        }
        if (opts.model) {
          drift["ollamaModel"] = opts.model;
        }

        // Save
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

        console.log(colorize(theme.success, "\n✓ Persona drift configuration updated.\n"));

        if (opts.enable) {
          console.log(
            colorize(
              theme.info,
              "  Drift detection is now ON. Checks run every " +
                `${typeof drift["checkInterval"] === "number" ? drift["checkInterval"] : 5} agent responses.\n`,
            ),
          );
        }
        if (opts.disable) {
          console.log(colorize(theme.dim, "  Drift detection is now OFF.\n"));
        }

        console.log(colorize(theme.dim, "  Restart gateway for changes to take effect.\n"));
      },
    );
}
