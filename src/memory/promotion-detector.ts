/**
 * Soul Memory — Promotion Detector
 *
 * Detects T2 (Working Memory) entries that should be promoted to T1 (Core Memory).
 * Uses rule-based keyword/pattern matching to identify important memories.
 *
 * Part of the 4-Tier Soul Memory Architecture:
 * T0: Soul (Identity) — SOUL.md, IDENTITY.md
 * T1: Core Memory — MEMORY.md, memory/*.md (undated)
 * T2: Working Memory — memory/YYYY-MM-DD.md (temporal decay)
 * T3: Session Memory — conversation context
 */

import fs from "node:fs/promises";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PromotionCandidate {
  /** Source file path (relative to workspace) */
  file: string;
  /** Section heading (## line) */
  section: string;
  /** Full section content */
  content: string;
  /** Why this was flagged */
  reasons: PromotionReason[];
  /** Confidence score (0-1) based on number & strength of matches */
  confidence: number;
}

export interface PromotionReason {
  category: PromotionCategory;
  matchedPattern: string;
  /** Line number (1-indexed) where the match was found */
  line: number;
}

export type PromotionCategory =
  | "decision"
  | "architecture"
  | "financial"
  | "legal"
  | "people"
  | "milestone"
  | "strategy"
  | "explicit";

// ── Promotion Rules ────────────────────────────────────────────────────────

interface PromotionRule {
  category: PromotionCategory;
  patterns: RegExp[];
  weight: number; // 0-1, how strong this signal is
}

const PROMOTION_RULES: PromotionRule[] = [
  {
    category: "decision",
    patterns: [
      /결정|결론|합의|확정|승인/i,
      /\bdecid(ed|ing)\b|\bdecision\b|\bconfirm(ed)?\b|\bapproved?\b/i,
      /→.*으로\s*(결정|확정|진행)/,
      /\bchose\b|\bpicked\b|\bselected\b/i,
    ],
    weight: 0.8,
  },
  {
    category: "architecture",
    patterns: [
      /아키텍처|설계|구조|스키마/i,
      /\barchitecture\b|\bdesign\b|\bschema\b|\bstack\b/i,
      /\bAPI\b.*설계|\bDB\b.*구조/i,
      /\btier\b|\blayer\b|\bmodule\b/i,
    ],
    weight: 0.7,
  },
  {
    category: "financial",
    patterns: [
      /\$\d+|₩\d+|pricing|가격|비용|마진|margin|revenue/i,
      /BEP|break.?even|수익|매출/i,
      /\bplan\b.*\$|\btier\b.*\$/i,
      /월\s*\d+.*원|\/mo\b/i,
    ],
    weight: 0.9,
  },
  {
    category: "legal",
    patterns: [
      /상표|특허|출원|보정|심사|등록/i,
      /\btrademark\b|\bpatent\b|\bcopyright\b|\blicense\b/i,
      /\bToS\b|\bprivacy\s*policy\b|\bGDPR\b|\bPIPA\b/i,
      /계약|약관|법적|규제|컴플라이언스/i,
    ],
    weight: 0.9,
  },
  {
    category: "people",
    patterns: [
      /변리사|파트너|투자자|고객/i,
      /\bpartner(ship)?\b|\bclient\b|\binvestor\b/i,
      /미팅.*결과|통화.*내용|회의.*정리/i,
      /contact@|연락처|이메일/i,
    ],
    weight: 0.6,
  },
  {
    category: "milestone",
    patterns: [
      /출시|런칭|배포|릴리스|완료/i,
      /\blaunch(ed)?\b|\bship(ped)?\b|\breleased?\b|\bdeployed?\b/i,
      /v\d+\.\d+|\bMVP\b|\bbeta\b|\balpha\b/i,
      /Phase\s*\d|단계\s*\d/i,
    ],
    weight: 0.7,
  },
  {
    category: "strategy",
    patterns: [
      /로드맵|전략|비전|방향|목표/i,
      /\broadmap\b|\bstrategy\b|\bvision\b|\bgoal\b/i,
      /장기|단기|분기|연간|quarterly|annual/i,
      /피봇|pivot|go.?no.?go/i,
    ],
    weight: 0.8,
  },
  {
    category: "explicit",
    patterns: [
      /기억해|잊지\s*마|중요|핵심/i,
      /\bremember\s*this\b|\bimportant\b|\bcritical\b|\bkey\s*decision\b/i,
      /\bNOTE\b|\bIMPORTANT\b|\bCRITICAL\b/,
      /★|⭐|🔴|❗/,
    ],
    weight: 1.0,
  },
];

// ── Dated file detection ───────────────────────────────────────────────────

const DATED_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[-_].+)?\.md$/;

function isDatedMemoryFile(filename: string): boolean {
  return DATED_FILE_RE.test(path.basename(filename));
}

function parseDateFromFilename(filename: string): Date | null {
  const match = DATED_FILE_RE.exec(path.basename(filename));
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// ── Section parsing ────────────────────────────────────────────────────────

interface Section {
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
}

function parseMarkdownSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3}\s+/.test(line)) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join("\n").trim(),
          startLine,
          endLine: i,
        });
      }
      currentHeading = line.replace(/^#{1,3}\s+/, "").trim();
      currentLines = [];
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  // Last section
  if (currentHeading || currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
      startLine,
      endLine: lines.length,
    });
  }

  return sections;
}

// ── Main detection ─────────────────────────────────────────────────────────

function detectInSection(file: string, section: Section): PromotionCandidate | null {
  const reasons: PromotionReason[] = [];
  let totalWeight = 0;

  const fullText = `${section.heading}\n${section.content}`;
  const lines = fullText.split("\n");

  for (const rule of PROMOTION_RULES) {
    for (const pattern of rule.patterns) {
      for (let i = 0; i < lines.length; i++) {
        const match = pattern.exec(lines[i]);
        if (match) {
          reasons.push({
            category: rule.category,
            matchedPattern: match[0],
            line: section.startLine + i,
          });
          totalWeight += rule.weight;
          break; // One match per pattern is enough
        }
      }
    }
  }

  if (reasons.length === 0) {
    return null;
  }

  // Confidence: more categories = more confident
  const confidence = Math.min(1, totalWeight / 3);

  // Require at least confidence 0.4 (roughly 2+ weak or 1 strong match)
  if (confidence < 0.4) {
    return null;
  }

  return {
    file,
    section: section.heading,
    content: section.content,
    reasons,
    confidence,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan T2 (Working Memory) files for promotion candidates.
 *
 * @param memoryDir - Path to the memory/ directory
 * @param options - Filtering options
 * @returns Array of promotion candidates, sorted by confidence (descending)
 */
export async function scanForPromotionCandidates(
  memoryDir: string,
  options?: {
    /** Only scan files from the last N days (default: 7) */
    daysBack?: number;
    /** Minimum confidence to include (default: 0.4) */
    minConfidence?: number;
  },
): Promise<PromotionCandidate[]> {
  const daysBack = options?.daysBack ?? 7;
  const minConfidence = options?.minConfidence ?? 0.4;
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  let entries: string[];
  try {
    entries = await fs.readdir(memoryDir);
  } catch {
    return [];
  }

  const candidates: PromotionCandidate[] = [];

  for (const entry of entries) {
    if (!isDatedMemoryFile(entry)) {
      continue;
    }

    const fileDate = parseDateFromFilename(entry);
    if (fileDate && fileDate < cutoffDate) {
      continue;
    }

    const filePath = path.join(memoryDir, entry);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const sections = parseMarkdownSections(content);
    for (const section of sections) {
      if (!section.content.trim()) {
        continue;
      }
      const candidate = detectInSection(`memory/${entry}`, section);
      if (candidate && candidate.confidence >= minConfidence) {
        candidates.push(candidate);
      }
    }
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

/**
 * Format promotion candidates as a human-readable report.
 */
export function formatPromotionReport(candidates: PromotionCandidate[]): string {
  if (candidates.length === 0) {
    return "No promotion candidates found.";
  }

  const lines: string[] = [
    `# Soul Memory — Promotion Candidates`,
    ``,
    `Found **${candidates.length}** items in Working Memory (T2) that may belong in Core Memory (T1).`,
    ``,
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const categories = [...new Set(c.reasons.map((r) => r.category))];
    const confidence = Math.round(c.confidence * 100);
    lines.push(`### ${i + 1}. ${c.section || "(untitled)"}`);
    lines.push(`- **File**: \`${c.file}\``);
    lines.push(`- **Confidence**: ${confidence}%`);
    lines.push(`- **Categories**: ${categories.join(", ")}`);
    lines.push(
      `- **Matched**: ${c.reasons.map((r) => `"${r.matchedPattern}" (${r.category})`).join(", ")}`,
    );
    lines.push(``);
    // Show first 3 lines of content as preview
    const preview = c.content.split("\n").slice(0, 3).join("\n");
    lines.push(`> ${preview.replace(/\n/g, "\n> ")}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*To promote: move the section to MEMORY.md or a topic file in memory/*`);

  return lines.join("\n");
}
