import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInstallManifest,
  parseWorkspaceDependencyDirs,
  resolveWorkspaceInstallPlan,
} from "../../scripts/ocm-npm-workspace-deps.mjs";

describe("OCM npm workspace dependency adapter", () => {
  it("resolves workspace package directories", () => {
    expect(
      parseWorkspaceDependencyDirs(["packages/ai", "extensions/example"].join(delimiter), "/repo"),
    ).toEqual(["/repo/packages/ai", "/repo/extensions/example"]);
  });

  it("replaces the root archive argument with a prepared install manifest", () => {
    expect(
      resolveWorkspaceInstallPlan(
        [
          "install",
          "--prefix",
          "runtime",
          "--omit=dev",
          "--no-save",
          "--package-lock=false",
          "openclaw.tgz",
        ],
        ["/repo/packages/ai"],
        "/repo",
      ),
    ).toEqual({
      installArgs: [
        "install",
        "--prefix",
        "runtime",
        "--omit=dev",
        "--no-save",
        "--package-lock=false",
      ],
      prefixDir: "/repo/runtime",
      rootArchive: "/repo/openclaw.tgz",
    });
  });

  it("keeps normal npm commands unchanged", () => {
    expect(resolveWorkspaceInstallPlan(["pack", "--silent"], ["/repo/packages/ai"])).toBeNull();
    expect(resolveWorkspaceInstallPlan(["install", "openclaw.tgz"], [])).toBeNull();
  });

  it("builds a manifest with the root and local workspace tarballs", () => {
    expect(
      buildInstallManifest("/tmp/openclaw.tgz", [
        { name: "@openclaw/ai", tarball: "/tmp/openclaw-ai.tgz" },
      ]),
    ).toEqual({
      private: true,
      dependencies: {
        "@openclaw/ai": "file:///tmp/openclaw-ai.tgz",
        openclaw: "file:///tmp/openclaw.tgz",
      },
    });
  });
});
