/**
 * SoulScan Engine — Standalone soul package scanner.
 * 4-stage pipeline: Schema → File Structure → Security → Quality
 * Ported from clawsouls-cli scanner.ts for local-only operation.
 * SOULSCAN™ (40-2026-0033472)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import {
  DEFAULT_RULES,
  getPatternRules,
  getManifestRules,
  type ScanRule,
  type ScanRuleSet,
} from "./rules.ts";

// ─── Constants ───────────────────────────────────────────

export const SOULSCAN_VERSION = "1.4.0";

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
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const MAX_FILE_SIZE = 100 * 1024; // 100KB per file
const MAX_TOTAL_SIZE = 1024 * 1024; // 1MB total

// ─── Types ───────────────────────────────────────────────

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
  scannerVersion: string;
  scanDurationMs: number;
}

interface FileEntry {
  path: string;
  content: string;
  size: number;
}

// ─── Helpers ─────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) {
      return -1;
    }
    if (na > nb) {
      return 1;
    }
  }
  return 0;
}

function calculateScore(errors: Issue[], warnings: Issue[]): number {
  let score = 100;
  score -= errors.length * 25;
  score -= warnings.length * 5;
  return Math.max(0, Math.min(100, score));
}

function getGrade(score: number): string {
  if (score >= 90) {
    return "Verified";
  }
  if (score >= 70) {
    return "Low Risk";
  }
  if (score >= 40) {
    return "Medium Risk";
  }
  if (score >= 1) {
    return "High Risk";
  }
  return "Blocked";
}

// ─── File Reader ─────────────────────────────────────────

async function readSoulDir(soulDir: string): Promise<Map<string, FileEntry>> {
  const files = new Map<string, FileEntry>();

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const fullPath = join(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (s.isFile()) {
        const content = BINARY_EXTENSIONS.has(extname(entry).toLowerCase())
          ? ""
          : await readFile(fullPath, "utf-8");
        files.set(relativePath, { path: relativePath, content, size: s.size });
      }
    }
  }

  await walk(soulDir, "");
  return files;
}

// ─── Stage 1: Schema Validation ──────────────────────────

function stageSchema(files: Map<string, FileEntry>): {
  issues: Issue[];
  soulJson: Record<string, unknown> | null;
  specVersion: string;
} {
  const issues: Issue[] = [];
  let soulJson: Record<string, unknown> | null = null;
  let specVersion = "0.3";

  const entry = files.get("soul.json");
  if (!entry) {
    issues.push({ code: "SCHEMA001", message: "soul.json not found", severity: "error" });
    return { issues, soulJson, specVersion };
  }

  try {
    soulJson = JSON.parse(entry.content);
  } catch {
    issues.push({
      code: "SCHEMA010",
      message: "soul.json is not valid JSON",
      file: "soul.json",
      severity: "error",
    });
    return { issues, soulJson, specVersion };
  }

  if (!soulJson!.name) {
    issues.push({
      code: "SCHEMA002",
      message: 'soul.json missing "name" field',
      file: "soul.json",
      severity: "error",
    });
  }
  if (!soulJson!.version) {
    issues.push({
      code: "SCHEMA003",
      message: 'soul.json missing "version" field',
      file: "soul.json",
      severity: "error",
    });
  }
  if (!soulJson!.description) {
    issues.push({
      code: "SCHEMA004",
      message: 'soul.json missing "description" field',
      file: "soul.json",
      severity: "warning",
    });
  }
  if (!soulJson!.license) {
    issues.push({
      code: "SCHEMA005",
      message: 'soul.json missing "license" field',
      file: "soul.json",
      severity: "warning",
    });
  }
  if (!soulJson!.tags || !Array.isArray(soulJson!.tags) || soulJson!.tags.length === 0) {
    issues.push({
      code: "SCHEMA006",
      message: "soul.json has no tags",
      file: "soul.json",
      severity: "info",
    });
  }
  if (soulJson!.description && soulJson!.description.length < 10) {
    issues.push({
      code: "SCHEMA007",
      message: "Description is less than 10 characters",
      file: "soul.json",
      severity: "warning",
    });
  }

  const validSpecVersions = ["0.3", "0.4", "0.5"];
  if (soulJson!.specVersion) {
    specVersion = soulJson!.specVersion;
    if (!validSpecVersions.includes(specVersion)) {
      issues.push({
        code: "SCHEMA008",
        message: `Unknown specVersion "${specVersion}" (expected ${validSpecVersions.join(", ")})`,
        file: "soul.json",
        severity: "warning",
      });
    }
  }

  return { issues, soulJson, specVersion };
}

// ─── Stage 2: File Structure ─────────────────────────────

function stageFileStructure(files: Map<string, FileEntry>): Issue[] {
  const issues: Issue[] = [];
  let totalSize = 0;

  for (const [filename, file] of files) {
    const ext = extname(filename).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      issues.push({
        code: "FILE001",
        message: `Disallowed file type: ${filename} (${ext})`,
        file: filename,
        severity: "error",
      });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      issues.push({
        code: "FILE002",
        message: `File too large: ${filename} (${(file.size / 1024).toFixed(1)}KB, max 100KB)`,
        file: filename,
        severity: "error",
      });
    }
    totalSize += file.size;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    issues.push({
      code: "FILE003",
      message: `Total package too large: ${(totalSize / 1024).toFixed(1)}KB (max 1MB)`,
      severity: "error",
    });
  }

  if (!files.has("SOUL.md")) {
    issues.push({
      code: "FILE010",
      message: "SOUL.md not found (recommended)",
      severity: "warning",
    });
  }
  if (!files.has("IDENTITY.md")) {
    issues.push({ code: "FILE011", message: "IDENTITY.md not found (optional)", severity: "info" });
  }

  return issues;
}

// ─── Stage 3: Security Scan ──────────────────────────────

function stageSecurity(
  files: Map<string, FileEntry>,
  rules: ScanRule[],
  soulJson: Record<string, unknown> | null,
  specVersion: string,
): Issue[] {
  const issues: Issue[] = [];
  const patternRules = getPatternRules(rules);

  // Filter by specVersion
  const ruleMinVersionMap = new Map<string, string>();
  for (const r of rules) {
    if (r.minSpecVersion) {
      ruleMinVersionMap.set(r.id, r.minSpecVersion);
    }
  }

  const applicableRules = patternRules.filter((rule) => {
    const minVer = ruleMinVersionMap.get(rule.id);
    if (minVer && compareVersions(specVersion, minVer) < 0) {
      return false;
    }
    return true;
  });

  // Pattern-based scan on all text files
  for (const [filename, file] of files) {
    if (BINARY_EXTENSIONS.has(extname(filename).toLowerCase())) {
      continue;
    }

    for (const rule of applicableRules) {
      const regex = new RegExp(rule.pattern!, "gi");
      if (regex.test(file.content)) {
        issues.push({
          code: rule.id,
          message: `${rule.description} in ${filename}`,
          file: filename,
          severity: rule.severity === "error" ? "error" : "warning",
        });
      }
    }
  }

  // Manifest-based checks
  if (soulJson) {
    const manifestRules = getManifestRules(rules);
    for (const rule of manifestRules) {
      if (rule.minSpecVersion && compareVersions(specVersion, rule.minSpecVersion) < 0) {
        continue;
      }

      let triggered = false;

      if (rule.id === "SEC100") {
        const isEmbodied =
          soulJson.environment === "embodied" || soulJson.environment === "physical";
        triggered =
          isEmbodied &&
          (!soulJson.safety || !soulJson.safety.laws || soulJson.safety.laws.length === 0);
      } else if (rule.id === "SEC101") {
        const isEmbodied =
          soulJson.environment === "embodied" || soulJson.environment === "physical";
        triggered =
          isEmbodied &&
          soulJson.safety?.laws?.length > 0 &&
          !soulJson.safety.laws.some((l: Record<string, unknown>) => l.priority <= 1);
      } else if (rule.id === "SEC102") {
        const soulMdFile = files.get("SOUL.md");
        if (soulJson.safety?.laws?.length > 0 && soulMdFile) {
          const content = soulMdFile.content;
          const harmPatterns = [
            /(?<!not\s)(?<!never\s)(?<!may not\s)(?<!must not\s)\b(harm|hurt|injure|kill)\s+(human|people|user)/i,
            /\bignore\s+safety/i,
            /\bdisregard\s+(the\s+)?(first|second|third|zeroth)\s+law/i,
          ];
          triggered = harmPatterns.some((p) => p.test(content));
        }
      }

      if (triggered) {
        issues.push({
          code: rule.id,
          message: rule.description,
          file: "soul.json",
          severity: rule.severity === "error" ? "error" : "warning",
        });
      }
    }
  }

  return issues;
}

// ─── Stage 4: Quality ────────────────────────────────────

function stageQuality(
  files: Map<string, FileEntry>,
  soulJson: Record<string, unknown> | null,
): Issue[] {
  const issues: Issue[] = [];

  const soulMd = files.get("SOUL.md");
  if (soulMd) {
    if (soulMd.content.length < 50) {
      issues.push({
        code: "QUALITY001",
        message: "SOUL.md is very short (< 50 chars)",
        file: "SOUL.md",
        severity: "warning",
      });
    }
    issues.push({
      code: "QUALITY010",
      message: `SOUL.md: ${soulMd.content.length} chars`,
      file: "SOUL.md",
      severity: "info",
    });
  }

  // Persona consistency
  const identityMd = files.get("IDENTITY.md");
  if (soulMd && identityMd && soulJson) {
    const nameMatch =
      identityMd.content.match(/\*\*Name:\*\*\s*(.+)/i) || identityMd.content.match(/^#\s+(.+)/m);
    const identityName = nameMatch ? nameMatch[1].trim() : null;
    const rawName = soulJson.name;
    const soulJsonName = typeof rawName === "string" ? rawName : null;

    if (identityName && soulJsonName) {
      const normId = identityName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const normJson = soulJsonName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normId !== normJson && !normJson.includes(normId) && !normId.includes(normJson)) {
        issues.push({
          code: "CONSIST001",
          message: `Name mismatch: IDENTITY.md says "${identityName}" but soul.json says "${soulJsonName}"`,
          file: "IDENTITY.md",
          severity: "warning",
        });
      }
    }
  }

  return issues;
}

// ─── Main Entry ──────────────────────────────────────────

export interface ScanOptions {
  rules?: ScanRuleSet;
}

/**
 * Scan a soul directory and return a structured result.
 * Fully local — no external API calls.
 */
export async function scanSoul(soulDir: string, options?: ScanOptions): Promise<ScanResult> {
  const startTime = performance.now();
  const ruleSet = options?.rules ?? DEFAULT_RULES;

  // Read all files
  const files = await readSoulDir(soulDir);

  // Run 4-stage pipeline
  const { issues: schemaIssues, soulJson, specVersion } = stageSchema(files);
  const fileIssues = stageFileStructure(files);
  const securityIssues = stageSecurity(files, ruleSet.rules, soulJson, specVersion);
  const qualityIssues = stageQuality(files, soulJson);

  const allIssues = [...schemaIssues, ...fileIssues, ...securityIssues, ...qualityIssues];

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");
  const score = calculateScore(errors, warnings);
  const grade = getGrade(score);

  return {
    score,
    grade,
    issues: allIssues,
    passed: errors.length === 0,
    scannerVersion: SOULSCAN_VERSION,
    scanDurationMs: Math.round(performance.now() - startTime),
  };
}
