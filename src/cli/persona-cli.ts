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
}
