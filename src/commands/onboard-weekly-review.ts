/**
 * Onboarding step: Weekly Memory Review configuration.
 *
 * Only shown when memorySearch is configured (not 'none').
 * Asks:
 * 1. Enable weekly review? (default: yes)
 * 2. Which day? (default: Friday)
 */

import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export async function setupWeeklyReview(
  cfg: OpenClawConfig,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  // Only show if memory search is configured
  const provider = cfg.agents?.defaults?.memorySearch?.provider as string | undefined;
  if (!provider || provider === "none") {
    return cfg;
  }

  await prompter.note(
    [
      "Soul Memory can automatically review your Working Memory (T2) each week",
      "and suggest items to promote to Core Memory (T1).",
      "",
      "The review runs during a heartbeat on the chosen day.",
      "No setup needed — works out-of-the-box.",
    ].join("\n"),
    "Weekly Memory Review",
  );

  const enabled = await prompter.confirm({
    message: "Enable weekly memory review?",
    initialValue: true,
  });

  if (!enabled) {
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          weeklyReview: { disabled: true },
        },
      },
    };
  }

  const reviewDay = await prompter.select<number>({
    message: "Review day",
    options: DAY_OPTIONS.map((d) => ({
      value: d.value,
      label: d.label,
      hint: d.value === 5 ? "recommended" : undefined,
    })),
    initialValue: 5,
  });

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        weeklyReview: {
          disabled: false,
          reviewDay,
        },
      },
    },
  };
}
