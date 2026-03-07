/**
 * SoulScan — Inline soul package scanner for SoulClaw.
 * Fully local, no external API dependencies.
 *
 * @example
 * ```ts
 * import { scanSoul, formatReport } from './soulscan/index.ts';
 *
 * const result = await scanSoul('/path/to/soul');
 * console.log(formatReport(result));
 * ```
 */

export {
  scanSoul,
  SOULSCAN_VERSION,
  type ScanResult,
  type Issue,
  type ScanOptions,
} from "./engine.ts";
export { formatReport, formatSummary } from "./report.ts";
export { scanGate, isSoulSafe, type ScanHookOptions, type ScanGateResult } from "./hook.ts";
export {
  DEFAULT_RULES,
  RULES_VERSION,
  type ScanRule,
  type ScanRuleSet,
  type RuleCategory,
  type RuleSeverity,
} from "./rules.ts";
