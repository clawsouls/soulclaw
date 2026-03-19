/**
 * Soul Memory — Promotion Executor
 *
 * Executes T2 → T1 promotion: moves sections from dated memory files
 * to MEMORY.md or topic-specific evergreen files.
 *
 * Part of the 4-Tier Soul Memory Architecture.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PromotionCandidate } from "./promotion-detector.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PromotionTarget {
  /** Target file (relative to workspace), e.g., "MEMORY.md" or "memory/roadmap.md" */
  targetFile: string;
  /** Section heading to add in the target file */
  heading: string;
  /** Content to add */
  content: string;
}

export interface PromotionResult {
  candidate: PromotionCandidate;
  target: PromotionTarget;
  success: boolean;
  error?: string;
}

// ── Target resolution ──────────────────────────────────────────────────────

/**
 * Map promotion categories to suggested target files.
 */
const CATEGORY_FILE_MAP: Record<string, string> = {
  legal: "memory/legal.md",
  architecture: "memory/architecture.md",
  financial: "memory/financial.md",
  strategy: "memory/strategy.md",
  people: "memory/people.md",
};

/**
 * Determine the best target file for a promotion candidate.
 * If a category-specific file already exists, use it.
 * Otherwise default to MEMORY.md.
 */
export async function resolvePromotionTarget(
  workspaceDir: string,
  candidate: PromotionCandidate,
  overrideTarget?: string,
): Promise<PromotionTarget> {
  if (overrideTarget) {
    return {
      targetFile: overrideTarget,
      heading: candidate.section,
      content: candidate.content,
    };
  }

  // Try category-specific files
  const primaryCategory = candidate.reasons[0]?.category;
  if (primaryCategory) {
    const suggestedFile = CATEGORY_FILE_MAP[primaryCategory];
    if (suggestedFile) {
      const fullPath = path.join(workspaceDir, suggestedFile);
      try {
        await fs.access(fullPath);
        return {
          targetFile: suggestedFile,
          heading: candidate.section,
          content: candidate.content,
        };
      } catch {
        // File doesn't exist, fall through to MEMORY.md
      }
    }
  }

  return {
    targetFile: "MEMORY.md",
    heading: candidate.section,
    content: candidate.content,
  };
}

// ── Execution ──────────────────────────────────────────────────────────────

/**
 * Append a promoted section to the target file.
 * Creates the file if it doesn't exist.
 */
async function appendToTarget(workspaceDir: string, target: PromotionTarget): Promise<void> {
  const fullPath = path.join(workspaceDir, target.targetFile);

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  let existing = "";
  try {
    existing = await fs.readFile(fullPath, "utf-8");
  } catch {
    // File doesn't exist, will be created
  }

  const newSection = `\n\n## ${target.heading}\n\n${target.content}\n`;

  if (existing.includes(`## ${target.heading}`)) {
    // Section already exists — skip to avoid duplicates
    return;
  }

  await fs.writeFile(fullPath, existing.trimEnd() + newSection, "utf-8");
}

/**
 * Remove a promoted section from the source dated file.
 * Does NOT delete the file even if empty.
 */
async function removeFromSource(
  workspaceDir: string,
  candidate: PromotionCandidate,
): Promise<void> {
  const fullPath = path.join(workspaceDir, candidate.file);

  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    return; // File gone, nothing to remove
  }

  const lines = content.split("\n");
  const sectionHeadingRe = new RegExp(`^#{1,3}\\s+${escapeRegExp(candidate.section)}\\s*$`);

  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (sectionHeadingRe.test(lines[i])) {
      startIdx = i;
      // Find next heading of same or higher level
      const level = (lines[i].match(/^(#{1,3})\s/) ?? ["", "##"])[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const headingMatch = lines[j].match(/^(#{1,3})\s/);
        if (headingMatch && headingMatch[1].length <= level) {
          endIdx = j;
          break;
        }
      }
      break;
    }
  }

  if (startIdx === -1) {
    return;
  } // Section not found

  lines.splice(startIdx, endIdx - startIdx);
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Execute a single promotion: copy section to target, remove from source.
 */
export async function executePromotion(
  workspaceDir: string,
  candidate: PromotionCandidate,
  options?: {
    targetFile?: string;
    removeFromSource?: boolean;
  },
): Promise<PromotionResult> {
  const shouldRemove = options?.removeFromSource ?? true;

  try {
    const target = await resolvePromotionTarget(workspaceDir, candidate, options?.targetFile);

    await appendToTarget(workspaceDir, target);

    if (shouldRemove) {
      await removeFromSource(workspaceDir, candidate);
    }

    return { candidate, target, success: true };
  } catch (err) {
    return {
      candidate,
      target: {
        targetFile: options?.targetFile ?? "MEMORY.md",
        heading: candidate.section,
        content: candidate.content,
      },
      success: false,
      error: String(err),
    };
  }
}

/**
 * Execute promotions for multiple candidates.
 */
export async function executeBatchPromotion(
  workspaceDir: string,
  candidates: PromotionCandidate[],
  options?: {
    targetFile?: string;
    removeFromSource?: boolean;
  },
): Promise<PromotionResult[]> {
  const results: PromotionResult[] = [];
  for (const candidate of candidates) {
    results.push(await executePromotion(workspaceDir, candidate, options));
  }
  return results;
}

/**
 * Format promotion results as a report.
 */
export function formatPromotionResults(results: PromotionResult[]): string {
  if (results.length === 0) {
    return "No promotions executed.";
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const lines: string[] = [
    `# Soul Memory — Promotion Results`,
    ``,
    `✅ **${succeeded.length}** promoted, ❌ **${failed.length}** failed`,
    ``,
  ];

  for (const r of succeeded) {
    lines.push(`- ✅ "${r.candidate.section}" → \`${r.target.targetFile}\``);
  }

  for (const r of failed) {
    lines.push(`- ❌ "${r.candidate.section}": ${r.error}`);
  }

  return lines.join("\n");
}
