/**
 * SoulScan Report — Human-readable scan result formatting.
 */

import type { ScanResult } from "./engine.ts";

// ─── Formatting ──────────────────────────────────────────

const GRADE_EMOJI: Record<string, string> = {
  Verified: "✅",
  "Low Risk": "🟡",
  "Medium Risk": "🟠",
  "High Risk": "🔴",
  Blocked: "⛔",
};

const SEVERITY_ICON: Record<string, string> = {
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

/**
 * Format scan result as a human-readable report string.
 */
export function formatReport(result: ScanResult): string {
  const lines: string[] = [];
  const emoji = GRADE_EMOJI[result.grade] || "❓";

  lines.push(`${emoji} SoulScan Report — ${result.grade} (${result.score}/100)`);
  lines.push(`Scanner v${result.scannerVersion} · ${result.scanDurationMs}ms`);
  lines.push("");

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  if (errors.length > 0) {
    lines.push(`Errors (${errors.length}):`);
    for (const issue of errors) {
      lines.push(`  ${SEVERITY_ICON.error} [${issue.code}] ${issue.message}`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const issue of warnings) {
      lines.push(`  ${SEVERITY_ICON.warning} [${issue.code}] ${issue.message}`);
    }
    lines.push("");
  }

  if (infos.length > 0) {
    lines.push(`Info (${infos.length}):`);
    for (const issue of infos) {
      lines.push(`  ${SEVERITY_ICON.info} [${issue.code}] ${issue.message}`);
    }
    lines.push("");
  }

  if (result.passed) {
    lines.push("Result: PASSED");
  } else {
    lines.push("Result: FAILED — fix errors above before publishing.");
  }

  return lines.join("\n");
}

/**
 * Format scan result as a compact one-line summary.
 */
export function formatSummary(result: ScanResult): string {
  const emoji = GRADE_EMOJI[result.grade] || "❓";
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  return `${emoji} ${result.grade} (${result.score}/100) — ${errors} error(s), ${warnings} warning(s)`;
}
