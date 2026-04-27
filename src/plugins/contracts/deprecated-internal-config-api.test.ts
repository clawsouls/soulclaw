import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(SRC_ROOT, "..");
const EXTENSIONS_ROOT = resolve(REPO_ROOT, "extensions");
const REPO_CODE_ROOTS = ["src", "extensions", "packages", "test", "scripts"].map((entry) =>
  resolve(REPO_ROOT, entry),
);
const GATEWAY_SERVER_METHODS_ROOT = resolve(SRC_ROOT, "gateway/server-methods");
const AMBIENT_RUNTIME_CONFIG_ROOTS = [
  "src/gateway",
  "src/auto-reply",
  "src/agents",
  "src/infra",
  "src/mcp",
  "src/plugins/runtime",
  "src/config/sessions",
].map((entry) => resolve(REPO_ROOT, entry));

const COMPAT_CONFIG_API_FILES = new Set([
  "src/config/config.ts",
  "src/config/io.ts",
  "src/config/mutate.ts",
  "src/memory-host-sdk/runtime-core.ts",
  "src/plugin-sdk/browser-config-runtime.ts",
  "src/plugin-sdk/config-runtime.ts",
  "src/plugin-sdk/memory-core.ts",
  "src/plugin-sdk/memory-core-host-runtime-core.ts",
  "src/plugins/contracts/deprecated-internal-config-api.test.ts",
  "src/plugins/runtime/runtime-config.test.ts",
  "src/plugins/runtime/runtime-config.ts",
  "src/plugins/runtime/types-core.ts",
]);
const AMBIENT_RUNTIME_LOAD_CONFIG_COMPAT_FILES = new Set([
  "src/plugins/runtime/load-context.ts",
  "src/plugins/runtime/runtime-config.ts",
  "src/plugins/runtime/runtime-plugin-boundary.ts",
]);
const PROCESS_BOUNDARY_DIRECT_CONFIG_LOAD_FILES = new Set([
  "src/cli/banner-config-lite.ts",
  "src/cli/daemon-cli/status.gather.ts",
]);

function collectTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function repoRelative(filePath: string): string {
  return relative(REPO_ROOT, filePath).split(sep).join("/");
}

function isProductionExtensionFile(relPath: string): boolean {
  if (
    relPath.includes("/test-support/") ||
    relPath.includes(".test.") ||
    relPath.includes(".live.test.") ||
    relPath.includes(".test-d.") ||
    relPath.includes(".test-harness.") ||
    relPath.includes(".test-shared.") ||
    relPath.endsWith("-test-helpers.ts") ||
    relPath.endsWith("-test-support.ts")
  ) {
    return false;
  }
  return true;
}

function isTestOrHarnessFile(relPath: string): boolean {
  return (
    relPath.includes("test-support") ||
    relPath.includes("/test-support/") ||
    relPath.includes("/test-helpers/") ||
    relPath.includes(".test.") ||
    relPath.includes(".live.test.") ||
    relPath.includes(".test-d.") ||
    relPath.includes(".test-harness.") ||
    relPath.includes(".test-shared.") ||
    relPath.endsWith(".test-helpers.ts") ||
    relPath.endsWith(".test-support.ts") ||
    relPath.endsWith("-test-helpers.ts") ||
    relPath.endsWith("-test-support.ts")
  );
}

function isCompatConfigApiFile(relPath: string): boolean {
  return COMPAT_CONFIG_API_FILES.has(relPath);
}

function isAmbientRuntimeConfigCompatFile(relPath: string): boolean {
  return AMBIENT_RUNTIME_LOAD_CONFIG_COMPAT_FILES.has(relPath);
}

function findLineNumbers(source: string, pattern: RegExp): number[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

function findMatchLineNumbers(source: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const lines: number[] = [];
  for (let match = regex.exec(source); match; match = regex.exec(source)) {
    lines.push(source.slice(0, match.index).split(/\r?\n/).length);
  }
  return lines;
}

function findNonCommentLineNumbers(source: string, pattern: RegExp): number[] {
  return source.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return [];
    }
    return pattern.test(line) ? [index + 1] : [];
  });
}

describe("deprecated internal config API guardrails", () => {
  it("keeps bundled plugin production code off direct runtime config load/write APIs", () => {
    const violations: string[] = [];
    const files = collectTypeScriptFiles(EXTENSIONS_ROOT)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(({ relPath }) => isProductionExtensionFile(relPath));

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      const guards = [
        {
          pattern:
            /(?:api\.runtime\.config|core\.config|runtime\.config|get[A-Za-z0-9]+Runtime\(\)\.config|rt\.config|configApi)\??\.loadConfig\b/,
          replacement: "use runtime.config.current() or pass the already loaded config",
        },
        {
          pattern:
            /(?:api\.runtime\.config|core\.config|runtime\.config|get[A-Za-z0-9]+Runtime\(\)\.config|rt\.config|configApi)\??\.writeConfigFile\b/,
          replacement:
            "use runtime.config.mutateConfigFile(...) or replaceConfigFile(...) with afterWrite",
        },
        {
          pattern:
            /\b(?:import|export)\s+(?:type\s+)?\{[^}]*\bloadConfig\b[^}]*\}\s+from\s+["']openclaw\/plugin-sdk\/(?:browser-config-runtime|config-runtime|memory-core-host-runtime-core)["']/,
          replacement:
            "use getRuntimeConfig(), runtime.config.current(), or pass the already loaded config",
        },
        {
          pattern: /(?<!\.)\bloadConfig\s*\(/,
          replacement: "use getRuntimeConfig(), runtime.config.current(), or passed config",
        },
        {
          pattern: /\bcreateConfigIO\b|\.\s*loadConfig\s*\(/,
          replacement: "use runtime.config.current(), getRuntimeConfig(), or passed config",
        },
        {
          pattern: /\bwriteConfigFile\s*\(/,
          replacement: "use mutateConfigFile(...) or replaceConfigFile(...) with afterWrite",
        },
      ];
      for (const guard of guards) {
        for (const line of findLineNumbers(source, guard.pattern)) {
          violations.push(`${relPath}:${line} ${guard.replacement}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps repo code off deprecated plugin runtime config load/write APIs", () => {
    const violations: string[] = [];
    const files = REPO_CODE_ROOTS.flatMap(collectTypeScriptFiles)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(({ relPath }) => !isCompatConfigApiFile(relPath));

    const guards = [
      {
        pattern:
          /(?:api\.runtime\.config|core\.config|runtime\.config|get[A-Za-z0-9]+Runtime\(\)\.config|rt\.config|configApi)\??\.loadConfig\b/,
        replacement: "use runtime.config.current() or pass the already loaded config",
      },
      {
        pattern:
          /(?:api\.runtime\.config|core\.config|runtime\.config|get[A-Za-z0-9]+Runtime\(\)\.config|rt\.config|configApi)\??\.writeConfigFile\b/,
        replacement:
          "use runtime.config.mutateConfigFile(...) or replaceConfigFile(...) with afterWrite",
      },
      {
        pattern:
          /\b(?:import|export)\s+(?:type\s+)?\{[\s\S]*?\b(?:loadConfig|writeConfigFile)\b[\s\S]*?\}\s+from\s+["']openclaw\/plugin-sdk\/(?:browser-config-runtime|config-runtime|memory-core-host-runtime-core|memory-core)["']/,
        replacement:
          "use getRuntimeConfig(), runtime.config.current(), or mutation helpers with afterWrite",
      },
      {
        pattern:
          /ReturnType<typeof import\(["']openclaw\/plugin-sdk\/(?:browser-config-runtime|config-runtime|memory-core-host-runtime-core|memory-core)["']\)\.(?:loadConfig|writeConfigFile)>/,
        replacement: "use OpenClawConfig or the explicit mutation helper type",
      },
    ];

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      for (const guard of guards) {
        for (const line of findMatchLineNumbers(source, guard.pattern)) {
          violations.push(`${relPath}:${line} ${guard.replacement}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps production config writes on mutation helpers", () => {
    const violations: string[] = [];
    const files = REPO_CODE_ROOTS.flatMap(collectTypeScriptFiles)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(
        ({ relPath }) =>
          !isTestOrHarnessFile(relPath) &&
          !isCompatConfigApiFile(relPath) &&
          !relPath.startsWith("test/"),
      );

    const importPattern =
      /\bimport\s+\{[\s\S]*?\bwriteConfigFile\b[\s\S]*?\}\s+from\s+["'][^"']*(?:config\/config|config\/io)\.js["']/;
    const dynamicImportPattern =
      /\bconst\s+\{[\s\S]*?\bwriteConfigFile\b[\s\S]*?\}\s*=\s*await\s+import\(["'][^"']*(?:config\/config|config\/io)\.js["']\)/;
    const directMethodPattern = /\.\s*writeConfigFile\s*\(/;

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      for (const pattern of [importPattern, dynamicImportPattern]) {
        for (const line of findMatchLineNumbers(source, pattern)) {
          violations.push(
            `${relPath}:${line} use replaceConfigFile(...) or mutateConfigFile(...) with afterWrite`,
          );
        }
      }
      for (const line of findNonCommentLineNumbers(source, directMethodPattern)) {
        violations.push(
          `${relPath}:${line} use replaceConfigFile(...) or mutateConfigFile(...) with afterWrite`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps production code off direct config loads outside explicit process boundaries", () => {
    const violations: string[] = [];
    const files = REPO_CODE_ROOTS.flatMap(collectTypeScriptFiles)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(
        ({ relPath }) =>
          !isTestOrHarnessFile(relPath) &&
          !isCompatConfigApiFile(relPath) &&
          !PROCESS_BOUNDARY_DIRECT_CONFIG_LOAD_FILES.has(relPath) &&
          !relPath.startsWith("test/"),
      );

    const directCallPattern = /(?<!\.)\bloadConfig\s*\(/;
    const directMethodPattern = /\.\s*loadConfig\s*\(/;

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      for (const line of findNonCommentLineNumbers(source, directCallPattern)) {
        violations.push(
          `${relPath}:${line} use a passed cfg, context.getRuntimeConfig(), or getRuntimeConfig() at an explicit process boundary`,
        );
      }
      for (const line of findNonCommentLineNumbers(source, directMethodPattern)) {
        violations.push(
          `${relPath}:${line} use a passed cfg, context.getRuntimeConfig(), or getRuntimeConfig() at an explicit process boundary`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps gateway server method handlers on the request runtime config snapshot", () => {
    const violations: string[] = [];
    const files = collectTypeScriptFiles(GATEWAY_SERVER_METHODS_ROOT)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(({ relPath }) => !isTestOrHarnessFile(relPath));

    const guards = [
      {
        pattern:
          /\bimport\s+\{[\s\S]*?\bloadConfig\b[\s\S]*?\}\s+from\s+["'][^"']*(?:config\/config|config\/io)\.js["']/,
        replacement: "use context.getRuntimeConfig() in gateway request handlers",
      },
      {
        pattern: /(?<!\.)\bloadConfig\s*\(/,
        replacement: "use context.getRuntimeConfig() in gateway request handlers",
      },
    ];

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      for (const guard of guards) {
        const lines = guard.pattern.source.includes("import\\s+")
          ? findMatchLineNumbers(source, guard.pattern)
          : findNonCommentLineNumbers(source, guard.pattern);
        for (const line of lines) {
          violations.push(`${relPath}:${line} ${guard.replacement}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps long-lived runtime code off ambient loadConfig calls", () => {
    const violations: string[] = [];
    const files = AMBIENT_RUNTIME_CONFIG_ROOTS.flatMap(collectTypeScriptFiles)
      .map((filePath) => ({ filePath, relPath: repoRelative(filePath) }))
      .filter(
        ({ relPath }) =>
          !isTestOrHarnessFile(relPath) &&
          !isCompatConfigApiFile(relPath) &&
          !isAmbientRuntimeConfigCompatFile(relPath),
      );

    for (const { filePath, relPath } of files) {
      const source = readFileSync(filePath, "utf8");
      const loadConfigLines = findNonCommentLineNumbers(source, /(?<!\.)\bloadConfig\s*\(/);
      if (loadConfigLines.length === 0) {
        continue;
      }

      violations.push(
        `${relPath}:${loadConfigLines.join(",")} has ${loadConfigLines.length} ambient loadConfig() calls. Pass cfg through the call path, use context.getRuntimeConfig(), or use getRuntimeConfig() at a process boundary.`,
      );
    }

    expect(violations).toEqual([]);
  });
});
