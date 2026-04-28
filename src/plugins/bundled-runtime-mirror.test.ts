import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshBundledPluginRuntimeMirrorRoot } from "./bundled-runtime-mirror.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bundled-runtime-mirror-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("refreshBundledPluginRuntimeMirrorRoot", () => {
  it("refreshes stale mirrors without deleting the active target root", () => {
    const root = makeTempRoot();
    const sourceRoot = path.join(root, "source");
    const targetRoot = path.join(root, "target");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "index.js"), "export const value = 'v1';\n", "utf8");

    expect(
      refreshBundledPluginRuntimeMirrorRoot({
        pluginId: "demo",
        sourceRoot,
        targetRoot,
      }),
    ).toBe(true);

    fs.writeFileSync(path.join(sourceRoot, "index.js"), "export const value = 'v2';\n", "utf8");
    fs.writeFileSync(path.join(targetRoot, "inflight-import.js"), "still readable\n", "utf8");

    expect(
      refreshBundledPluginRuntimeMirrorRoot({
        pluginId: "demo",
        sourceRoot,
        targetRoot,
      }),
    ).toBe(true);

    expect(fs.readFileSync(path.join(targetRoot, "index.js"), "utf8")).toContain("v2");
    expect(fs.readFileSync(path.join(targetRoot, "inflight-import.js"), "utf8")).toBe(
      "still readable\n",
    );
  });
});
