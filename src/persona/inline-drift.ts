/**
 * Inline Persona Drift Detection — fire-and-forget after agent turns.
 * Checks assistant responses for persona drift using keyword fallback or Ollama.
 * Non-fatal: errors are caught and logged.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeConfig, type PersonaEngineConfig } from "./config.js";
import { detectDrift, type DriftResult } from "./drift-detector.js";
import { notifyDrift } from "./drift-notifier.js";
import { evaluateDrift, type EnforcementAction } from "./enforcer.js";
import { recordDrift } from "./metrics.js";
import { parseSoulSpec, type PersonaRules } from "./parser.js";

const log = {
  debug: (...args: unknown[]) => {
    if (process.env["DEBUG"]) {
      console.debug("[persona]", ...args);
    }
  },
  warn: (...args: unknown[]) => console.warn("[persona]", ...args),
};

export interface InlineDriftOptions {
  /** All messages in conversation */
  messages: Array<{ role: string; content?: unknown }>;
  /** Workspace directory */
  workspaceDir?: string;
  /** Session key for logging */
  sessionKey?: string;
  /** Partial config overrides */
  personaConfig?: Partial<PersonaEngineConfig>;
  /** Whether drift detection is enabled (from openclaw.json agents.defaults.personaDrift.enabled) */
  enabled?: boolean;
  /** Callback when drift is detected above threshold */
  onDriftDetected?: (result: DriftResult, action: EnforcementAction) => void;
}

/** Response counter per session for check interval */
const _responseCount = new Map<string, number>();
/** Cached persona rules per workspace */
const _rulesCache = new Map<string, { rules: PersonaRules; mtime: number }>();

/**
 * Run persona drift detection after an agent turn.
 * Only checks every N responses (configurable).
 * Fire-and-forget — never throws.
 */
export async function maybeCheckDrift(options: InlineDriftOptions): Promise<void> {
  const { messages, workspaceDir, sessionKey, enabled } = options;
  if (!workspaceDir || !sessionKey) {
    return;
  }

  // Gated: only run when explicitly enabled (default: off)
  if (enabled !== true) {
    return;
  }

  const config = mergeConfig(options.personaConfig);

  // Increment response counter, only check every N responses
  const count = (_responseCount.get(sessionKey) ?? 0) + 1;
  _responseCount.set(sessionKey, count);
  if (count % config.checkInterval !== 0) {
    return;
  }

  // Get the last assistant response
  const lastAssistant = [...messages]
    .toReversed()
    .find((m) => m.role === "assistant" && typeof m.content === "string");
  if (!lastAssistant || typeof lastAssistant.content !== "string") {
    return;
  }

  // Parse persona rules from SOUL.md
  const rules = await loadPersonaRules(workspaceDir);
  if (!rules) {
    log.debug("no persona rules found, skipping drift check");
    return;
  }

  try {
    const result = await detectDrift(lastAssistant.content, rules, config);

    log.debug(
      `drift check: score=${result.score.toFixed(2)} method=${result.method} session=${sessionKey}`,
    );

    // Record metric
    await recordDrift(result, config).catch(() => {});

    // Evaluate enforcement action
    const action = evaluateDrift(result, config);

    if (action.type !== "none") {
      log.warn(
        `persona drift detected: score=${result.score.toFixed(2)} action=${action.type} session=${sessionKey}`,
      );

      // Send notification via gateway/Telegram
      notifyDrift(result, action, sessionKey).catch(() => {});

      if (options.onDriftDetected) {
        options.onDriftDetected(result, action);
      }
    }
  } catch (err) {
    log.debug(`drift check failed (non-fatal): ${String(err)}`);
  }
}

/**
 * Load and cache persona rules from SOUL.md or soul.json
 */
async function loadPersonaRules(workspaceDir: string): Promise<PersonaRules | null> {
  const soulMdPath = join(workspaceDir, "SOUL.md");
  const soulJsonPath = join(workspaceDir, "soul.json");

  let filePath: string;
  let format: "json" | "markdown";

  if (existsSync(soulMdPath)) {
    filePath = soulMdPath;
    format = "markdown";
  } else if (existsSync(soulJsonPath)) {
    filePath = soulJsonPath;
    format = "json";
  } else {
    return null;
  }

  try {
    // Simple cache based on workspace path (not mtime for perf)
    const cached = _rulesCache.get(workspaceDir);
    if (cached && Date.now() - cached.mtime < 60_000) {
      return cached.rules;
    }

    const content = await readFile(filePath, "utf-8");
    const rules = parseSoulSpec(content, format);
    _rulesCache.set(workspaceDir, { rules, mtime: Date.now() });
    return rules;
  } catch {
    return null;
  }
}
