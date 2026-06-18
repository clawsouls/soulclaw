// Docker E2E seed tests cover generated config and fixture-server contracts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readScript(pathname: string): string {
  return readFileSync(pathname, "utf8");
}

describe("Docker E2E seed scripts", () => {
  it("keeps cron MCP cleanup config wired to its probe server artifacts", () => {
    const source = readScript("scripts/e2e/cron-mcp-cleanup-seed.ts");

    expect(source).toContain('process.title = "openclaw-cron-mcp-cleanup-probe"');
    expect(source).toContain('const probeDir = path.join(stateDir, "cron-mcp-cleanup")');
    expect(source).toContain('const serverPath = path.join(probeDir, "probe-server.mjs")');
    expect(source).toContain("await fs.rm(pidsPath, { force: true })");
    expect(source).toContain("cronCleanupProbe: {");
    expect(source).toContain("command: \"node\"");
    expect(source).toContain("args: [serverPath]");
    expect(source).toContain("cwd: probeDir");
    expect(source).toContain('subagents: {\n            runTimeoutSeconds: 8,');
  });

  it("keeps MCP code-mode gateway config wired to its fixture server artifacts", () => {
    const source = readScript("scripts/e2e/mcp-code-mode-gateway-seed.ts");

    expect(source).toContain('const serverPath = path.join(stateDir, "mcp-code-mode-fixture"');
    expect(source).toContain('["alpha", "fixture-note-alpha"]');
    expect(source).toContain("responses: {\n              enabled: true,");
    expect(source).toContain("codeMode: {\n          enabled: true,");
    expect(source).toContain("fixture: {");
    expect(source).toContain("command: \"node\"");
    expect(source).toContain("args: [serverPath]");
    expect(source).toContain("cwd: path.dirname(serverPath)");
    expect(source).toContain("connectionTimeoutMs: 30_000");
  });
});
