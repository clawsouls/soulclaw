/**
 * Persona Engine — unified entry point.
 *
 * Provides Soul Spec parsing, persona drift detection,
 * automatic enforcement, and drift metrics tracking.
 * @module persona
 */

export { parseSoulSpec, rulesToPromptBlock } from "./parser.js";
export type { PersonaRules } from "./parser.js";

export { detectDrift } from "./drift-detector.js";
export type { DriftResult } from "./drift-detector.js";

export { evaluateDrift, buildPersonaInjection, injectPersona } from "./enforcer.js";
export type { EnforcementAction } from "./enforcer.js";

export { recordDrift, getAverageDrift, getDriftTrend, getAllMetrics } from "./metrics.js";
export type { MetricEntry, MetricsStore } from "./metrics.js";

export { mergeConfig, DEFAULT_PERSONA_CONFIG } from "./config.js";
export type { PersonaEngineConfig } from "./config.js";

// ─── Convenience: full pipeline ────────────────────────────────

import type { PersonaEngineConfig } from "./config.js";
import type { DriftResult } from "./drift-detector.js";
import { detectDrift } from "./drift-detector.js";
import type { EnforcementAction } from "./enforcer.js";
import { evaluateDrift } from "./enforcer.js";
import { recordDrift } from "./metrics.js";
import type { PersonaRules } from "./parser.js";

export interface PersonaCheckResult {
  drift: DriftResult;
  action: EnforcementAction;
}

/**
 * Run the full persona check pipeline:
 * detect drift → evaluate → record metrics.
 */
export async function checkPersona(
  response: string,
  rules: PersonaRules,
  config: PersonaEngineConfig,
): Promise<PersonaCheckResult> {
  const drift = await detectDrift(response, rules, config);
  const action = evaluateDrift(drift, config);
  await recordDrift(drift, config);

  if (action.message) {
    console.warn(action.message);
  }

  return { drift, action };
}
