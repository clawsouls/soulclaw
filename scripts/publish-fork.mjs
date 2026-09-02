#!/usr/bin/env node
/*
  soulclaw 를 이 fork 에서 npm 에 게시한다 — PUBLISHING-FORK.md 의 "salvage path" 를
  매번 손으로 하지 않게 자동화한 것 (2026-09-02).

  왜 이런 모양인가:
  · `npm pack` 은 upstream 의 prepack 을 돌린다 (build + dist 인벤토리 + 체인지로그
    스테이징). 그 산출물이 있어야 패키지가 완전하다 — prepack 을 우회하면 안 된다.
  · 그런데 prepack 이 만든 tarball 의 package.json 에는 `"@openclaw/ai": "workspace:*"`
    가 그대로 실린다. upstream 의 릴리즈 워크플로는 이것을 실제 버전으로 다시 쓰지만
    맨 `npm publish` 는 그러지 않는다 → 소비자 `npm install` 이 **아무 메시지 없이
    exit 1** (2026.7.3 이 그렇게 죽었다).
  · 그래서: pack → tarball 안의 package.json 만 고쳐 다시 싸기 → 깨끗한 디렉토리에
    설치 리허설 → 통과했을 때만 tarball 로 publish (tarball publish 는 prepack 을
    다시 돌리지 않는다).

  쓰기:
    node scripts/publish-fork.mjs            # pack + 고치기 + 리허설만
    node scripts/publish-fork.mjs --publish  # 리허설 통과 시 npm publish
    node scripts/publish-fork.mjs --publish --tag next
*/
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const wantPublish = args.has("--publish");
const tagIdx = process.argv.indexOf("--tag");
const distTag = tagIdx > 0 ? process.argv[tagIdx + 1] : "latest";

const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} → exit ${r.status}`);
};
const out = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { cwd: root, encoding: "utf8", ...opts }).trim();

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name !== "soulclaw") throw new Error(`package.json name is ${pkg.name}, not soulclaw`);
const version = pkg.version;
console.log(`▶ soulclaw@${version} (dist-tag ${distTag})`);

// 1. 체인지로그 절 — prepack 이 32바이트 미만이면 실패시키므로 먼저 확인한다.
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const secStart = changelog.indexOf(`## ${version}`);
if (secStart < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
const secBody = changelog.slice(secStart).split("\n").slice(1).join("\n").split(/\n## /)[0].trim();
if (Buffer.byteLength(secBody) < 32)
  throw new Error(`CHANGELOG "## ${version}" body is under 32 bytes`);

// 2. workspace 의존이 registry 에 같은 버전으로 존재하는지 — 없으면 소비자 설치가 죽는다.
const rewrites = {};
for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (!String(spec).startsWith("workspace:")) continue;
  const dir = dep.replace(/^@openclaw\//, "");
  const wsPkgPath = join(root, "packages", dir, "package.json");
  if (!existsSync(wsPkgPath))
    throw new Error(`workspace dep ${dep}: packages/${dir}/package.json not found`);
  const wsVersion = JSON.parse(readFileSync(wsPkgPath, "utf8")).version;
  let published = "";
  try {
    published = out("npm", ["view", `${dep}@${wsVersion}`, "version"]);
  } catch {
    /* 없음 */
  }
  if (published !== wsVersion) {
    throw new Error(
      `${dep}@${wsVersion} is not on the registry — consumers would fail to install. Publish base must match an upstream release.`,
    );
  }
  rewrites[dep] = wsVersion;
}
console.log("▶ workspace deps →", rewrites);

// 3. 이미 게시된 버전이면 멈춘다 (덮어쓰기 불가, 헛수고 방지).
try {
  const existing = out("npm", ["view", `soulclaw@${version}`, "version"]);
  if (existing === version) throw new Error(`soulclaw@${version} is already published`);
} catch (e) {
  if (String(e.message).includes("already published")) throw e;
}

// 4. npm pack — prepack 이 build·인벤토리·체인지로그를 만든다.
//    ⚠️ 2026.8.1 의 prepack 은 dependencies 에 `workspace:*` 가 남아 있으면 스스로 거부한다
//    (7.3 사고를 upstream 이 가드로 막았다). 그래서 pack 동안만 package.json 의 workspace
//    의존을 registry 의 정확한 버전으로 바꿔 두고, 끝나면 반드시 원복한다.
const pkgPath = join(root, "package.json");
const pkgOriginal = readFileSync(pkgPath, "utf8");
const pkgPatched = JSON.parse(pkgOriginal);
for (const [dep, ver] of Object.entries(rewrites)) pkgPatched.dependencies[dep] = ver;
writeFileSync(pkgPath, JSON.stringify(pkgPatched, null, 2) + "\n");
try {
  run("npm", ["pack", "--ignore-scripts=false"]);
} finally {
  writeFileSync(pkgPath, pkgOriginal); // 어떤 경로로 끝나든 작업 트리를 더럽히지 않는다
}
const rawTarball = join(root, `soulclaw-${version}.tgz`);
if (!existsSync(rawTarball)) throw new Error(`expected ${rawTarball} after npm pack`);

// 5. tarball 안의 package.json 만 고쳐 다시 싼다.
const work = mkdtempSync(join(tmpdir(), "soulclaw-pub-"));
run("tar", ["-xzf", rawTarball, "-C", work]);
const innerPath = join(work, "package", "package.json");
const inner = JSON.parse(readFileSync(innerPath, "utf8"));
for (const [dep, ver] of Object.entries(rewrites)) inner.dependencies[dep] = ver;
for (const dep of Object.keys(inner.devDependencies ?? {})) {
  if (String(inner.devDependencies[dep]).startsWith("workspace:"))
    delete inner.devDependencies[dep];
}
for (const s of ["prepack", "postpack", "prepare"]) delete inner.scripts?.[s];
writeFileSync(innerPath, JSON.stringify(inner, null, 2) + "\n");
const fixedTarball = join(root, `soulclaw-${version}.fixed.tgz`);
run("tar", ["-czf", fixedTarball, "-C", work, "package"]);
console.log(`▶ fixed tarball: ${fixedTarball}`);

// 6. 리허설 — 깨끗한 디렉토리에 설치해 --version 이 우리 버전을 찍는지 본다.
const rehearsal = mkdtempSync(join(tmpdir(), "soulclaw-check-"));
writeFileSync(join(rehearsal, "package.json"), JSON.stringify({ name: "t", private: true }));
run("npm", ["install", fixedTarball, "--omit=dev", "--no-audit", "--no-fund"], { cwd: rehearsal });
const printed = out(
  "node",
  [join(rehearsal, "node_modules", "soulclaw", "dist", "index.js"), "--version"],
  { cwd: rehearsal },
);
if (!printed.includes(version))
  throw new Error(`rehearsal --version printed "${printed}", expected to contain ${version}`);
console.log(`▶ rehearsal OK: ${printed}`);

// 7. 게시 — tarball publish 는 prepack 을 다시 돌리지 않는다.
if (wantPublish) {
  run("npm", ["publish", fixedTarball, "--tag", distTag]);
  console.log(`▶ published soulclaw@${version} (${distTag})`);
} else {
  console.log("▶ dry run — add --publish to release");
}
rmSync(work, { recursive: true, force: true });
rmSync(rehearsal, { recursive: true, force: true });
