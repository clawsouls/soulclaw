#!/usr/bin/env node
// Cheap guard for Docker E2E test boundaries.
// Docker E2E must test packaged npm tarballs and package-installed images, not
// the source checkout copied or mounted as the app under test.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT_DIR, dir), { withFileTypes: true })) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(relativePath, out);
    } else {
      out.push(relativePath);
    }
  }
  return out;
}

for (const relativePath of walk("scripts/e2e")) {
  if (!/\.(?:sh|ts|mjs|js)$/u.test(relativePath)) {
    continue;
  }
  const text = readText(relativePath);
  if (/from\s+["']\.\.\/\.\.\/src\//u.test(text) || /import\(["']\.\.\/\.\.\/src\//u.test(text)) {
    errors.push(`${relativePath}: Docker E2E harness must import built dist, not ../../src`);
  }
  if (/-v\s+["']?\$ROOT_DIR:\/app(?::|["'\s]|$)/u.test(text)) {
    errors.push(`${relativePath}: do not mount the repo root as /app in Docker E2E`);
  }
}

const dockerfile = readText("scripts/e2e/Dockerfile");
if (/^\s*(?:COPY|ADD)\s+\.\s+\/app(?:\s|$)/imu.test(dockerfile)) {
  errors.push("scripts/e2e/Dockerfile: do not copy the source checkout into /app");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Docker E2E package boundary guard passed.");
