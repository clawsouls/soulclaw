import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { getImageMetadata } from "./image-ops.js";

describe("image-ops temp dir", () => {
  let createdTempDir = "";

  beforeEach(() => {
    process.env.OPENCLAW_IMAGE_BACKEND = "sips";
    const originalMkdtemp = fs.mkdtemp.bind(fs);
    vi.spyOn(fs, "mkdtemp").mockImplementation(async (prefix) => {
      createdTempDir = await originalMkdtemp(prefix);
      return createdTempDir;
    });
  });

  afterEach(() => {
    delete process.env.OPENCLAW_IMAGE_BACKEND;
    vi.restoreAllMocks();
  });

  it("creates sips temp dirs under the secured OpenClaw tmp root", async () => {
    const secureRoot = resolvePreferredOpenClawTmpDir();
    const secureRootReal = await fs.realpath(secureRoot);

    await getImageMetadata(Buffer.from("image"));

    expect(fs.mkdtemp).toHaveBeenCalledTimes(1);
    const mkdtempPrefix = vi.mocked(fs.mkdtemp).mock.calls[0]?.[0];
    expect(mkdtempPrefix.startsWith(path.join(secureRootReal, "openclaw-img-"))).toBe(true);
    expect(createdTempDir.startsWith(path.join(secureRootReal, "openclaw-img-"))).toBe(true);
    await expect(fs.access(createdTempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
