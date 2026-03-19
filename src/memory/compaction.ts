/**
 * Soul Memory — T2 Compaction
 *
 * Archives old T2 (Working Memory) files by merging them into
 * quarterly summary files (e.g., memory/archive/2026-Q1.md).
 *
 * Files older than the threshold are concatenated into a quarterly file.
 * Original files are optionally removed after archiving.
 */

import fs from "node:fs/promises";
import path from "node:path";

const DATED_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[-_].+)?\.md$/;

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompactionCandidate {
  filename: string;
  fileDate: Date;
  quarter: string; // "2026-Q1"
  sizeBytes: number;
}

export interface CompactionResult {
  quarter: string;
  archivePath: string;
  filesArchived: number;
  totalBytes: number;
  filesRemoved: boolean;
}

// ── Quarter helpers ────────────────────────────────────────────────────────

function getQuarter(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const q = Math.floor(month / 3) + 1;
  return `${year}-Q${q}`;
}

function parseDateFromFilename(filename: string): Date | null {
  const match = DATED_FILE_RE.exec(filename);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// ── Scanning ───────────────────────────────────────────────────────────────

/**
 * Find T2 files eligible for compaction.
 *
 * @param memoryDir - Path to the memory/ directory
 * @param daysOld - Minimum age in days (default: 90)
 */
export async function findCompactionCandidates(
  memoryDir: string,
  daysOld = 90,
): Promise<CompactionCandidate[]> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const candidates: CompactionCandidate[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(memoryDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fileDate = parseDateFromFilename(entry);
    if (!fileDate || fileDate >= cutoff) {
      continue;
    }

    const fullPath = path.join(memoryDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        continue;
      }
      candidates.push({
        filename: entry,
        fileDate,
        quarter: getQuarter(fileDate),
        sizeBytes: stat.size,
      });
    } catch {
      continue;
    }
  }

  candidates.sort((a, b) => a.fileDate.getTime() - b.fileDate.getTime());
  return candidates;
}

// ── Compaction ──────────────────────────────────────────────────────────────

/**
 * Archive T2 files into quarterly summary files.
 *
 * @param memoryDir - Path to the memory/ directory
 * @param candidates - Files to compact
 * @param removeOriginals - Delete original files after archiving (default: false)
 */
export async function compactToQuarterly(
  memoryDir: string,
  candidates: CompactionCandidate[],
  removeOriginals = false,
): Promise<CompactionResult[]> {
  if (candidates.length === 0) {
    return [];
  }

  // Group by quarter
  const byQuarter = new Map<string, CompactionCandidate[]>();
  for (const c of candidates) {
    const group = byQuarter.get(c.quarter) ?? [];
    group.push(c);
    byQuarter.set(c.quarter, group);
  }

  const archiveDir = path.join(memoryDir, "archive");
  await fs.mkdir(archiveDir, { recursive: true });

  const results: CompactionResult[] = [];

  for (const [quarter, files] of byQuarter) {
    const archivePath = path.join(archiveDir, `${quarter}.md`);

    // Read existing archive if any
    let existing = "";
    try {
      existing = await fs.readFile(archivePath, "utf-8");
    } catch {
      // New file
    }

    // Build archive content
    const sections: string[] = [];
    if (!existing) {
      sections.push(`# Archive: ${quarter}\n`);
      sections.push(`*Compacted from ${files.length} daily memory files.*\n`);
    }

    let totalBytes = 0;
    let filesArchived = 0;

    for (const file of files) {
      const fullPath = path.join(memoryDir, file.filename);
      try {
        const content = await fs.readFile(fullPath, "utf-8");

        // Check if already archived (by filename marker)
        if (existing.includes(`<!-- source: ${file.filename} -->`)) {
          continue;
        }

        sections.push(`\n<!-- source: ${file.filename} -->`);
        sections.push(`## ${file.filename.replace(/\.md$/, "")}\n`);
        sections.push(content.trim());
        sections.push("");

        totalBytes += file.sizeBytes;
        filesArchived++;
      } catch {
        continue;
      }
    }

    if (filesArchived === 0) {
      continue;
    }

    // Write archive
    const newContent = existing.trimEnd() + "\n" + sections.join("\n");
    await fs.writeFile(archivePath, newContent, "utf-8");

    // Optionally remove originals
    if (removeOriginals) {
      for (const file of files) {
        const fullPath = path.join(memoryDir, file.filename);
        try {
          await fs.unlink(fullPath);
        } catch {
          // Already gone
        }
      }
    }

    results.push({
      quarter,
      archivePath: `memory/archive/${quarter}.md`,
      filesArchived,
      totalBytes,
      filesRemoved: removeOriginals,
    });
  }

  return results;
}

/**
 * Format compaction results.
 */
export function formatCompactionReport(
  candidates: CompactionCandidate[],
  results?: CompactionResult[],
): string {
  if (candidates.length === 0) {
    return "No T2 files eligible for compaction (all less than 90 days old).";
  }

  const lines: string[] = [];

  if (!results) {
    // Preview mode
    const byQuarter = new Map<string, CompactionCandidate[]>();
    for (const c of candidates) {
      const group = byQuarter.get(c.quarter) ?? [];
      group.push(c);
      byQuarter.set(c.quarter, group);
    }

    lines.push(`# Soul Memory — Compaction Preview`);
    lines.push(``);
    lines.push(`Found **${candidates.length}** T2 files older than 90 days.`);
    lines.push(``);

    for (const [quarter, files] of byQuarter) {
      const totalKB = (files.reduce((sum, f) => sum + f.sizeBytes, 0) / 1024).toFixed(1);
      lines.push(`### ${quarter} — ${files.length} files (${totalKB} KB)`);
      for (const f of files) {
        lines.push(`- \`${f.filename}\` (${(f.sizeBytes / 1024).toFixed(1)} KB)`);
      }
      lines.push(``);
    }

    lines.push(`*Run with \`--apply\` to archive these files.*`);
  } else {
    // Results mode
    lines.push(`# Soul Memory — Compaction Results`);
    lines.push(``);
    for (const r of results) {
      lines.push(
        `- ✅ **${r.quarter}**: ${r.filesArchived} files → \`${r.archivePath}\`${r.filesRemoved ? " (originals removed)" : ""}`,
      );
    }
  }

  return lines.join("\n");
}
