#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(extensionRoot, "../..");
const outputPath = path.join(extensionRoot, "assets/viewer-runtime.js");

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const result = await build({
  entryPoints: [path.join(extensionRoot, "src/viewer-client.ts")],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: outputPath,
  write: false,
  plugins: [
    {
      name: "openclaw-diffs-curated-shiki",
      setup(buildContext) {
        buildContext.onResolve({ filter: /^shiki$/ }, () => ({
          path: path.join(repoRoot, "scripts/diffs-shiki-curated.ts"),
        }));
      },
    },
  ],
});

const outputFile = result.outputFiles?.[0];
if (!outputFile) {
  throw new Error("esbuild did not produce extensions/diffs/assets/viewer-runtime.js");
}

const runtime = outputFile.text.replace(/[ \t]+$/gm, "");
let previousRuntime = null;
try {
  previousRuntime = await fs.readFile(outputPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

if (previousRuntime !== runtime) {
  await fs.writeFile(outputPath, runtime);
}
