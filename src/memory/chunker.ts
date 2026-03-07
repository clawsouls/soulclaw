/**
 * SoulClaw Memory Search Engine — Markdown Chunker
 *
 * Hybrid chunking: heading-based splitting with token limits and overlap.
 */

import crypto from "node:crypto";
import type { ChunkerConfig } from "./config.js";
import { DEFAULT_CHUNKER_CONFIG } from "./config.js";

export interface Chunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  heading: string | null;
  tokens: number;
}

/** Rough token estimate for mixed Korean/English text */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function chunkId(filePath: string, startLine: number): string {
  return crypto.createHash("sha256").update(`${filePath}:${startLine}`).digest("hex").slice(0, 16);
}

interface Section {
  heading: string | null;
  lines: string[];
  startLine: number; // 1-indexed
}

function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, lines: [], startLine: 1 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);

    if (headingMatch && i > 0) {
      // Flush current section
      if (current.lines.length > 0) {
        sections.push(current);
      }
      current = {
        heading: line,
        lines: [line],
        startLine: i + 1,
      };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  return sections;
}

function splitSectionByParagraphs(section: Section, maxTokens: number): Section[] {
  const text = section.lines.join("\n");
  if (estimateTokens(text) <= maxTokens) {
    return [section];
  }

  const result: Section[] = [];
  let current: string[] = [];
  let currentStart = section.startLine;

  for (let i = 0; i < section.lines.length; i++) {
    const line = section.lines[i] ?? "";
    current.push(line);

    const isBlank = line.trim() === "";
    const currentText = current.join("\n");

    if (isBlank && estimateTokens(currentText) >= maxTokens * 0.5) {
      result.push({
        heading: section.heading,
        lines: [...current],
        startLine: currentStart,
      });
      currentStart = section.startLine + i + 1;
      current = [];
    }
  }

  if (current.length > 0) {
    result.push({
      heading: section.heading,
      lines: current,
      startLine: currentStart,
    });
  }

  return result;
}

export function chunkMarkdown(
  content: string,
  filePath: string,
  config?: Partial<ChunkerConfig>,
): Chunk[] {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  const lines = content.split("\n");

  if (lines.length === 0) {
    return [];
  }

  // Phase 1: heading-based split
  let sections = splitByHeadings(lines);

  // Phase 2: split large sections by paragraph (hybrid mode)
  if (cfg.splitBy === "hybrid" || cfg.splitBy === "paragraph") {
    const expanded: Section[] = [];
    for (const section of sections) {
      expanded.push(...splitSectionByParagraphs(section, cfg.maxTokens));
    }
    sections = expanded;
  }

  // Phase 3: hard split oversized sections and build chunks with overlap
  const chunks: Chunk[] = [];
  let previousTail = "";

  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) {
      continue;
    }

    const tokens = estimateTokens(text);
    if (tokens <= cfg.maxTokens) {
      const withOverlap = previousTail && cfg.overlapTokens > 0 ? previousTail + "\n" + text : text;

      const startLine = section.startLine;
      const endLine = section.startLine + section.lines.length - 1;

      chunks.push({
        id: chunkId(filePath, startLine),
        content: withOverlap,
        filePath,
        startLine,
        endLine,
        heading: section.heading,
        tokens: estimateTokens(withOverlap),
      });

      // Keep tail for overlap
      const overlapChars = cfg.overlapTokens * 4;
      previousTail = text.slice(-overlapChars);
    } else {
      // Hard split: break into maxTokens-sized pieces
      const maxChars = cfg.maxTokens * 4;
      for (let start = 0; start < text.length; start += maxChars) {
        const slice = text.slice(start, start + maxChars);
        const withOverlap =
          start === 0 && previousTail && cfg.overlapTokens > 0
            ? previousTail + "\n" + slice
            : slice;

        const approxStartLine =
          section.startLine + Math.floor((start / text.length) * section.lines.length);
        const approxEndLine = Math.min(
          section.startLine + section.lines.length - 1,
          approxStartLine + Math.floor((maxChars / text.length) * section.lines.length),
        );

        chunks.push({
          id: chunkId(filePath, approxStartLine),
          content: withOverlap,
          filePath,
          startLine: approxStartLine,
          endLine: approxEndLine,
          heading: section.heading,
          tokens: estimateTokens(withOverlap),
        });

        const overlapChars = cfg.overlapTokens * 4;
        previousTail = slice.slice(-overlapChars);
      }
    }
  }

  return chunks;
}
