#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  pluginSdkEntrypoints,
  publicPluginOwnedSdkEntrypoints,
  reservedBundledPluginSdkEntrypoints,
  supportedBundledFacadeSdkEntrypoints,
} from "../src/plugin-sdk/entrypoints.ts";
import { PLUGIN_COMPAT_RECORDS } from "../src/plugins/compat/registry.ts";
import type { PluginCompatRecord } from "../src/plugins/compat/types.ts";

const REPO_ROOT = process.cwd();
const SOURCE_ROOTS = ["src", "extensions", "packages", "scripts", "test", "docs"] as const;
const SKIPPED_DIRS = new Set([
  ".artifacts",
  ".git",
  "coverage",
  "dist",
  "dist-runtime",
  "node_modules",
]);
const TEXT_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|json|mdx?|ya?ml)$/u;
const PLUGIN_SDK_SPECIFIER_PATTERN =
  /\b(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["']|vi\.(?:mock|doMock)\s*\(\s*["'])(openclaw\/plugin-sdk\/([a-z0-9][a-z0-9-]*))["']/g;

type CompatDebtRecord = {
  code: string;
  owner: string;
  status: PluginCompatRecord["status"];
  removeAfter?: string;
  replacement: string;
  docsPath: string;
  surfaces: readonly string[];
  tokens: string[];
  codeReferenceFiles: string[];
  docReferenceFiles: string[];
  eligibleForRemoval: boolean;
};

type ReservedSdkImport = {
  file: string;
  specifier: string;
  subpath: string;
  owner?: string;
  consumerOwner?: string;
  relation: "owner" | "cross-owner" | "workspace";
};

type BoundaryReport = {
  generatedAt: string;
  compat: {
    deprecatedCount: number;
    eligibleForRemovalCount: number;
    records: CompatDebtRecord[];
  };
  pluginSdk: {
    entrypointCount: number;
    reservedCount: number;
    supportedBundledFacadeCount: number;
    publicPluginOwnedCount: number;
    reservedImports: ReservedSdkImport[];
    crossOwnerReservedImports: ReservedSdkImport[];
    unusedReservedSubpaths: string[];
  };
  memoryHostSdk: {
    privatePackage: boolean;
    exportedSubpaths: string[];
    sourceBridgeFiles: string[];
    packageCoreReferenceFiles: string[];
  };
};

function collectTextFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) {
      continue;
    }
    const nextPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(nextPath));
      continue;
    }
    if (entry.isFile() && TEXT_FILE_PATTERN.test(entry.name)) {
      files.push(nextPath);
    }
  }
  return files;
}

function collectWorkspaceTextFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => collectTextFiles(resolve(REPO_ROOT, root))).toSorted(
    (left, right) => relative(REPO_ROOT, left).localeCompare(relative(REPO_ROOT, right)),
  );
}

function repoRelative(file: string): string {
  return relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function isDocsFile(file: string): boolean {
  return file.startsWith("docs/") || file === "README.md";
}

function collectBundledPluginIds(): string[] {
  return readdirSync(resolve(REPO_ROOT, "extensions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => right.length - left.length || left.localeCompare(right));
}

function resolvePluginOwner(entrypoint: string, pluginIds: readonly string[]): string | undefined {
  return pluginIds.find(
    (pluginId) => entrypoint === pluginId || entrypoint.startsWith(`${pluginId}-`),
  );
}

function resolveConsumerOwner(file: string): string | undefined {
  return /^extensions\/([^/]+)\//u.exec(file)?.[1];
}

function extractCompatTokens(record: PluginCompatRecord): string[] {
  const tokens = new Set<string>();
  const values = [record.code, record.replacement, ...record.surfaces, ...record.diagnostics];
  for (const value of values) {
    for (const match of value.matchAll(/`([^`]+)`/g)) {
      const token = match[1]?.trim();
      if (token && !token.includes(" ")) {
        tokens.add(token);
      }
    }
    for (const match of value.matchAll(/\bopenclaw\/[a-z0-9/-]+\b/g)) {
      tokens.add(match[0]);
    }
    for (const match of value.matchAll(/\bOPENCLAW_[A-Z0-9_]+\b/g)) {
      tokens.add(match[0]);
    }
    for (const match of value.matchAll(/\b[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+\b/g)) {
      tokens.add(match[0]);
    }
    for (const match of value.matchAll(/\b[a-z][a-zA-Z0-9_]*_[a-zA-Z0-9_]+\b/g)) {
      tokens.add(match[0]);
    }
  }
  return [...tokens].toSorted();
}

function collectReferenceFiles(files: readonly string[], tokens: readonly string[]) {
  const codeReferenceFiles = new Set<string>();
  const docReferenceFiles = new Set<string>();
  for (const file of files) {
    const relativeFile = repoRelative(file);
    if (relativeFile === "src/plugins/compat/registry.ts") {
      continue;
    }
    const source = readFileSync(file, "utf8");
    if (!tokens.some((token) => source.includes(token))) {
      continue;
    }
    if (isDocsFile(relativeFile)) {
      docReferenceFiles.add(relativeFile);
    } else {
      codeReferenceFiles.add(relativeFile);
    }
  }
  return {
    codeReferenceFiles: [...codeReferenceFiles].toSorted(),
    docReferenceFiles: [...docReferenceFiles].toSorted(),
  };
}

function collectCompatDebt(files: readonly string[], today = new Date()): CompatDebtRecord[] {
  return PLUGIN_COMPAT_RECORDS.filter((record) => record.status === "deprecated")
    .map((record) => {
      const tokens = extractCompatTokens(record);
      const references = collectReferenceFiles(files, tokens);
      const eligibleForRemoval = record.removeAfter
        ? new Date(`${record.removeAfter}T00:00:00Z`) <= today
        : false;
      return {
        code: record.code,
        owner: record.owner,
        status: record.status,
        removeAfter: record.removeAfter,
        replacement: record.replacement,
        docsPath: record.docsPath,
        surfaces: record.surfaces,
        tokens,
        codeReferenceFiles: references.codeReferenceFiles,
        docReferenceFiles: references.docReferenceFiles,
        eligibleForRemoval,
      };
    })
    .toSorted(
      (left, right) =>
        (left.removeAfter ?? "").localeCompare(right.removeAfter ?? "") ||
        left.owner.localeCompare(right.owner) ||
        left.code.localeCompare(right.code),
    );
}

function collectReservedSdkImports(files: readonly string[]): ReservedSdkImport[] {
  const reserved = new Set<string>(reservedBundledPluginSdkEntrypoints);
  const pluginIds = collectBundledPluginIds();
  const imports: ReservedSdkImport[] = [];
  for (const file of files) {
    const relativeFile = repoRelative(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(PLUGIN_SDK_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      const subpath = match[2];
      if (!specifier || !subpath || !reserved.has(subpath)) {
        continue;
      }
      const owner = resolvePluginOwner(subpath, pluginIds);
      const consumerOwner = resolveConsumerOwner(relativeFile);
      const relation =
        owner && consumerOwner ? (owner === consumerOwner ? "owner" : "cross-owner") : "workspace";
      imports.push({ file: relativeFile, specifier, subpath, owner, consumerOwner, relation });
    }
  }
  return imports.toSorted(
    (left, right) =>
      left.subpath.localeCompare(right.subpath) ||
      left.file.localeCompare(right.file) ||
      left.specifier.localeCompare(right.specifier),
  );
}

function collectMemoryHostBoundary(files: readonly string[]): BoundaryReport["memoryHostSdk"] {
  const packageJson = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "packages/memory-host-sdk/package.json"), "utf8"),
  ) as { private?: boolean; exports?: Record<string, string> };
  const sourceBridgeFiles: string[] = [];
  const packageCoreReferenceFiles = new Set<string>();
  for (const file of files) {
    const relativeFile = repoRelative(file);
    if (!relativeFile.startsWith("packages/memory-host-sdk/src/")) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    if (source.includes("src/memory-host-sdk/")) {
      sourceBridgeFiles.push(relativeFile);
    }
    if (source.includes("../../../../src/") || source.includes("../../../src/")) {
      packageCoreReferenceFiles.add(relativeFile);
    }
  }
  return {
    privatePackage: packageJson.private === true,
    exportedSubpaths: Object.keys(packageJson.exports ?? {}).toSorted(),
    sourceBridgeFiles: sourceBridgeFiles.toSorted(),
    packageCoreReferenceFiles: [...packageCoreReferenceFiles].toSorted(),
  };
}

function buildReport(): BoundaryReport {
  const files = collectWorkspaceTextFiles();
  const compatRecords = collectCompatDebt(files);
  const reservedImports = collectReservedSdkImports(files);
  const usedReserved = new Set(reservedImports.map((entry) => entry.subpath));
  return {
    generatedAt: new Date().toISOString(),
    compat: {
      deprecatedCount: compatRecords.length,
      eligibleForRemovalCount: compatRecords.filter((record) => record.eligibleForRemoval).length,
      records: compatRecords,
    },
    pluginSdk: {
      entrypointCount: pluginSdkEntrypoints.length,
      reservedCount: reservedBundledPluginSdkEntrypoints.length,
      supportedBundledFacadeCount: supportedBundledFacadeSdkEntrypoints.length,
      publicPluginOwnedCount: publicPluginOwnedSdkEntrypoints.length,
      reservedImports,
      crossOwnerReservedImports: reservedImports.filter(
        (entry) => entry.relation === "cross-owner",
      ),
      unusedReservedSubpaths: reservedBundledPluginSdkEntrypoints
        .filter((subpath) => !usedReserved.has(subpath))
        .toSorted(),
    },
    memoryHostSdk: collectMemoryHostBoundary(files),
  };
}

function renderText(report: BoundaryReport): string {
  const lines: string[] = [];
  lines.push("Plugin Boundary Report");
  lines.push("");
  lines.push(
    `compat deprecated=${report.compat.deprecatedCount} eligibleForRemoval=${report.compat.eligibleForRemovalCount}`,
  );
  for (const record of report.compat.records) {
    lines.push(
      `  ${record.removeAfter ?? "no-date"} ${record.code} owner=${record.owner} codeRefs=${record.codeReferenceFiles.length} docRefs=${record.docReferenceFiles.length}`,
    );
  }
  lines.push("");
  lines.push(
    `plugin-sdk entrypoints=${report.pluginSdk.entrypointCount} reserved=${report.pluginSdk.reservedCount} supportedBundledFacade=${report.pluginSdk.supportedBundledFacadeCount} publicPluginOwned=${report.pluginSdk.publicPluginOwnedCount}`,
  );
  lines.push(
    `  reservedImports=${report.pluginSdk.reservedImports.length} crossOwnerReservedImports=${report.pluginSdk.crossOwnerReservedImports.length} unusedReserved=${report.pluginSdk.unusedReservedSubpaths.length}`,
  );
  for (const entry of report.pluginSdk.crossOwnerReservedImports) {
    lines.push(`  cross-owner ${entry.file}: ${entry.specifier} owner=${entry.owner ?? "unknown"}`);
  }
  lines.push("");
  lines.push(
    `memory-host-sdk private=${report.memoryHostSdk.privatePackage} exports=${report.memoryHostSdk.exportedSubpaths.length} sourceBridgeFiles=${report.memoryHostSdk.sourceBridgeFiles.length} coreReferenceFiles=${report.memoryHostSdk.packageCoreReferenceFiles.length}`,
  );
  return lines.join("\n");
}

const report = buildReport();
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${renderText(report)}\n`);
}
