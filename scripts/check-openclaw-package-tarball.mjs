#!/usr/bin/env node
// Validates the npm tarball Docker E2E lanes install.
// This is intentionally tarball-only: the check proves Docker lanes consume the
// prebuilt package artifact with dist inventory, not a source checkout.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function usage() {
  return "Usage: node scripts/check-openclaw-package-tarball.mjs <openclaw.tgz>";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const tarball = process.argv[2];
if (!tarball || process.argv.length > 3) {
  fail(usage());
}
if (!fs.existsSync(tarball)) {
  fail(`OpenClaw package tarball does not exist: ${tarball}`);
}

const list = spawnSync("tar", ["-tf", tarball], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (list.status !== 0) {
  fail(`tar -tf failed for ${tarball}: ${list.stderr || list.status}`);
}

const entries = list.stdout
  .split(/\r?\n/u)
  .map((entry) => entry.trim())
  .filter(Boolean);
const normalized = entries.map((entry) => entry.replace(/^package\//u, ""));
const entrySet = new Set(normalized);
const errors = [];

for (const entry of normalized) {
  if (entry.startsWith("/") || entry.split("/").includes("..")) {
    errors.push(`unsafe tar entry: ${entry}`);
  }
}

if (!entrySet.has("package.json")) {
  errors.push("missing package.json");
}
if (!normalized.some((entry) => entry.startsWith("dist/"))) {
  errors.push("missing dist/ entries");
}
if (!entrySet.has("dist/postinstall-inventory.json")) {
  errors.push("missing dist/postinstall-inventory.json");
}

if (errors.length > 0) {
  fail(`OpenClaw package tarball integrity failed:\n${errors.join("\n")}`);
}

console.log("OpenClaw package tarball integrity passed.");
