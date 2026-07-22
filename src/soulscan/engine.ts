/**
 * SoulScan Engine — Delegates to clawsouls scanner package.
 * SOULSCAN™ (40-2026-0033472)
 *
 * The scanning engine and rules live in the `clawsouls` package.
 * This module provides a thin wrapper for soulclaw integration.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// ─── Types (mirror clawsouls scanner interface) ──────────

export const SOULSCAN_VERSION = "1.4.0";

export interface Issue {
  code: string;
  message: string;
  file?: string;
  severity: "error" | "warning" | "info";
}

export interface ScanResult {
  score: number;
  grade: string;
  issues: Issue[];
  passed: boolean;
  warnings: Issue[];
  criticals: Issue[];
  scannerVersion: string;
  scanDurationMs: number;
}

// ─── File Collection ─────────────────────────────────────

const SOUL_FILES = [
  "soul.json",
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "STYLE.md",
  "USER.md",
  "TOOLS.md",
];
const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".txt",
  ".yaml",
  ".yml",
]);

function collectFiles(dir: string): Map<string, { content: string; size: number }> {
  const files = new Map<string, { content: string; size: number }>();

  for (const name of SOUL_FILES) {
    const filePath = join(dir, name);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        files.set(name, { content, size: Buffer.byteLength(content) });
      } catch {
        // skip unreadable files
      }
    }
  }

  try {
    for (const entry of readdirSync(dir)) {
      if (files.has(entry)) {
        continue;
      }
      const ext = extname(entry).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        continue;
      }
      const filePath = join(dir, entry);
      if (!statSync(filePath).isFile()) {
        continue;
      }
      try {
        const content = readFileSync(filePath, "utf-8");
        files.set(entry, { content, size: Buffer.byteLength(content) });
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  return files;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Scan a soul directory. Delegates to clawsouls scanner if available,
 * falls back to basic structural checks.
 */
export async function scanSoul(dir: string): Promise<ScanResult> {
  const startTime = Date.now();
  const files = collectFiles(dir);

  try {
    // Try to use clawsouls scanner (installed globally or as dependency)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — clawsouls may not have type declarations
    const { scanSoulPackage } = (await import("clawsouls/dist/lib/scanner.js")) as {
      scanSoulPackage: (files: Map<string, { content: string; size: number }>) => {
        ok: boolean;
        score: number;
        grade: string;
        scannerVersion: string;
        scanDurationMs: number;
        errors: Issue[];
        warnings: Issue[];
        info: Issue[];
      };
    };

    const result = scanSoulPackage(files);
    const allIssues: Issue[] = [...result.errors, ...result.warnings, ...result.info];

    return {
      score: result.score,
      grade: result.grade,
      issues: allIssues,
      passed: result.ok,
      warnings: result.warnings,
      criticals: result.errors,
      scannerVersion: result.scannerVersion,
      scanDurationMs: result.scanDurationMs,
    };
  } catch {
    // clawsouls not available — basic structural check only
    return basicScan(files, Date.now() - startTime);
  }
}

/**
 * Minimal fallback scan when clawsouls is not installed.
 * Only checks file structure — no security rules.
 */
function basicScan(
  files: Map<string, { content: string; size: number }>,
  durationMs: number,
): ScanResult {
  const issues: Issue[] = [];

  if (!files.has("SOUL.md") && !files.has("soul.json")) {
    issues.push({
      code: "MISSING_SOUL",
      message: "No SOUL.md or soul.json found",
      severity: "error",
    });
  }

  const totalSize = Array.from(files.values()).reduce((sum, f) => sum + f.size, 0);
  if (totalSize > 1024 * 1024) {
    issues.push({
      code: "SIZE_LIMIT",
      message: `Total size ${(totalSize / 1024).toFixed(0)}KB exceeds 1MB limit`,
      severity: "warning",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const score = Math.max(0, 100 - errors.length * 25 - warnings.length * 5);

  return {
    score,
    grade:
      score >= 90
        ? "Verified"
        : score >= 70
          ? "Low Risk"
          : score >= 40
            ? "Medium Risk"
            : "High Risk",
    issues,
    passed: score >= 30,
    warnings,
    criticals: errors,
    scannerVersion: `${SOULSCAN_VERSION}-basic`,
    scanDurationMs: durationMs,
  };
}
