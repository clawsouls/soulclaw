// SoulClaw-specific onboarding steps, kept in one module so the shared setup
// wizard carries a single call site for them.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

/**
 * Runs the SoulClaw onboarding additions:
 *
 * 1. Soul selection from the ClawSouls registry. Best-effort by design — the
 *    picker reaches the network, and neither an offline machine nor a registry
 *    outage may block the rest of the wizard.
 * 2. Weekly memory review, which only prompts once memory search is configured,
 *    so it has to run after the search setup flow.
 */
export async function runSoulClawSetupSteps(params: {
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  prompter: WizardPrompter;
  workspaceDir: string;
}): Promise<OpenClawConfig> {
  const { config, runtime, prompter, workspaceDir } = params;
  try {
    const { promptSoulSelection } = await import("../commands/onboard-soul-picker.js");
    await promptSoulSelection({ workspaceDir, prompter });
  } catch {
    // Degrade gracefully on any failure.
  }
  const { setupWeeklyReview } = await import("../commands/onboard-weekly-review.js");
  return await setupWeeklyReview(config, runtime, prompter);
}
