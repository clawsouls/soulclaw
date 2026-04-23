import fs from "node:fs";
import { describe, expect, it } from "vitest";

type OxlintConfig = {
  ignorePatterns?: string[];
  rules?: Record<string, unknown>;
};

type OxlintTsconfig = {
  include?: string[];
  exclude?: string[];
};

function readJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
}

describe("oxlint config", () => {
  it("includes bundled extensions in type-aware lint coverage", () => {
    const tsconfig = readJson("tsconfig.oxlint.json") as OxlintTsconfig;

    expect(tsconfig.include).toContain("extensions/**/*");
    expect(tsconfig.exclude ?? []).not.toContain("extensions");
  });

  it("includes scripts in root type-aware lint coverage", () => {
    const tsconfig = readJson("tsconfig.oxlint.json") as OxlintTsconfig;

    expect(tsconfig.include).toContain("scripts/**/*");
  });

  it("has a discoverable scripts tsconfig for type-aware linting", () => {
    const tsconfig = readJson("scripts/tsconfig.json") as OxlintTsconfig;

    expect(tsconfig.include).toContain("**/*.ts");
    expect(tsconfig.exclude ?? []).not.toContain("**/*.ts");
  });

  it("has a discoverable test tsconfig for type-aware linting", () => {
    const tsconfig = readJson("test/tsconfig.json") as OxlintTsconfig;

    expect(tsconfig.include).toContain("**/*.ts");
    expect(tsconfig.exclude ?? []).not.toContain("**/*.ts");
  });

  it("does not ignore the bundled extensions tree", () => {
    const config = readJson(".oxlintrc.json") as OxlintConfig;

    expect(config.ignorePatterns ?? []).not.toContain("extensions/");
  });

  it("keeps generated and vendored extension outputs ignored", () => {
    const config = readJson(".oxlintrc.json") as OxlintConfig;
    const ignorePatterns = config.ignorePatterns ?? [];

    expect(ignorePatterns).toContain("**/node_modules/**");
    expect(ignorePatterns).toContain("**/dist/**");
    expect(ignorePatterns).toContain("**/build/**");
    expect(ignorePatterns).toContain("**/coverage/**");
    expect(ignorePatterns).toContain("**/.cache/**");
  });

  it("enables strict empty object type lint with named single-extends interfaces allowed", () => {
    const config = readJson(".oxlintrc.json") as OxlintConfig;

    expect(config.rules?.["typescript/no-empty-object-type"]).toEqual([
      "error",
      { allowInterfaces: "with-single-extends" },
    ]);
  });
});
