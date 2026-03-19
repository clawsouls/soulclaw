import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { scanForPromotionCandidates, formatPromotionReport } from "./promotion-detector.js";

describe("promotion-detector", () => {
  async function createTempMemory(files: Record<string, string>) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "soul-memory-test-"));
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(tmpDir, name), content, "utf-8");
    }
    return tmpDir;
  }

  it("detects decision entries", async () => {
    const dir = await createTempMemory({
      "2026-03-19.md": `# 2026-03-19

## OneClick Hosting 가격 결정

- Starter: $9.99/mo로 확정
- Pro: $19.99/mo로 결정
- BEP 5 유저

## 점심 메뉴

오늘 점심은 김치찌개를 먹었다.
`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 30 });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].section).toBe("OneClick Hosting 가격 결정");

    const categories = candidates[0].reasons.map((r) => r.category);
    expect(categories).toContain("decision");
    expect(categories).toContain("financial");

    // "점심 메뉴" should NOT be a candidate
    const lunchCandidate = candidates.find((c) => c.section === "점심 메뉴");
    expect(lunchCandidate).toBeUndefined();

    await fs.rm(dir, { recursive: true });
  });

  it("detects legal entries", async () => {
    const dir = await createTempMemory({
      "2026-03-19.md": `# Test

## 상표 출원 접수 완료

- 출원번호: 40-2026-0032591
- 접수일: 2026-03-10
- 변리사 BLT와 미팅 예정
`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 30 });
    expect(candidates.length).toBe(1);

    const categories = candidates[0].reasons.map((r) => r.category);
    expect(categories).toContain("legal");
    expect(categories).toContain("people");

    await fs.rm(dir, { recursive: true });
  });

  it("ignores undated (evergreen) files", async () => {
    const dir = await createTempMemory({
      "roadmap.md": `# Roadmap\n\n## Phase 1 결정\n\n$9.99 pricing confirmed.\n`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 30 });
    expect(candidates.length).toBe(0); // Not a dated file = already T1

    await fs.rm(dir, { recursive: true });
  });

  it("respects daysBack filter", async () => {
    const dir = await createTempMemory({
      "2020-01-01.md": `# Old\n\n## 중요한 결정\n\n가격 $100으로 확정\n`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 7 });
    expect(candidates.length).toBe(0); // Too old

    await fs.rm(dir, { recursive: true });
  });

  it("formats report correctly", async () => {
    const dir = await createTempMemory({
      "2026-03-19.md": `# Test\n\n## Architecture 설계 완료\n\n3-tier architecture로 결정. $9.99 pricing.\n`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 30 });
    const report = formatPromotionReport(candidates);

    expect(report).toContain("Promotion Candidates");
    expect(report).toContain("Architecture 설계 완료");
    expect(report).toContain("architecture");

    await fs.rm(dir, { recursive: true });
  });

  it("returns empty for no candidates", async () => {
    const dir = await createTempMemory({
      "2026-03-19.md": `# Daily\n\n## 일상\n\n오늘 날씨가 좋았다.\n`,
    });

    const candidates = await scanForPromotionCandidates(dir, { daysBack: 30 });
    expect(candidates.length).toBe(0);

    const report = formatPromotionReport(candidates);
    expect(report).toContain("No promotion candidates");

    await fs.rm(dir, { recursive: true });
  });
});
