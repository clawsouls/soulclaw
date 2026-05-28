import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureExtensionMemoryBuild,
  hasBuiltExtensionMemoryEntries,
} from "../../scripts/ensure-extension-memory-build.mjs";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-extension-memory-build-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "build-all.mjs"), "", "utf8");
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ensure-extension-memory-build", () => {
  it("detects existing built extension entrypoints", () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, "dist", "extensions", "telegram"), { recursive: true });
    writeFileSync(
      path.join(root, "dist", "extensions", "telegram", "index.js"),
      "export {};\n",
      "utf8",
    );

    expect(
      hasBuiltExtensionMemoryEntries({ rootDir: root, requiredExtensionIds: ["telegram"] }),
    ).toBe(true);
  });

  it("rejects partial built extension entrypoint sets", () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, "dist", "extensions", "discord"), { recursive: true });
    writeFileSync(
      path.join(root, "dist", "extensions", "discord", "index.js"),
      "export {};\n",
      "utf8",
    );

    expect(
      hasBuiltExtensionMemoryEntries({
        rootDir: root,
        requiredExtensionIds: ["discord", "telegram"],
      }),
    ).toBe(false);
  });

  it("skips the build profile when extension entrypoints already exist", () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, "dist", "extensions", "discord"), { recursive: true });
    writeFileSync(
      path.join(root, "dist", "extensions", "discord", "index.js"),
      "export {};\n",
      "utf8",
    );

    const result = ensureExtensionMemoryBuild({
      rootDir: root,
      requiredExtensionIds: ["discord"],
      spawnSync: () => {
        throw new Error("unexpected build");
      },
    });

    expect(result).toEqual({ built: false });
  });

  it("runs the cliStartup build profile when extension entrypoints are missing", () => {
    const root = makeTempRoot();
    const calls: unknown[] = [];

    const result = ensureExtensionMemoryBuild({
      rootDir: root,
      requiredExtensionIds: ["discord"],
      nodeExecPath: "/node",
      spawnSync: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      stdio: "pipe",
    });

    expect(result).toEqual({ built: true });
    expect(calls).toEqual([
      {
        command: "/node",
        args: [path.join(root, "scripts", "build-all.mjs"), "cliStartup"],
        options: expect.objectContaining({
          cwd: root,
          stdio: "pipe",
        }),
      },
    ]);
  });

  it("fails when the cliStartup build profile fails", () => {
    const root = makeTempRoot();

    expect(() =>
      ensureExtensionMemoryBuild({
        rootDir: root,
        spawnSync: () => ({ status: 1 }),
        stdio: "pipe",
      }),
    ).toThrow("cliStartup build profile failed with exit code 1");
  });
});
