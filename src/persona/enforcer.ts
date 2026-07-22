/**
 * Persona enforcer — reinforces persona rules in system prompts
 * and triggers warnings on drift.
 * @module persona/enforcer
 */

import type { PersonaEngineConfig } from "./config.js";
import type { DriftResult } from "./drift-detector.js";
import type { PersonaRules } from "./parser.js";
import { rulesToPromptBlock } from "./parser.js";

export interface EnforcementAction {
  type: "none" | "reminder" | "severe-warning";
  injection?: string;
  message?: string;
}

/**
 * Determine enforcement action based on drift result.
 */
export function evaluateDrift(result: DriftResult, config: PersonaEngineConfig): EnforcementAction {
  if (result.score <= config.driftThreshold) {
    return { type: "none" };
  }

  if (result.score > config.severeThreshold) {
    return {
      type: "severe-warning",
      message: `[PERSONA DRIFT SEVERE] score=${result.score.toFixed(2)} method=${result.method} — immediate correction needed`,
    };
  }

  return {
    type: "reminder",
    message: `[PERSONA DRIFT] score=${result.score.toFixed(2)} — gentle reminder injected`,
  };
}

/**
 * Build the persona block to inject into the system prompt.
 * Includes a drift reminder if action requires it.
 */
export function buildPersonaInjection(rules: PersonaRules, action: EnforcementAction): string {
  const base = rulesToPromptBlock(rules);
  const sections = [`<persona>\n${base}\n</persona>`];

  if (action.type === "reminder") {
    sections.push(
      "<persona-reminder>\n" +
        "Your recent responses have drifted from your defined persona. " +
        "Please re-align with the tone, style, and principles above.\n" +
        "</persona-reminder>",
    );
  }

  if (action.type === "severe-warning") {
    sections.push(
      '<persona-warning severity="high">\n' +
        "CRITICAL: Your responses have significantly deviated from your persona definition. " +
        "You MUST strictly follow the persona rules above. " +
        "Revert to your defined tone, style, and communication patterns immediately.\n" +
        "</persona-warning>",
    );
  }

  return sections.join("\n\n");
}

/**
 * Convenience: inject persona rules into an existing system prompt.
 */
export function injectPersona(
  systemPrompt: string,
  rules: PersonaRules,
  action: EnforcementAction = { type: "none" },
): string {
  const injection = buildPersonaInjection(rules, action);
  return `${injection}\n\n${systemPrompt}`;
}
