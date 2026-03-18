/**
 * `soulclaw soulscan` CLI — Run SoulScan on soul files.
 *
 * Usage:
 *   soulclaw soulscan [dir]        Scan a soul directory (default: workspace)
 *   soulclaw soulscan --json       Output results as JSON
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolveStateDir } from "../config/paths.js";
import { colorize, theme } from "../terminal/theme.js";

export function registerSoulScanCli(program: Command) {
  program
    .command("soulscan")
    .description("Scan soul files for security and quality issues")
    .argument("[dir]", "Directory to scan (default: workspace)")
    .option("--json", "Output results as JSON")
    .option("--min-score <n>", "Minimum passing score (default: 30)", "30")
    .action(async (dir?: string, opts?: { json?: boolean; minScore?: string }) => {
      const targetDir = dir ?? path.join(resolveStateDir(), "workspace");

      if (!fs.existsSync(targetDir)) {
        console.error(colorize(theme.error, `Directory not found: ${targetDir}`));
        process.exit(1);
      }

      // Check for soul files
      const hasSoulMd = fs.existsSync(path.join(targetDir, "SOUL.md"));
      const hasSoulJson = fs.existsSync(path.join(targetDir, "soul.json"));
      if (!hasSoulMd && !hasSoulJson) {
        console.error(colorize(theme.warning, `No SOUL.md or soul.json found in: ${targetDir}`));
        process.exit(1);
      }

      const { scanSoul } = await import("../soulscan/engine.js");
      const { formatSummary } = await import("../soulscan/report.js");

      console.log(colorize(theme.info, `\nScanning: ${targetDir}\n`));

      const result = await scanSoul(targetDir);
      const minScore = parseInt(opts?.minScore ?? "30", 10);

      if (opts?.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // Score + Grade
        const scoreColor =
          result.score >= 90
            ? theme.success
            : result.score >= 70
              ? theme.info
              : result.score >= 40
                ? theme.warning
                : theme.error;

        console.log(`  Score: ${colorize(scoreColor, `${result.score}/100`)}`);
        console.log(`  Grade: ${colorize(scoreColor, result.grade)}`);
        console.log(
          `  Passed: ${result.passed ? colorize(theme.success, "✓") : colorize(theme.error, "✗")}`,
        );
        console.log("");

        // Issues
        if (result.issues.length > 0) {
          console.log(`  Issues (${result.issues.length}):`);
          for (const issue of result.issues) {
            const icon =
              issue.severity === "error"
                ? colorize(theme.error, "✗")
                : issue.severity === "warning"
                  ? colorize(theme.warning, "⚠")
                  : colorize(theme.dim, "ℹ");
            const fileInfo = issue.file ? ` [${issue.file}]` : "";
            console.log(`    ${icon} ${issue.code}: ${issue.message}${fileInfo}`);
          }
        } else {
          console.log(colorize(theme.success, "  No issues found!"));
        }

        console.log("");

        // Summary
        console.log(`  ${formatSummary(result)}`);

        // Pass/fail verdict
        if (result.score < minScore) {
          console.log(
            colorize(
              theme.error,
              `\n  ✗ FAILED: Score ${result.score} below minimum ${minScore}\n`,
            ),
          );
          process.exit(1);
        } else {
          console.log(colorize(theme.success, `\n  ✓ PASSED\n`));
        }
      }
    });
}
