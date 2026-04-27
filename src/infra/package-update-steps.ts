import fs from "node:fs/promises";
import path from "node:path";
import { readPackageVersion } from "./package-json.js";
import {
  collectInstalledGlobalPackageErrors,
  globalInstallArgs,
  globalInstallFallbackArgs,
  resolveNpmGlobalPrefixLayoutFromGlobalRoot,
  resolveNpmGlobalPrefixLayoutFromPrefix,
  resolveExpectedInstalledVersionFromSpec,
  resolveGlobalInstallTarget,
  type CommandRunner,
  type NpmGlobalPrefixLayout,
  type ResolvedGlobalInstallTarget,
} from "./update-global.js";

export type PackageUpdateStepResult = {
  name: string;
  command: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

export type PackageUpdateStepRunner = (params: {
  name: string;
  argv: string[];
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}) => Promise<PackageUpdateStepResult>;

type StagedNpmInstall = {
  prefix: string;
  layout: NpmGlobalPrefixLayout;
  packageRoot: string;
};

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createStagedNpmInstall(
  installTarget: ResolvedGlobalInstallTarget,
  packageName: string,
): Promise<StagedNpmInstall | null> {
  if (installTarget.manager !== "npm") {
    return null;
  }
  const targetLayout = resolveNpmGlobalPrefixLayoutFromGlobalRoot(installTarget.globalRoot);
  if (!targetLayout) {
    return null;
  }
  const prefix = await fs.mkdtemp(path.join(targetLayout.prefix, ".openclaw-update-stage-"));
  const layout = resolveNpmGlobalPrefixLayoutFromPrefix(prefix);
  return {
    prefix,
    layout,
    packageRoot: path.join(layout.globalRoot, packageName),
  };
}

async function cleanupStagedNpmInstall(stage: StagedNpmInstall | null): Promise<void> {
  if (!stage) {
    return;
  }
  await fs.rm(stage.prefix, { recursive: true, force: true }).catch(() => undefined);
}

async function copyPathEntry(source: string, destination: string): Promise<void> {
  const stat = await fs.lstat(source);
  await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
  if (stat.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(source), destination);
    return;
  }
  if (stat.isDirectory()) {
    await fs.cp(source, destination, {
      recursive: true,
      force: true,
      preserveTimestamps: false,
    });
    return;
  }
  await fs.copyFile(source, destination);
  await fs.chmod(destination, stat.mode).catch(() => undefined);
}

async function replaceNpmBinShims(params: {
  stageLayout: NpmGlobalPrefixLayout;
  targetLayout: NpmGlobalPrefixLayout;
  packageName: string;
}): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(params.stageLayout.binDir);
  } catch {
    return;
  }

  const names = new Set([params.packageName, "openclaw"]);
  const shimEntries = entries.filter((entry) => {
    const parsed = path.parse(entry);
    return names.has(entry) || names.has(parsed.name);
  });
  if (shimEntries.length === 0) {
    return;
  }

  await fs.mkdir(params.targetLayout.binDir, { recursive: true });
  for (const entry of shimEntries) {
    await copyPathEntry(
      path.join(params.stageLayout.binDir, entry),
      path.join(params.targetLayout.binDir, entry),
    );
  }
}

async function swapStagedNpmInstall(params: {
  stage: StagedNpmInstall;
  installTarget: ResolvedGlobalInstallTarget;
  packageName: string;
}): Promise<PackageUpdateStepResult> {
  const startedAt = Date.now();
  const targetLayout = resolveNpmGlobalPrefixLayoutFromGlobalRoot(params.installTarget.globalRoot);
  const targetPackageRoot = params.installTarget.packageRoot;
  if (!targetLayout || !targetPackageRoot) {
    return {
      name: "global install swap",
      command: "swap staged npm install",
      cwd: params.stage.prefix,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      stdoutTail: null,
      stderrTail: "cannot resolve npm global prefix layout",
    };
  }

  const backupRoot = path.join(targetLayout.globalRoot, `.openclaw-${process.pid}-${Date.now()}`);
  let movedExisting = false;
  let movedStaged = false;
  try {
    await fs.mkdir(targetLayout.globalRoot, { recursive: true });
    if (await pathExists(targetPackageRoot)) {
      await fs.rename(targetPackageRoot, backupRoot);
      movedExisting = true;
    }
    await fs.rename(params.stage.packageRoot, targetPackageRoot);
    movedStaged = true;
    await replaceNpmBinShims({
      stageLayout: params.stage.layout,
      targetLayout,
      packageName: params.packageName,
    });
    if (movedExisting) {
      await fs.rm(backupRoot, { recursive: true, force: true });
    }
    return {
      name: "global install swap",
      command: `swap ${params.stage.packageRoot} -> ${targetPackageRoot}`,
      cwd: targetLayout.globalRoot,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      stdoutTail: movedExisting
        ? `replaced ${params.packageName}`
        : `installed ${params.packageName}`,
      stderrTail: null,
    };
  } catch (err) {
    if (movedStaged) {
      await fs.rm(targetPackageRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    if (movedExisting) {
      await fs.rename(backupRoot, targetPackageRoot).catch(() => undefined);
    }
    return {
      name: "global install swap",
      command: `swap ${params.stage.packageRoot} -> ${targetPackageRoot}`,
      cwd: targetLayout.globalRoot,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      stdoutTail: null,
      stderrTail: formatError(err),
    };
  }
}

export async function runGlobalPackageUpdateSteps(params: {
  installTarget: ResolvedGlobalInstallTarget;
  installSpec: string;
  packageName: string;
  packageRoot?: string | null;
  runCommand: CommandRunner;
  runStep: PackageUpdateStepRunner;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  installCwd?: string;
  postVerifyStep?: (packageRoot: string) => Promise<PackageUpdateStepResult | null>;
}): Promise<{
  steps: PackageUpdateStepResult[];
  verifiedPackageRoot: string | null;
  afterVersion: string | null;
  failedStep: PackageUpdateStepResult | null;
}> {
  const installCwd = params.installCwd === undefined ? {} : { cwd: params.installCwd };
  const installEnv = params.env === undefined ? {} : { env: params.env };
  let stagedInstall = await createStagedNpmInstall(params.installTarget, params.packageName);
  const updateStep = await params.runStep({
    name: "global update",
    argv: globalInstallArgs(
      params.installTarget,
      params.installSpec,
      undefined,
      stagedInstall?.prefix,
    ),
    ...installCwd,
    ...installEnv,
    timeoutMs: params.timeoutMs,
  });

  const steps = [updateStep];
  let finalInstallStep = updateStep;
  if (updateStep.exitCode !== 0) {
    await cleanupStagedNpmInstall(stagedInstall);
    stagedInstall = await createStagedNpmInstall(params.installTarget, params.packageName);
    const fallbackArgv = globalInstallFallbackArgs(
      params.installTarget,
      params.installSpec,
      undefined,
      stagedInstall?.prefix,
    );
    if (fallbackArgv) {
      const fallbackStep = await params.runStep({
        name: "global update (omit optional)",
        argv: fallbackArgv,
        ...installCwd,
        ...installEnv,
        timeoutMs: params.timeoutMs,
      });
      steps.push(fallbackStep);
      finalInstallStep = fallbackStep;
    } else {
      await cleanupStagedNpmInstall(stagedInstall);
      stagedInstall = null;
    }
  }

  let verifiedPackageRoot =
    stagedInstall?.packageRoot ??
    (
      await resolveGlobalInstallTarget({
        manager: params.installTarget,
        runCommand: params.runCommand,
        timeoutMs: params.timeoutMs,
      })
    ).packageRoot ??
    params.packageRoot ??
    null;

  let afterVersion: string | null = null;
  if (finalInstallStep.exitCode === 0 && verifiedPackageRoot) {
    afterVersion = await readPackageVersion(verifiedPackageRoot);
    const expectedVersion = resolveExpectedInstalledVersionFromSpec(
      params.packageName,
      params.installSpec,
    );
    const verificationErrors = await collectInstalledGlobalPackageErrors({
      packageRoot: verifiedPackageRoot,
      expectedVersion,
    });
    if (verificationErrors.length > 0) {
      steps.push({
        name: "global install verify",
        command: `verify ${verifiedPackageRoot}`,
        cwd: verifiedPackageRoot,
        durationMs: 0,
        exitCode: 1,
        stderrTail: verificationErrors.join("\n"),
        stdoutTail: null,
      });
    }

    if (stagedInstall && verificationErrors.length === 0) {
      const swapStep = await swapStagedNpmInstall({
        stage: stagedInstall,
        installTarget: params.installTarget,
        packageName: params.packageName,
      });
      steps.push(swapStep);
      if (swapStep.exitCode === 0) {
        verifiedPackageRoot = params.installTarget.packageRoot ?? verifiedPackageRoot;
      }
    }

    const failedVerifyOrSwap = steps.find(
      (step) =>
        (step.name === "global install verify" || step.name === "global install swap") &&
        step.exitCode !== 0,
    );
    const postVerifyStep = failedVerifyOrSwap
      ? null
      : await params.postVerifyStep?.(verifiedPackageRoot);
    if (postVerifyStep) {
      steps.push(postVerifyStep);
    }
  }

  await cleanupStagedNpmInstall(stagedInstall);

  const failedStep =
    finalInstallStep.exitCode !== 0
      ? finalInstallStep
      : (steps.find((step) => step !== updateStep && step.exitCode !== 0) ?? null);

  return {
    steps,
    verifiedPackageRoot,
    afterVersion,
    failedStep,
  };
}
